// Pure calculations: the monthly cash-flow table, the credit-card statement
// cycle, net worth, daily allowance.
import { dateKey, daysInMonth, shiftMonth, uid } from './format';
import type { Account, FixedItem, Instalment, MonthBudget, OneOff, Overrides, Tx } from './types';

/** Everything the user enters to describe their monthly money. */
export interface Budget {
  fixed: FixedItem[];
  oneOffs: OneOff[];
  overrides: Overrides;
  /** Card instalment plans; optional so older callers and tests stay valid. */
  instalments?: Instalment[];
}

const monthsBetween = (from: string, to: string) => {
  const [y1, m1] = from.split('-').map(Number);
  const [y2, m2] = to.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
};

/** Which part of the plan falls in a statement month (1-based), or null when none does. */
export function instalmentPart(p: Instalment, month: string): number | null {
  const i = monthsBetween(p.startMonth, month);
  return i >= 0 && i < p.months ? i + 1 : null;
}

/**
 * The amount of part `n`: the total split evenly in whole đồng, the rounding
 * remainder paid with the last part, so the parts add up to the total exactly.
 */
export function instalmentAmount(p: Instalment, n: number): number {
  const months = Math.max(1, Math.round(p.months));
  const base = Math.floor(p.total / months);
  return n === months ? p.total - base * (months - 1) : base;
}

export interface InstalmentLine {
  id: string;
  name: string;
  amount: number;
  part: number;
  months: number;
}

export function instalmentLines(plans: Instalment[] | undefined, month: string): InstalmentLine[] {
  const out: InstalmentLine[] = [];
  for (const p of plans ?? []) {
    const part = instalmentPart(p, month);
    if (part !== null) out.push({ id: p.id, name: p.name, amount: instalmentAmount(p, part), part, months: p.months });
  }
  return out;
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
  /** Today (YYYY-MM-DD); decides whether a cycle has closed. Defaults to the real date. */
  today?: string;
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
  onCard?: boolean;
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
  /** Fixed expenses other than the card plan, plus one-offs, plus creditCounted. */
  expense: number;
  /** The part of fixedOut that is loan repayments. */
  debtPayment: number;
  /** The part of fixedOut planned for the credit card. */
  creditPlanned: number;
  /** Actual card spending in the statement cycle that closes this month. */
  creditSpent: number;
  /** Card spending beyond the plan. */
  creditOver: number;
  /** The cycle that closes this month has closed: its actual total is final. */
  creditClosed: boolean;
  /**
   * What the card costs this month in the expense total. A closed cycle counts
   * at its actual total (it is paid with this month's salary); an open one at
   * the plan, or at what was already spent when that is more.
   */
  creditCounted: number;
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
  /** Fixed items charged to the card each cycle; included in creditSpent. */
  onCardLines: Line[];
  /** Instalment parts due in this statement month; included in creditSpent. */
  instalmentLines: InstalmentLine[];
}

const total = (list: { amount: number }[]) => list.reduce((s, i) => s + i.amount, 0);

export function monthFlow(b: Budget, month: string, credit?: CreditData): MonthFlow {
  const fixedLine = (f: FixedItem): Line => {
    const amount = fixedAmount(b, f, month);
    return { source: 'fixed', id: f.id, name: f.name, amount, base: f.amount, overridden: amount !== f.amount, kind: f.kind, daily: f.daily, onCard: f.onCard };
  };
  const oneOffLine = (o: OneOff): Line => ({ source: 'oneoff', id: o.id, name: o.name, amount: o.amount });

  const fixedInLines = b.fixed.filter((f) => f.direction === 'in').map(fixedLine);
  const allOutLines = b.fixed.filter((f) => f.direction === 'out').map(fixedLine);
  // Charged to the card: part of the cycle's card spending, not a separate expense.
  const onCardLines = allOutLines.filter((l) => l.onCard && l.kind !== 'credit' && l.kind !== 'debt');
  const fixedOutLines = allOutLines.filter((l) => !onCardLines.includes(l));
  const mine = b.oneOffs.filter((o) => o.month === month);
  const extraInLines = mine.filter((o) => o.direction === 'in').map(oneOffLine);
  const extraOutLines = mine.filter((o) => o.direction === 'out').map(oneOffLine);

  const creditLine = fixedOutLines.find((l) => l.kind === 'credit') ?? null;
  const creditPlanned = creditLine?.amount ?? 0;
  const cycle = credit ? creditCycle(month, credit.statementDay) : null;
  const instLines = instalmentLines(b.instalments, month);
  const spent = (credit && cycle ? creditSpent(credit.txs, cycle) : 0) + total(onCardLines) + total(instLines);
  const creditClosed = !!cycle && (credit?.today ?? dateKey()) > cycle.end;
  const creditOver = creditLine ? Math.max(0, spent - creditPlanned) : 0;
  const creditCounted = creditClosed || !creditLine ? spent : Math.max(creditPlanned, spent);

  const fixedIn = total(fixedInLines);
  const fixedOut = total(fixedOutLines);
  const extraIn = total(extraInLines);
  const extraOut = total(extraOutLines);
  const income = fixedIn + extraIn;
  const expense = fixedOut - creditPlanned + extraOut + creditCounted;
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
    creditClosed,
    creditCounted,
    saving: income - expense,
    spendRatio: income > 0 ? expense / income : NaN,
    savingRate: income > 0 ? (income - expense) / income : NaN,
    dailyBucket: total(fixedOutLines.filter((l) => l.daily)),
    adjusted: [...fixedInLines, ...fixedOutLines].some((l) => l.overridden),
    incomeLines: [...fixedInLines, ...extraInLines],
    expenseLines: [...fixedOutLines.filter((l) => l.kind !== 'credit'), ...extraOutLines],
    creditLine,
    onCardLines,
    instalmentLines: instLines,
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
