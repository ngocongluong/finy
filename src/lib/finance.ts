// Pure calculations: the monthly cash-flow table, net worth, daily allowance.
import { daysInMonth, shiftMonth, uid } from './format';
import type { Account, FixedItem, MonthBudget, OneOff, Tx } from './types';

/** Income, spending and what is left over for one month. */
export interface MonthFlow {
  month: string;
  /** Fixed monthly income. */
  fixedIn: number;
  /** One-off income expected this month. */
  extraIn: number;
  income: number;
  /** Fixed monthly expenses, loan repayments included. */
  fixedOut: number;
  /** One-off expenses expected this month. */
  extraOut: number;
  expense: number;
  /** The part of fixedOut that is loan repayments. */
  debtPayment: number;
  /** income - expense: what can be set aside this month (negative = shortfall). */
  saving: number;
  /** expense / income. */
  spendRatio: number;
  /** saving / income. */
  savingRate: number;
  /** Amount of the fixed expense flagged as the daily-spending bucket. */
  dailyBucket: number;
}

const sum = (list: { amount: number }[]) => list.reduce((s, i) => s + i.amount, 0);

export function monthFlow(fixed: FixedItem[], oneOffs: OneOff[], month: string): MonthFlow {
  const fixedIn = sum(fixed.filter((f) => f.direction === 'in'));
  const outs = fixed.filter((f) => f.direction === 'out');
  const fixedOut = sum(outs);
  const mine = oneOffs.filter((o) => o.month === month);
  const extraIn = sum(mine.filter((o) => o.direction === 'in'));
  const extraOut = sum(mine.filter((o) => o.direction === 'out'));
  const income = fixedIn + extraIn;
  const expense = fixedOut + extraOut;
  return {
    month,
    fixedIn,
    extraIn,
    income,
    fixedOut,
    extraOut,
    expense,
    debtPayment: sum(outs.filter((f) => f.kind === 'debt')),
    saving: income - expense,
    spendRatio: income > 0 ? expense / income : NaN,
    savingRate: income > 0 ? (income - expense) / income : NaN,
    dailyBucket: sum(outs.filter((f) => f.daily)),
  };
}

export interface FlowRow extends MonthFlow {
  /** Savings accumulated from the first row of the table up to and including this month. */
  cumulative: number;
}

/** The income / expense / saving table for `count` consecutive months starting at `start`. */
export function flowTable(fixed: FixedItem[], oneOffs: OneOff[], start: string, count: number): FlowRow[] {
  const rows: FlowRow[] = [];
  let cumulative = 0;
  for (let i = 0; i < count; i++) {
    const flow = monthFlow(fixed, oneOffs, shiftMonth(start, i));
    cumulative += flow.saving;
    rows.push({ ...flow, cumulative });
  }
  return rows;
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

export function dailyStats(bucket: number, txs: Tx[], today: string): DailyStats {
  const month = today.slice(0, 7);
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

/**
 * Converts a budget from the old per-month model into fixed monthly items.
 * Income becomes one fixed income; spending and loan lines become fixed
 * expenses. "Saving" lines are dropped because saving is now calculated
 * (income - expenses), and zero-amount placeholders are dropped because
 * occasional costs are now entered as one-offs in the month they happen.
 */
export function migrateLegacyBudget(b: MonthBudget): FixedItem[] {
  const fixed: FixedItem[] = [];
  if (b.income > 0) fixed.push({ id: uid(), name: 'Thu nhập', amount: b.income, direction: 'in' });
  for (const i of b.items) {
    if (i.kind === 'saving' || !(i.amount > 0)) continue;
    fixed.push({ id: i.id, name: i.name, amount: i.amount, direction: 'out', kind: i.kind, daily: i.daily || undefined });
  }
  return fixed;
}
