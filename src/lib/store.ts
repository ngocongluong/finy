// Single in-memory store. Everything is loaded from the encrypted database
// after unlock; every mutation writes through.
import Constants from 'expo-constants';
import { create } from 'zustand';
import * as db from './db';
import { markCreditItem, migrateLegacyBudget } from './finance';
import { dateKey, monthKey, uid } from './format';
import { DEFAULT_PLAN } from './plan';
import { getDbKey, hasPin } from './security';
import { applyUiPatch, DEFAULT_UI, normalizeUi, type UiPatch } from './theme';
import type { Account, AppSettings, ChatMsg, CreditCardInfo, FixedItem, MonthBudget, OneOff, Overrides, PlanParams, Seed, Tx, UiConfig } from './types';

export const DEFAULT_SETTINGS: AppSettings = {
  autoLockSec: 0,
  hideAmountsOnOpen: false,
  statementDay: 14,
  gmailQuery: 'from:(hsbc.com.vn OR hsbc.com) newer_than:45d',
  gmailEmail: null,
  lastSyncTs: null,
  apiKeyOverride: null,
};

type Phase = 'boot' | 'setup' | 'locked' | 'ready';

interface State {
  phase: Phase;
  loaded: boolean;
  hideAmounts: boolean;
  ui: UiConfig;
  uiHistory: UiConfig[];
  /** Incomes and expenses that repeat every month. */
  fixed: FixedItem[];
  /** Expected one-off incomes and expenses, each tied to a month. */
  oneOffs: OneOff[];
  /** Per-month adjustments of fixed items. */
  overrides: Overrides;
  /** Latest balance the bank reported for the credit card. */
  creditCard: CreditCardInfo | null;
  accounts: Account[];
  txs: Tx[];
  plan: PlanParams;
  settings: AppSettings;
  chat: ChatMsg[];
  /** Full Messages API history (opaque here; owned by claude.ts). */
  apiHistory: unknown[];
  /** A question queued by another screen for the chat tab to send. */
  pendingPrompt: string | null;

  boot: () => Promise<void>;
  unlock: () => Promise<void>;
  lock: () => void;
  toggleHide: () => void;

  upsertFixed: (item: Omit<FixedItem, 'id'> & { id?: string }) => FixedItem;
  deleteFixed: (id: string) => void;
  /** Sets a fixed item's amount for one month only; null removes the adjustment. */
  setOverride: (month: string, fixedId: string, amount: number | null) => void;
  setCreditCard: (info: CreditCardInfo) => void;
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

  setChat: (chat: ChatMsg[], apiHistory: unknown[]) => void;
  clearChat: () => void;
  setPendingPrompt: (p: string | null) => void;
  wipe: () => Promise<void>;
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
  hideAmounts: false,
  ui: DEFAULT_UI,
  uiHistory: [],
  fixed: [],
  oneOffs: [],
  overrides: {},
  creditCard: null,
  accounts: [],
  txs: [],
  plan: DEFAULT_PLAN,
  settings: DEFAULT_SETTINGS,
  chat: [],
  apiHistory: [],
  pendingPrompt: null,

  boot: async () => {
    set({ phase: (await hasPin()) ? 'locked' : 'setup' });
  },

  unlock: async () => {
    if (!get().loaded) {
      await db.openDb(await getDbKey());
      const [ui, fixed, oneOffs, overrides, creditCard, creditMarked, legacyBudgets, accounts, plan, settings, chat, apiHistory, txs] = await Promise.all([
        db.kvGet<UiConfig>('ui'),
        db.kvGet<FixedItem[]>('fixed'),
        db.kvGet<OneOff[]>('oneOffs'),
        db.kvGet<Overrides>('overrides'),
        db.kvGet<CreditCardInfo>('creditCard'),
        db.kvGet<boolean>('creditMarked'),
        db.kvGet<Record<string, MonthBudget>>('budgets'),
        db.kvGet<Account[]>('accounts'),
        db.kvGet<PlanParams>('plan'),
        db.kvGet<AppSettings>('settings'),
        db.kvGet<ChatMsg[]>('chat'),
        db.kvGet<unknown[]>('apiHistory'),
        db.txAll(),
      ]);
      // Three starting points: this model's own data, data from the older
      // per-month budget model (converted once; the old rows are left in place), or a first run.
      const firstRun = fixed === null && legacyBudgets === null;
      const seeded = firstRun ? seedData() : null;
      const migrated = fixed === null && legacyBudgets !== null ? fromLegacyBudgets(legacyBudgets) : null;
      const mergedSettings = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
      // Once: the planned card spend used to be an ordinary expense.
      const loadedFixed = fixed ?? migrated ?? seeded?.fixed ?? [];
      const allFixed = creditMarked ? loadedFixed : markCreditItem(loadedFixed);
      set({
        loaded: true,
        ui: normalizeUi(ui),
        fixed: allFixed,
        oneOffs: oneOffs ?? seeded?.oneOffs ?? [],
        overrides: overrides ?? {},
        creditCard: creditCard ?? null,
        accounts: accounts ?? seeded?.accounts ?? [],
        plan: { ...DEFAULT_PLAN, ...(plan ?? {}) },
        settings: mergedSettings,
        chat: chat ?? [],
        apiHistory: apiHistory ?? [],
        txs,
        hideAmounts: mergedSettings.hideAmountsOnOpen,
      });
      if (fixed === null || allFixed !== loadedFixed) persist('fixed', allFixed);
      if (!creditMarked) persist('creditMarked', true);
      if (oneOffs === null) persist('oneOffs', get().oneOffs);
      if (seeded) persist('accounts', seeded.accounts);
    } else if (get().settings.hideAmountsOnOpen) {
      set({ hideAmounts: true });
    }
    set({ phase: 'ready' });
  },

  lock: () => {
    if (get().phase === 'ready') set({ phase: 'locked' });
  },

  toggleHide: () => set({ hideAmounts: !get().hideAmounts }),

  upsertFixed: (item) => {
    const out = item.direction === 'out';
    const full: FixedItem = {
      id: item.id ?? uid(),
      name: item.name.trim(),
      amount: Math.max(0, Math.round(item.amount)),
      direction: item.direction,
      kind: out ? (item.kind ?? 'expense') : undefined,
      daily: out && item.daily && item.kind !== 'credit' && item.kind !== 'debt' ? true : undefined,
    };
    const cur = get().fixed;
    let fixed = cur.some((f) => f.id === full.id) ? cur.map((f) => (f.id === full.id ? full : f)) : [...cur, full];
    // Only one expense can be the daily-spending bucket, and only one the credit-card plan.
    if (full.daily) fixed = fixed.map((f) => (f.id === full.id ? f : { ...f, daily: undefined }));
    if (full.kind === 'credit') fixed = fixed.map((f) => (f.id === full.id || f.kind !== 'credit' ? f : { ...f, kind: 'expense' }));
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
    // An adjustment equal to the usual amount is no adjustment.
    if (amount === null || Math.round(amount) === item.amount) delete byId[fixedId];
    else byId[fixedId] = Math.max(0, Math.round(amount));
    if (Object.keys(byId).length) overrides[month] = byId;
    else delete overrides[month];
    set({ overrides });
    persist('overrides', overrides);
  },

  setCreditCard: (info) => {
    set({ creditCard: info });
    persist('creditCard', info);
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

  setChat: (chat, apiHistory) => {
    set({ chat, apiHistory });
    persist('chat', chat);
    persist('apiHistory', apiHistory);
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
      creditCard: null,
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
    persist('creditMarked', true);
    persist('accounts', []);
  },
}));
