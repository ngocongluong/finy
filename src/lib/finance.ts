// Pure calculations over budgets, accounts and transactions.
import { daysInMonth } from './format';
import type { Account, MonthBudget, Tx } from './types';

export interface MonthSummary {
  income: number;
  /** Ordinary spending items. */
  expense: number;
  debtPayment: number;
  saving: number;
  /** Everything allocated this month: expense + debt payments + saving ("Tổng chi" in the sheet). */
  totalOut: number;
  /** Income minus everything allocated ("Tồn"). */
  remaining: number;
  /** (expense + debt payments) / income. Saving is not counted as spending. */
  spendRatio: number;
  savingRate: number;
  /** Amount of the item flagged as the daily-spending bucket. */
  dailyBucket: number;
}

export function monthSummary(b: MonthBudget | undefined): MonthSummary {
  const items = b?.items ?? [];
  const sum = (kind: string) => items.filter((i) => i.kind === kind).reduce((s, i) => s + i.amount, 0);
  const income = b?.income ?? 0;
  const expense = sum('expense');
  const debtPayment = sum('debt');
  const saving = sum('saving');
  const totalOut = expense + debtPayment + saving;
  return {
    income,
    expense,
    debtPayment,
    saving,
    totalOut,
    remaining: income - totalOut,
    spendRatio: income > 0 ? (expense + debtPayment) / income : NaN,
    savingRate: income > 0 ? saving / income : NaN,
    dailyBucket: items.filter((i) => i.daily).reduce((s, i) => s + i.amount, 0),
  };
}

export function netWorth(accounts: Account[]): number {
  return accounts.reduce((s, a) => s + (a.kind === 'debt' ? -a.balance : a.balance), 0);
}

export interface DailyStats {
  /** Monthly bucket for day-to-day spending. */
  bucket: number;
  /** bucket / days in month. */
  baseAllowance: number;
  /** What can be spent today so the bucket lasts until month end. */
  allowance: number;
  spentToday: number;
  spentMonth: number;
  leftToday: number;
  leftMonth: number;
  daysLeft: number;
}

export function dailyStats(b: MonthBudget | undefined, txs: Tx[], today: string): DailyStats {
  const month = today.slice(0, 7);
  const bucket = monthSummary(b).dailyBucket;
  const days = daysInMonth(month);
  const dayOfMonth = Number(today.slice(8, 10));
  const daysLeft = days - dayOfMonth + 1; // including today
  let spentToday = 0;
  let spentBefore = 0;
  for (const t of txs) {
    if (t.direction !== 'out' || !t.countsDaily || !t.date.startsWith(month)) continue;
    if (t.date === today) spentToday += t.amount;
    else if (t.date < today) spentBefore += t.amount;
  }
  const allowance = Math.max(0, (bucket - spentBefore) / daysLeft);
  return {
    bucket,
    baseAllowance: bucket / days,
    allowance,
    spentToday,
    spentMonth: spentBefore + spentToday,
    leftToday: allowance - spentToday,
    leftMonth: bucket - spentBefore - spentToday,
    daysLeft,
  };
}

/** Total counted spending per day for the last `n` days ending today (oldest first). */
export function dailySeries(txs: Tx[], today: string, n: number): { date: string; spent: number }[] {
  const [y, m, d] = today.split('-').map(Number);
  const out: { date: string; spent: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const dt = new Date(y, m - 1, d - i);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    out.push({ date: key, spent: 0 });
  }
  const index = new Map(out.map((o, i) => [o.date, i]));
  for (const t of txs) {
    if (t.direction !== 'out' || !t.countsDaily) continue;
    const i = index.get(t.date);
    if (i !== undefined) out[i].spent += t.amount;
  }
  return out;
}
