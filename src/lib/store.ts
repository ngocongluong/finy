// Single in-memory store. Everything is loaded from the encrypted database
// after unlock; every mutation writes through.
import Constants from 'expo-constants';
import { create } from 'zustand';
import * as db from './db';
import { dateKey, monthKey, uid } from './format';
import { DEFAULT_PLAN } from './plan';
import { getDbKey, hasPin } from './security';
import { applyUiPatch, DEFAULT_UI, normalizeUi, type UiPatch } from './theme';
import type { Account, AppSettings, BudgetItem, ChatMsg, MonthBudget, PlanParams, Seed, Tx, UiConfig } from './types';

export const DEFAULT_SETTINGS: AppSettings = {
  autoLockSec: 0,
  hideAmountsOnOpen: false,
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
  budgets: Record<string, MonthBudget>;
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

  ensureMonth: (month: string) => void;
  setIncome: (month: string, income: number) => void;
  upsertItem: (month: string, item: Omit<BudgetItem, 'id'> & { id?: string }) => BudgetItem;
  deleteItem: (month: string, id: string) => void;

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

function seedData(): { budgets: Record<string, MonthBudget>; accounts: Account[] } {
  const seed = (Constants.expoConfig?.extra?.seed ?? null) as Seed | null;
  const month = monthKey();
  const items: BudgetItem[] = (seed?.month?.items ?? []).map((i) => ({ ...i, id: uid() }));
  return {
    budgets: { [month]: { month, income: seed?.month?.income ?? 0, items } },
    accounts: (seed?.accounts ?? []).map((a) => ({ ...a, id: uid() })),
  };
}

export const useStore = create<State>((set, get) => ({
  phase: 'boot',
  loaded: false,
  hideAmounts: false,
  ui: DEFAULT_UI,
  uiHistory: [],
  budgets: {},
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
      const [ui, budgets, accounts, plan, settings, chat, apiHistory, txs] = await Promise.all([
        db.kvGet<UiConfig>('ui'),
        db.kvGet<Record<string, MonthBudget>>('budgets'),
        db.kvGet<Account[]>('accounts'),
        db.kvGet<PlanParams>('plan'),
        db.kvGet<AppSettings>('settings'),
        db.kvGet<ChatMsg[]>('chat'),
        db.kvGet<unknown[]>('apiHistory'),
        db.txAll(),
      ]);
      const firstRun = budgets === null;
      const seeded = firstRun ? seedData() : null;
      const mergedSettings = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
      set({
        loaded: true,
        ui: normalizeUi(ui),
        budgets: budgets ?? seeded!.budgets,
        accounts: accounts ?? seeded?.accounts ?? [],
        plan: { ...DEFAULT_PLAN, ...(plan ?? {}) },
        settings: mergedSettings,
        chat: chat ?? [],
        apiHistory: apiHistory ?? [],
        txs,
        hideAmounts: mergedSettings.hideAmountsOnOpen,
      });
      if (seeded) {
        persist('budgets', seeded.budgets);
        persist('accounts', seeded.accounts);
      }
      get().ensureMonth(monthKey());
    } else if (get().settings.hideAmountsOnOpen) {
      set({ hideAmounts: true });
    }
    set({ phase: 'ready' });
  },

  lock: () => {
    if (get().phase === 'ready') set({ phase: 'locked' });
  },

  toggleHide: () => set({ hideAmounts: !get().hideAmounts }),

  ensureMonth: (month) => {
    const { budgets } = get();
    if (budgets[month]) return;
    // A new month starts as a copy of the closest earlier month.
    const earlier = Object.keys(budgets)
      .filter((m) => m < month)
      .sort();
    const src = earlier.length ? budgets[earlier[earlier.length - 1]] : undefined;
    const next = {
      ...budgets,
      [month]: { month, income: src?.income ?? 0, items: (src?.items ?? []).map((i) => ({ ...i })) },
    };
    set({ budgets: next });
    persist('budgets', next);
  },

  setIncome: (month, income) => {
    get().ensureMonth(month);
    const budgets = { ...get().budgets };
    budgets[month] = { ...budgets[month], income: Math.max(0, Math.round(income)) };
    set({ budgets });
    persist('budgets', budgets);
  },

  upsertItem: (month, item) => {
    get().ensureMonth(month);
    const budgets = { ...get().budgets };
    const cur = budgets[month];
    const full: BudgetItem = {
      id: item.id ?? uid(),
      name: item.name.trim(),
      amount: Math.max(0, Math.round(item.amount)),
      kind: item.kind,
      daily: item.daily || undefined,
    };
    let items = cur.items.some((i) => i.id === full.id)
      ? cur.items.map((i) => (i.id === full.id ? full : i))
      : [...cur.items, full];
    // Only one item can be the daily-spending bucket.
    if (full.daily) items = items.map((i) => (i.id === full.id ? i : { ...i, daily: undefined }));
    budgets[month] = { ...cur, items };
    set({ budgets });
    persist('budgets', budgets);
    return full;
  },

  deleteItem: (month, id) => {
    const budgets = { ...get().budgets };
    const cur = budgets[month];
    if (!cur) return;
    budgets[month] = { ...cur, items: cur.items.filter((i) => i.id !== id) };
    set({ budgets });
    persist('budgets', budgets);
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
    const month = monthKey();
    set({
      ui: DEFAULT_UI,
      uiHistory: [],
      budgets: { [month]: { month, income: 0, items: [] } },
      accounts: [],
      txs: [],
      plan: DEFAULT_PLAN,
      settings: DEFAULT_SETTINGS,
      chat: [],
      apiHistory: [],
    });
    persist('budgets', get().budgets);
  },
}));
