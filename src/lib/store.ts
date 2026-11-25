// Single in-memory store. Everything is loaded from the encrypted database
// after unlock; every mutation writes through.
import Constants from 'expo-constants';
import { create } from 'zustand';
import * as db from './db';
import { fixedBase, fixedPeriodsAmountAt, markCreditItem, migrateLegacyBudget, normalizeFamilyLoan, normalizeFixedPeriods, normalizeLoan, normalizePaid } from './finance';
import { dateKey, monthKey, uid } from './format';
import { DEFAULT_PLAN } from './plan';
import { getDbKey, hasPin } from './security';
import { applyUiPatch, DEFAULT_UI, normalizeUi, type UiPatch } from './theme';
import type { Account, AppSettings, CashOnHand, ChatMsg, CreditCardInfo, FamilyLoan, FixedItem, Instalment, Loan, MonthBudget, OneOff, Overrides, PaidMarks, PlanParams, Seed, Tx, UiConfig } from './types';

/**
 * The address HSBC Vietnam sends card-transaction alerts from. Which senders
 * are actually trusted is still decided on the phone from the sender domain.
 */
const GMAIL_QUERY = 'from:HSBC@notification.hsbc.com.hk newer_than:60d';
const OLD_GMAIL_QUERIES = ['from:(hsbc.com.vn OR hsbc.com) newer_than:45d', 'from:hsbc newer_than:60d'];

export const DEFAULT_SETTINGS: AppSettings = {
  autoLockSec: 0,
  hideAmountsOnOpen: false,
  statementDay: 14,
  gmailQuery: GMAIL_QUERY,
  gmailEmail: null,
  lastSyncTs: null,
  lastSyncReport: null,
  apiKeyOverride: null,
};

type Phase = 'boot' | 'setup' | 'locked' | 'ready';

interface State {
  phase: Phase;
  loaded: boolean;
  /** Sections (see HideScope in components/ui) whose amounts are shown. Empty after every unlock. */
  revealed: string[];
  ui: UiConfig;
  uiHistory: UiConfig[];
  /** Incomes and expenses that repeat every month. */
  fixed: FixedItem[];
  /** Expected one-off incomes and expenses, each tied to a month. */
  oneOffs: OneOff[];
  /** Per-month adjustments of fixed items. */
  overrides: Overrides;
  /** Expense lines ticked off as paid, per month. */
  paid: PaidMarks;
  /** Latest balance the bank reported for the credit card. */
  creditCard: CreditCardInfo | null;
  /** Purchases paid off on the card in monthly parts. */
  instalments: Instalment[];
  /** Bank loans. */
  loans: Loan[];
  /** Loans from family: paid back in one go at the end. */
  familyLoans: FamilyLoan[];
  /** Money the user has now (entered on the Budget tab). */
  cash: CashOnHand | null;
  accounts: Account[];
  txs: Tx[];
  plan: PlanParams;
  settings: AppSettings;
  chat: ChatMsg[];
  /** Full Messages API history (opaque here; owned by claude.ts). */
  apiHistory: unknown[];
  /** Which system prompt and tools apiHistory was produced with (owned by claude.ts). */
  apiHistoryKey: string | null;
  /** A question queued by another screen for the chat tab to send. */
  pendingPrompt: string | null;

  boot: () => Promise<void>;
  unlock: () => Promise<void>;
  lock: () => void;
  toggleReveal: (section: string) => void;

  upsertFixed: (item: Omit<FixedItem, 'id'> & { id?: string }) => FixedItem;
  deleteFixed: (id: string) => void;
  /** Sets a fixed item's amount for one month only; null removes the adjustment. */
  setOverride: (month: string, fixedId: string, amount: number | null) => void;
  /** Ticks a month's expense line off as paid (key: lineKey in finance), or clears the tick. */
  setPaid: (month: string, key: string, paid: boolean) => void;
  setCreditCard: (info: CreditCardInfo) => void;
  upsertInstalment: (p: Omit<Instalment, 'id'> & { id?: string }) => Instalment;
  deleteInstalment: (id: string) => void;
  upsertLoan: (l: Omit<Loan, 'id'> & { id?: string }) => Loan;
  deleteLoan: (id: string) => void;
  upsertFamilyLoan: (l: Omit<FamilyLoan, 'id'> & { id?: string }) => FamilyLoan;
  deleteFamilyLoan: (id: string) => void;
  setCash: (amount: number | null) => void;
  /** Adds the same one-off to each of the given months. */
  addOneOffs: (months: string[], item: Omit<OneOff, 'id' | 'month'>) => OneOff[];
  updateOneOff: (item: OneOff) => void;
  deleteOneOff: (id: string) => void;

  upsertAccount: (a: Omit<Account, 'id'> & { id?: string }) => Account;
  deleteAccount: (id: string) => void;

  addTx: (t: Omit<Tx, 'id' | 'ts' | 'date'> & { date?: string; ts?: number }) => Promise<Tx | null>;
  updateTx: (t: Tx) => Promise<void>;
  deleteTx: (id: string) => Promise<void>;

  setPlan: (patch: Partial<PlanParams>) => void;
  patchUi: (patch: UiPatch) => string[] | null;
  undoUi: () => boolean;
  resetUi: () => void;
  setSettings: (patch: Partial<AppSettings>) => void;

  setChat: (chat: ChatMsg[], apiHistory: unknown[], apiHistoryKey: string) => void;
  clearChat: () => void;
  setPendingPrompt: (p: string | null) => void;
  wipe: () => Promise<void>;
}

/** A valid month range (from ≤ to), or nothing when the item applies every month. */
function monthRange(from?: string, to?: string): { fromMonth?: string; toMonth?: string } {
  const ok = (m?: string) => (m && /^\d{4}-\d{2}$/.test(m) ? m : undefined);
  let a = ok(from);
  let b = ok(to);
  if (a && b && a > b) [a, b] = [b, a];
  return { ...(a ? { fromMonth: a } : {}), ...(b ? { toMonth: b } : {}) };
}

function persist(key: string, value: unknown) {
  db.kvSet(key, value).catch((e) => console.warn(`Failed to save ${key}`, e));
}

function seedData(): { fixed: FixedItem[]; oneOffs: OneOff[]; accounts: Account[] } {
  const seed = (Constants.expoConfig?.extra?.seed ?? null) as Seed | null;
  return {
    fixed: (seed?.fixed ?? []).map((f) => ({ ...f, id: uid() })),
    oneOffs: (seed?.oneOffs ?? []).map((o) => ({ ...o, id: uid() })),
    accounts: (seed?.accounts ?? []).map((a) => ({ ...a, id: uid() })),
  };
}

/** Data saved by app versions that kept one budget per month: use the current (or latest) month. */
function fromLegacyBudgets(budgets: Record<string, MonthBudget>): FixedItem[] {
  const months = Object.keys(budgets).sort();
  if (!months.length) return [];
  const pick = budgets[monthKey()] ?? budgets[months[months.length - 1]];
  return migrateLegacyBudget(pick);
}

export const useStore = create<State>((set, get) => ({
  phase: 'boot',
  loaded: false,
  // Every amount starts hidden; the eye button reveals them until the next lock.
  revealed: [],
  ui: DEFAULT_UI,
  uiHistory: [],
  fixed: [],
  oneOffs: [],
  overrides: {},
  paid: {},
  creditCard: null,
  instalments: [],
  loans: [],
  familyLoans: [],
  cash: null,
  accounts: [],
  txs: [],
  plan: DEFAULT_PLAN,
  settings: DEFAULT_SETTINGS,
  chat: [],
  apiHistory: [],
  apiHistoryKey: null,
  pendingPrompt: null,

  boot: async () => {
    set({ phase: (await hasPin()) ? 'locked' : 'setup' });
  },

  unlock: async () => {
    if (!get().loaded) {
      await db.openDb(await getDbKey());
      // Once, when foreign-currency card alerts started being imported: import all card mail
      // again from scratch, so every alert has the balance of the one before it to price from.
      const reimport = !(await db.kvGet<boolean>('gmailReset2'));
      if (reimport) {
        await db.deleteImportedCardTxs();
        await db.kvSet('gmail_skipped', []);
        await db.kvSet('cardBalances', {});
        await db.kvSet('gmailReset1', true);
        await db.kvSet('gmailReset2', true);
      }
      const [ui, fixed, oneOffs, overrides, paid, creditCard, instalments, loans, familyLoans, cash, creditMarked, legacyBudgets, accounts, plan, settings, chat, apiHistory, apiHistoryKey, txs] = await Promise.all([
        db.kvGet<UiConfig>('ui'),
        db.kvGet<FixedItem[]>('fixed'),
        db.kvGet<OneOff[]>('oneOffs'),
        db.kvGet<Overrides>('overrides'),
        db.kvGet<PaidMarks>('paid'),
        db.kvGet<CreditCardInfo>('creditCard'),
        db.kvGet<Instalment[]>('instalments'),
        db.kvGet<Loan[]>('loans'),
        db.kvGet<FamilyLoan[]>('familyLoans'),
        db.kvGet<CashOnHand>('cash'),
        db.kvGet<boolean>('creditMarked'),
        db.kvGet<Record<string, MonthBudget>>('budgets'),
        db.kvGet<Account[]>('accounts'),
        db.kvGet<PlanParams>('plan'),
        db.kvGet<AppSettings>('settings'),
        db.kvGet<ChatMsg[]>('chat'),
        db.kvGet<unknown[]>('apiHistory'),
        db.kvGet<string>('apiHistoryKey'),
        db.txAll(),
      ]);
      // Three starting points: this model's own data, data from the older
      // per-month budget model (converted once; the old rows are left in place), or a first run.
      const firstRun = fixed === null && legacyBudgets === null;
      const seeded = firstRun ? seedData() : null;
      const migrated = fixed === null && legacyBudgets !== null ? fromLegacyBudgets(legacyBudgets) : null;
      const mergedSettings = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
      // A query the user never changed follows the app's current default.
      if (OLD_GMAIL_QUERIES.includes(mergedSettings.gmailQuery)) mergedSettings.gmailQuery = GMAIL_QUERY;
      // Once: the planned card spend used to be an ordinary expense.
      const loadedFixed = fixed ?? migrated ?? seeded?.fixed ?? [];
      const allFixed = creditMarked ? loadedFixed : markCreditItem(loadedFixed);
      set({
        loaded: true,
        ui: normalizeUi(ui),
        fixed: allFixed,
        oneOffs: oneOffs ?? seeded?.oneOffs ?? [],
        overrides: overrides ?? {},
        paid: normalizePaid(paid),
        creditCard: creditCard ?? null,
        instalments: instalments ?? [],
        // Loans saved by older versions had one rate on the loan itself: convert to periods.
        loans: (loans ?? []).map(normalizeLoan),
        familyLoans: (familyLoans ?? []).map(normalizeFamilyLoan),
        cash: cash ?? null,
        accounts: accounts ?? seeded?.accounts ?? [],
        plan: { ...DEFAULT_PLAN, ...(plan ?? {}) },
        settings: mergedSettings,
        chat: chat ?? [],
        apiHistory: apiHistory ?? [],
        apiHistoryKey: apiHistoryKey ?? null,
        txs,
        revealed: [],
      });
      if (fixed === null || allFixed !== loadedFixed) persist('fixed', allFixed);
      if (!creditMarked) persist('creditMarked', true);
      // Once: money on hand from the private seed, if the app has none yet.
      const seedCash = (Constants.expoConfig?.extra?.seed as Seed | null)?.cashOnHand;
      if (!cash && seedCash && !(await db.kvGet<boolean>('cashSeeded'))) get().setCash(seedCash);
      if (!(await db.kvGet<boolean>('cashSeeded'))) persist('cashSeeded', true);
      // Sync again right after this unlock instead of waiting for the 30-minute spacing.
      if (reimport) get().setSettings({ lastSyncTs: null });
      // Once: older versions remembered mail from untrusted senders as processed,
      // so it would never be looked at again. Start the Gmail bookkeeping over.

      if (oneOffs === null) persist('oneOffs', get().oneOffs);
      if (seeded) persist('accounts', seeded.accounts);
    } else {
      set({ revealed: [] });
    }
    set({ phase: 'ready' });
  },

  lock: () => {
    if (get().phase === 'ready') set({ phase: 'locked', revealed: [] });
  },

  toggleReveal: (section) => {
    const cur = get().revealed;
    set({ revealed: cur.includes(section) ? cur.filter((x) => x !== section) : [...cur, section] });
  },

  upsertFixed: (item) => {
    const out = item.direction === 'out';
    let periods = normalizeFixedPeriods(item.periods);
    let amount = item.amount;
    // One period open at both ends is simply the same amount every month.
    if (periods.length === 1 && periods[0].from === null && periods[0].to === null) {
      amount = periods[0].amount;
      periods = [];
    }
    if (periods.length) amount = fixedPeriodsAmountAt(periods, monthKey());
    const full: FixedItem = {
      id: item.id ?? uid(),
      name: item.name.trim(),
      amount: Math.max(0, Math.round(amount)),
      direction: item.direction,
      kind: out ? (item.kind ?? 'expense') : undefined,
      daily: out && item.daily && !item.onCard && item.kind !== 'credit' && item.kind !== 'debt' ? true : undefined,
      onCard: out && item.onCard && (item.kind ?? 'expense') === 'expense' ? true : undefined,
      // Periods carry their own months; otherwise the item may be limited to one range.
      ...(periods.length ? { periods } : monthRange(item.fromMonth, item.toMonth)),
    };
    const cur = get().fixed;
    let fixed = cur.some((f) => f.id === full.id) ? cur.map((f) => (f.id === full.id ? full : f)) : [...cur, full];
    // Only one expense can be the daily-spending bucket. The card plan can be several items.
    if (full.daily) fixed = fixed.map((f) => (f.id === full.id ? f : { ...f, daily: undefined }));
    set({ fixed });
    persist('fixed', fixed);
    return full;
  },

  deleteFixed: (id) => {
    const fixed = get().fixed.filter((f) => f.id !== id);
    const overrides: Overrides = {};
    for (const [month, byId] of Object.entries(get().overrides)) {
      const rest = Object.fromEntries(Object.entries(byId).filter(([fid]) => fid !== id));
      if (Object.keys(rest).length) overrides[month] = rest;
    }
    set({ fixed, overrides });
    persist('fixed', fixed);
    persist('overrides', overrides);
  },

  setOverride: (month, fixedId, amount) => {
    const item = get().fixed.find((f) => f.id === fixedId);
    if (!item) return;
    const overrides: Overrides = { ...get().overrides };
    const byId = { ...(overrides[month] ?? {}) };
    // An adjustment equal to the usual amount of that month (its period's, if it has periods) is no adjustment.
    if (amount === null || Math.round(amount) === fixedBase(item, month)) delete byId[fixedId];
    else byId[fixedId] = Math.max(0, Math.round(amount));
    if (Object.keys(byId).length) overrides[month] = byId;
    else delete overrides[month];
    set({ overrides });
    persist('overrides', overrides);
  },

  setPaid: (month, key, on) => {
    const cur = get().paid[month] ?? [];
    if (on === cur.includes(key)) return;
    const keys = on ? [...cur, key] : cur.filter((k) => k !== key);
    const paid: PaidMarks = { ...get().paid };
    if (keys.length) paid[month] = keys;
    else delete paid[month];
    set({ paid });
    persist('paid', paid);
  },

  setCreditCard: (info) => {
    set({ creditCard: info });
    persist('creditCard', info);
  },

  upsertInstalment: (p) => {
    const full: Instalment = {
      id: p.id ?? uid(),
      name: p.name.trim(),
      total: Math.max(0, Math.round(p.total)),
      months: Math.min(120, Math.max(1, Math.round(p.months))),
      startMonth: p.startMonth,
    };
    const cur = get().instalments;
    const instalments = cur.some((x) => x.id === full.id) ? cur.map((x) => (x.id === full.id ? full : x)) : [...cur, full];
    set({ instalments });
    persist('instalments', instalments);
    return full;
  },

  upsertLoan: (l) => {
    const full: Loan = normalizeLoan({ ...l, id: l.id ?? uid(), name: l.name.trim() });
    const cur = get().loans;
    const loans = cur.some((x) => x.id === full.id) ? cur.map((x) => (x.id === full.id ? full : x)) : [...cur, full];
    set({ loans });
    persist('loans', loans);
    return full;
  },

  setCash: (amount) => {
    const cash = amount === null ? null : { amount: Math.round(amount), month: monthKey() };
    set({ cash });
    persist('cash', cash);
  },

  deleteLoan: (id) => {
    const loans = get().loans.filter((x) => x.id !== id);
    set({ loans });
    persist('loans', loans);
  },

  upsertFamilyLoan: (l) => {
    const full = normalizeFamilyLoan({ ...l, id: l.id ?? uid(), name: l.name.trim() });
    const cur = get().familyLoans;
    const familyLoans = cur.some((x) => x.id === full.id) ? cur.map((x) => (x.id === full.id ? full : x)) : [...cur, full];
    set({ familyLoans });
    persist('familyLoans', familyLoans);
    return full;
  },

  deleteFamilyLoan: (id) => {
    const familyLoans = get().familyLoans.filter((x) => x.id !== id);
    set({ familyLoans });
    persist('familyLoans', familyLoans);
  },

  deleteInstalment: (id) => {
    const instalments = get().instalments.filter((x) => x.id !== id);
    set({ instalments });
    persist('instalments', instalments);
  },

  addOneOffs: (months, item) => {
    const added: OneOff[] = [...new Set(months)].map((month) => ({
      id: uid(),
      month,
      name: item.name.trim(),
      amount: Math.max(0, Math.round(item.amount)),
      direction: item.direction,
    }));
    const oneOffs = [...get().oneOffs, ...added];
    set({ oneOffs });
    persist('oneOffs', oneOffs);
    return added;
  },

  updateOneOff: (item) => {
    const full: OneOff = { ...item, name: item.name.trim(), amount: Math.max(0, Math.round(item.amount)) };
    const oneOffs = get().oneOffs.map((o) => (o.id === full.id ? full : o));
    set({ oneOffs });
    persist('oneOffs', oneOffs);
  },

  deleteOneOff: (id) => {
    const oneOffs = get().oneOffs.filter((o) => o.id !== id);
    set({ oneOffs });
    persist('oneOffs', oneOffs);
  },

  upsertAccount: (a) => {
    const full: Account = { id: a.id ?? uid(), name: a.name.trim(), kind: a.kind, balance: Math.max(0, Math.round(a.balance)) };
    const cur = get().accounts;
    const accounts = cur.some((x) => x.id === full.id) ? cur.map((x) => (x.id === full.id ? full : x)) : [...cur, full];
    set({ accounts });
    persist('accounts', accounts);
    return full;
  },

  deleteAccount: (id) => {
    const accounts = get().accounts.filter((a) => a.id !== id);
    set({ accounts });
    persist('accounts', accounts);
  },

  addTx: async (t) => {
    const now = new Date();
    const date = t.date ?? dateKey(now);
    let ts = t.ts;
    if (ts === undefined) {
      // Keep the chosen day, use the current time of day for ordering.
      const [y, m, d] = date.split('-').map(Number);
      ts = new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds()).getTime();
    }
    const full: Tx = { ...t, id: uid(), date, ts, amount: Math.round(t.amount) };
    const inserted = await db.txInsert(full);
    if (!inserted) return null;
    set({ txs: [full, ...get().txs].sort((a, b) => b.ts - a.ts) });
    return full;
  },

  updateTx: async (t) => {
    await db.txUpdate(t);
    set({ txs: get().txs.map((x) => (x.id === t.id ? t : x)).sort((a, b) => b.ts - a.ts) });
  },

  deleteTx: async (id) => {
    const t = get().txs.find((x) => x.id === id);
    await db.txDelete(id);
    if (t?.extId) {
      // Remember deleted imports so the next Gmail sync does not bring them back.
      const skipped = (await db.kvGet<string[]>('gmail_skipped')) ?? [];
      await db.kvSet('gmail_skipped', [...skipped, t.extId].slice(-2000));
    }
    set({ txs: get().txs.filter((x) => x.id !== id) });
  },

  setPlan: (patch) => {
    const plan = { ...get().plan, ...patch };
    set({ plan });
    persist('plan', plan);
  },

  patchUi: (patch) => {
    const res = applyUiPatch(get().ui, patch);
    if ('errors' in res) return res.errors;
    const uiHistory = [...get().uiHistory, get().ui].slice(-20);
    set({ ui: res.ui, uiHistory });
    persist('ui', res.ui);
    return null;
  },

  undoUi: () => {
    const hist = get().uiHistory;
    if (!hist.length) return false;
    const ui = hist[hist.length - 1];
    set({ ui, uiHistory: hist.slice(0, -1) });
    persist('ui', ui);
    return true;
  },

  resetUi: () => {
    set({ ui: DEFAULT_UI, uiHistory: [...get().uiHistory, get().ui].slice(-20) });
    persist('ui', DEFAULT_UI);
  },

  setSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    persist('settings', settings);
  },

  setChat: (chat, apiHistory, apiHistoryKey) => {
    set({ chat, apiHistory, apiHistoryKey });
    persist('chat', chat);
    persist('apiHistory', apiHistory);
    persist('apiHistoryKey', apiHistoryKey);
  },

  clearChat: () => {
    set({ chat: [], apiHistory: [] });
    persist('chat', []);
    persist('apiHistory', []);
  },

  setPendingPrompt: (p) => set({ pendingPrompt: p }),

  wipe: async () => {
    await db.wipeAll();
    set({
      ui: DEFAULT_UI,
      uiHistory: [],
      fixed: [],
      oneOffs: [],
      overrides: {},
      paid: {},
      creditCard: null,
      instalments: [],
      loans: [],
      familyLoans: [],
      cash: null,
      accounts: [],
      txs: [],
      plan: DEFAULT_PLAN,
      settings: DEFAULT_SETTINGS,
      chat: [],
      apiHistory: [],
    });
    // Written explicitly so the next launch does not treat this as a first run and re-seed.
    persist('fixed', []);
    persist('oneOffs', []);
    persist('instalments', []);
    persist('loans', []);
    persist('familyLoans', []);
    persist('cash', null);
    persist('creditMarked', true);
    persist('accounts', []);
  },
}));
