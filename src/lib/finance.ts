// Pure calculations: the monthly cash-flow table, the credit-card statement
// cycle, net worth, daily allowance.
import { dateKey, daysInMonth, shiftMonth, uid } from './format';
import type { Account, FixedItem, MonthBudget, OneOff, Overrides, Tx } from './types';

/** Everything the user enters to describe their monthly money. */
export interface Budget {
  fixed: FixedItem[];
  oneOffs: OneOff[];
  overrides: Overrides;
}

/** A fixed item's amount in a given month: the month's own adjustment if there is one. */
export function fixedAmount(b: Pick<Budget, 'overrides'>, item: FixedItem, month: string): number {
  const o = b.overrides[month]?.[item.id];
  return o === undefined ? item.amount : o;
}

// ---- credit-card statement cycle ----

export interface CreditCycle {
  /** The month whose statement this cycle ends in. */
  month: string;
  /** First and last day of the cycle, inclusive (YYYY-MM-DD). */
  start: string;
  end: string;
}

const clampDay = (d: number) => Math.min(28, Math.max(1, Math.round(d) || 1));

/** The cycle that closes on `statementDay` of `month`: the day after the previous statement up to that day. */
export function creditCycle(month: string, statementDay: number): CreditCycle {
  const day = clampDay(statementDay);
  const [y, m] = month.split('-').map(Number);
  return {
    month,
    start: dateKey(new Date(y, m - 2, day + 1)),
    end: `${month}-${String(day).padStart(2, '0')}`,
  };
}

/** The statement month a transaction dated `date` belongs to. */
export function cycleMonthOf(date: string, statementDay: number): string {
  const month = date.slice(0, 7);
  return Number(date.slice(8, 10)) <= clampDay(statementDay) ? month : shiftMonth(month, 1);
}

/** Card spending in a cycle: purchases minus refunds. */
export function creditSpent(txs: Tx[], cycle: CreditCycle): number {
  let total = 0;
  for (const t of txs) {
    if (!t.credit || t.date < cycle.start || t.date > cycle.end) continue;
    total += t.direction === 'out' ? t.amount : -t.amount;
  }
  return total;
}

/** Looks up actual card spending for a month's statement; omit when there is no transaction data. */
export interface CreditData {
  txs: Tx[];
  statementDay: number;
}

// ---- one month ----

/** One line of a month's income or expenses. */
export interface Line {
  source: 'fixed' | 'oneoff';
  id: string;
  name: string;
  /** Amount counted in this month. */
  amount: number;
  /** For fixed items: the usual monthly amount. */
  base?: number;
  /** For fixed items: this month uses its own amount instead of the usual one. */
  overridden?: boolean;
  kind?: FixedItem['kind'];
  daily?: boolean;
}

/** Income, spending and what is left over for one month. */
export interface MonthFlow {
  month: string;
  /** Fixed monthly income (with this month's adjustments). */
  fixedIn: number;
  /** One-off income expected this month. */
  extraIn: number;
  income: number;
  /** Fixed monthly expenses: spending, loan repayments and the planned credit-card spend. */
  fixedOut: number;
  /** One-off expenses expected this month. */
  extraOut: number;
  /** fixedOut + extraOut + creditOver. */
  expense: number;
  /** The part of fixedOut that is loan repayments. */
  debtPayment: number;
  /** The part of fixedOut planned for the credit card. */
  creditPlanned: number;
  /** Actual card spending in the statement cycle that closes this month. */
  creditSpent: number;
  /** Card spending beyond the plan; it is added to the month's expenses. */
  creditOver: number;
  /** income - expense: what can be set aside this month (negative = shortfall). */
  saving: number;
  /** expense / income. */
  spendRatio: number;
  /** saving / income. */
  savingRate: number;
  /** Amount of the fixed expense flagged as the daily-spending bucket. */
  dailyBucket: number;
  /** True when a fixed item has its own amount this month. */
  adjusted: boolean;
  incomeLines: Line[];
  /** Expenses other than the credit-card plan. */
  expenseLines: Line[];
  creditLine: Line | null;
}

const total = (list: { amount: number }[]) => list.reduce((s, i) => s + i.amount, 0);

export function monthFlow(b: Budget, month: string, credit?: CreditData): MonthFlow {
  const fixedLine = (f: FixedItem): Line => {
    const amount = fixedAmount(b, f, month);
    return { source: 'fixed', id: f.id, name: f.name, amount, base: f.amount, overridden: amount !== f.amount, kind: f.kind, daily: f.daily };
  };
  const oneOffLine = (o: OneOff): Line => ({ source: 'oneoff', id: o.id, name: o.name, amount: o.amount });

  const fixedInLines = b.fixed.filter((f) => f.direction === 'in').map(fixedLine);
  const fixedOutLines = b.fixed.filter((f) => f.direction === 'out').map(fixedLine);
  const mine = b.oneOffs.filter((o) => o.month === month);
  const extraInLines = mine.filter((o) => o.direction === 'in').map(oneOffLine);
  const extraOutLines = mine.filter((o) => o.direction === 'out').map(oneOffLine);

  const creditLine = fixedOutLines.find((l) => l.kind === 'credit') ?? null;
  const creditPlanned = creditLine?.amount ?? 0;
  const spent = credit ? creditSpent(credit.txs, creditCycle(month, credit.statementDay)) : 0;
  const creditOver = creditLine ? Math.max(0, spent - creditPlanned) : 0;

  const fixedIn = total(fixedInLines);
  const fixedOut = total(fixedOutLines);
  const extraIn = total(extraInLines);
  const extraOut = total(extraOutLines);
  const income = fixedIn + extraIn;
  const expense = fixedOut + extraOut + creditOver;
  return {
    month,
    fixedIn,
    extraIn,
    income,
    fixedOut,
    extraOut,
    expense,
    debtPayment: total(fixedOutLines.filter((l) => l.kind === 'debt')),
    creditPlanned,
    creditSpent: spent,
    creditOver,
    saving: income - expense,
    spendRatio: income > 0 ? expense / income : NaN,
    savingRate: income > 0 ? (income - expense) / income : NaN,
    dailyBucket: total(fixedOutLines.filter((l) => l.daily)),
    adjusted: [...fixedInLines, ...fixedOutLines].some((l) => l.overridden),
    incomeLines: [...fixedInLines, ...extraInLines],
    expenseLines: [...fixedOutLines.filter((l) => l.kind !== 'credit'), ...extraOutLines],
    creditLine,
  };
}

export interface FlowRow extends MonthFlow {
  /** Savings accumulated from the first row of the table up to and including this month. */
  cumulative: number;
}

/** The income / expense / saving table for `count` consecutive months starting at `start`. */
export function flowTable(b: Budget, start: string, count: number, credit?: CreditData): FlowRow[] {
  const rows: FlowRow[] = [];
  let cumulative = 0;
  for (let i = 0; i < count; i++) {
    const flow = monthFlow(b, shiftMonth(start, i), credit);
    cumulative += flow.saving;
    rows.push({ ...flow, cumulative });
  }
  return rows;
}

// ---- net worth and day-to-day spending ----

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
  for (let i = n - 1; i >= 0; i--) out.push({ date: dateKey(new Date(y, m - 1, d - i)), spent: 0 });
  const index = new Map(out.map((o, i) => [o.date, i]));
  for (const t of txs) {
    if (t.direction !== 'out' || !t.countsDaily) continue;
    const i = index.get(t.date);
    if (i !== undefined) out[i].spent += t.amount;
  }
  return out;
}

// ---- data from older app versions ----

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

/**
 * Before the credit kind existed, the planned card spend was an ordinary
 * expense. If exactly one expense is named like a credit card and nothing is
 * marked as credit yet, mark that one.
 */
export function markCreditItem(fixed: FixedItem[]): FixedItem[] {
  if (fixed.some((f) => f.kind === 'credit')) return fixed;
  const named = fixed.filter((f) => f.direction === 'out' && f.kind !== 'debt' && /t[ií]n\s*d[uụ]ng|credit/i.test(f.name));
  if (named.length !== 1) return fixed;
  return fixed.map((f) => (f.id === named[0].id ? { ...f, kind: 'credit', daily: undefined } : f));
}
