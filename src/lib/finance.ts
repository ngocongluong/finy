// Pure calculations: the monthly cash-flow table, the credit-card statement
// cycle, net worth, daily allowance.
import { dateKey, daysInMonth, shiftMonth, uid } from './format';
import type { Account, FamilyLoan, FixedItem, FixedPeriod, Instalment, Loan, LoanPeriod, MonthBudget, OneOff, Overrides, Tx } from './types';

/** Everything the user enters to describe their monthly money. */
export interface Budget {
  fixed: FixedItem[];
  oneOffs: OneOff[];
  overrides: Overrides;
  /** Card instalment plans; optional so older callers and tests stay valid. */
  instalments?: Instalment[];
  /** Bank loans; their monthly payment is a fixed expense while they run. */
  loans?: Loan[];
  /** Loans from family: one repayment (principal + interest) at the end of the term. */
  familyLoans?: FamilyLoan[];
}

// ---- loans from family (one repayment at the end) ----

/** A stored loan from family in shape: whole đồng, a term of 1–600 months, a rate of 0–100 %. */
export function normalizeFamilyLoan(raw: unknown): FamilyLoan {
  const r = raw as Partial<FamilyLoan>;
  return {
    id: r.id ?? '',
    name: r.name ?? '',
    principal: Math.max(0, Math.round(Number(r.principal) || 0)),
    startMonth: typeof r.startMonth === 'string' && /^\d{4}-\d{2}$/.test(r.startMonth) ? r.startMonth : '1970-01',
    months: Math.min(600, Math.max(1, Math.round(Number(r.months) || 1))),
    ratePct: Math.min(100, Math.max(0, Number(r.ratePct) || 0)),
    ...(r.receive ? { receive: true } : {}),
  };
}

/** The month the money is paid back: the term after the month it was received. */
export function familyLoanDueMonth(l: Pick<FamilyLoan, 'startMonth' | 'months'>): string {
  return shiftMonth(l.startMonth, l.months);
}

/** Simple interest for the whole term: principal × rate a year × years. */
export function familyLoanInterest(l: Pick<FamilyLoan, 'principal' | 'ratePct' | 'months'>): number {
  return Math.round((l.principal * l.ratePct * l.months) / 100 / 12);
}

/**
 * Owed on a loan from family: nothing before the month the money is received
 * or once it is paid back; in between the principal plus the interest so far.
 * 'during' a month: as it stands in that month (the principal in the month the
 * money comes in, everything in the month it is due). At the 'end' of a month:
 * after that month (a month's more interest; nothing after the due month).
 */
export function familyLoanOwed(l: FamilyLoan, month: string, at: 'during' | 'end' = 'during'): number {
  const k = monthsBetween(l.startMonth, month) + (at === 'end' ? 1 : 0);
  if (k < (at === 'end' ? 1 : 0) || k > l.months) return 0;
  return l.principal + familyLoanInterest({ ...l, months: k });
}

/** Everything owed on loans in `month` as it starts: bank loans before that month's payment, loans from family. */
export function debtNow(b: Pick<Budget, 'loans' | 'familyLoans'>, month: string): number {
  return loanDebtNow(b.loans, month) + (b.familyLoans ?? []).reduce((s, l) => s + familyLoanOwed(l, month), 0);
}

/** Everything owed on loans at the end of `month`: after its bank payments and family repayments. */
export function debtAtEnd(b: Pick<Budget, 'loans' | 'familyLoans'>, month: string): number {
  return loanDebtNow(b.loans, shiftMonth(month, 1)) + (b.familyLoans ?? []).reduce((s, l) => s + familyLoanOwed(l, month, 'end'), 0);
}

// ---- bank loans (annuity, in periods) ----

/** Monthly payment that repays `principal` over `months` at `ratePct` a year, interest charged monthly on the balance. */
export function annuityPayment(principal: number, ratePct: number, months: number): number {
  const n = Math.max(1, Math.round(months));
  const r = ratePct / 100 / 12;
  if (r <= 0) return Math.round(principal / n);
  return Math.round((principal * r) / (1 - Math.pow(1 + r, -n)));
}

/** The month of the last payment. */
export function loanEndMonth(l: Pick<Loan, 'startMonth' | 'months'>): string {
  return shiftMonth(l.startMonth, Math.max(1, l.months) - 1);
}

/**
 * Brings a stored loan into shape: older app versions kept one rate and one
 * bank figure on the loan itself; periods are sorted, the first starts with the
 * first payment, and periods outside the term, on the same month, or after the
 * period that pays the loan off are dropped.
 */
export function normalizeLoan(raw: unknown): Loan {
  const r = raw as Partial<Loan> & { ratePct?: number; paymentOverride?: number | null };
  const startMonth = r.startMonth ?? '1970-01';
  const months = Math.min(600, Math.max(1, Math.round(r.months ?? 1)));
  const end = shiftMonth(startMonth, months - 1);
  const given: LoanPeriod[] = r.periods?.length
    ? r.periods
    : [{ from: startMonth, ratePct: r.ratePct ?? 0, prepayment: 0, paymentOverride: r.paymentOverride ?? null }];
  const sorted = [...given].sort((a, b) => a.from.localeCompare(b.from));
  const periods: LoanPeriod[] = [];
  for (const p of sorted) {
    const first = periods.length === 0;
    if (!first && (p.from <= startMonth || p.from > end || p.from === periods[periods.length - 1].from)) continue;
    const payOff = !first && !!p.payOff;
    periods.push({
      from: first ? startMonth : p.from,
      ratePct: Math.min(100, Math.max(0, Number(p.ratePct) || 0)),
      prepayment: first ? 0 : Math.max(0, Math.round(Number(p.prepayment) || 0)),
      paymentOverride: !payOff && p.paymentOverride && p.paymentOverride > 0 ? Math.round(p.paymentOverride) : null,
      ...(payOff ? { payOff: true } : {}),
    });
    // Nothing is owed once the loan is paid off: later periods have nothing to change.
    if (payOff) break;
  }
  return { id: r.id ?? '', name: r.name ?? '', principal: Math.max(0, Math.round(r.principal ?? 0)), months, startMonth, periods };
}

/** One month of a loan's repayment schedule. */
export interface LoanMonth {
  month: string;
  /** 1-based number of the payment. */
  part: number;
  /** Index of the period the month belongs to. */
  period: number;
  /** Paid early at the start of this month (only when a period starts here). */
  prepayment: number;
  /** The prepayment settles the loan: everything that was owed. */
  payOff?: boolean;
  /** Owed at the start of the month, after any prepayment. */
  opening: number;
  interest: number;
  payment: number;
  /** Owed after this month's payment. */
  closing: number;
}

const scheduleCache = new WeakMap<Loan, LoanMonth[]>();

/**
 * The whole repayment schedule, month by month. When a period starts, its
 * prepayment comes off the balance and the payment is recalculated over the
 * months left (or taken from the bank's figure). The last payment clears what
 * rounding left.
 */
export function loanSchedule(loan: Loan): LoanMonth[] {
  const cached = scheduleCache.get(loan);
  if (cached) return cached;
  const l = normalizeLoan(loan);
  const out: LoanMonth[] = [];
  let balance = l.principal;
  let pi = -1;
  let rate = 0;
  let payment = 0;
  for (let k = 0; k < l.months; k++) {
    const month = shiftMonth(l.startMonth, k);
    let prepayment = 0;
    let payOff = false;
    if (pi + 1 < l.periods.length && l.periods[pi + 1].from === month) {
      pi++;
      const p = l.periods[pi];
      if (pi > 0) {
        // Paying off takes whatever is owed by then, however the earlier periods turned out.
        payOff = !!p.payOff;
        prepayment = payOff ? balance : Math.min(balance, p.prepayment);
        balance -= prepayment;
      }
      rate = p.ratePct / 100 / 12;
      payment = p.paymentOverride ?? annuityPayment(balance, p.ratePct, l.months - k);
    }
    const interest = Math.round(balance * rate);
    const due = balance + interest;
    const paid = k === l.months - 1 ? due : Math.min(payment, due);
    out.push({ month, part: k + 1, period: pi, prepayment, ...(payOff ? { payOff } : {}), opening: balance, interest, payment: paid, closing: due - paid });
    balance = due - paid;
  }
  scheduleCache.set(loan, out);
  return out;
}

/** The schedule entry for a month, or null outside the loan's term. */
export function loanMonth(l: Loan, month: string): LoanMonth | null {
  const i = monthsBetween(l.startMonth, month);
  return i >= 0 && i < l.months ? loanSchedule(l)[i] : null;
}

/** The payment due in `month` (default: the first payment). 0 outside the term. */
export function loanPayment(l: Loan, month: string = l.startMonth): number {
  return loanMonth(l, month)?.payment ?? 0;
}

/** Which payment of the loan falls in a month (1-based), or null when none does. */
export function loanPart(l: Loan, month: string): number | null {
  return loanMonth(l, month)?.part ?? null;
}

/** Outstanding balance after `paid` payments. */
export function loanBalance(l: Loan, paid: number): number {
  if (paid <= 0) return l.principal;
  const s = loanSchedule(l);
  return s[Math.min(paid, s.length) - 1].closing;
}

/** Payments made before `month` (the payment due in `month` itself not included). */
export function loanPaidBefore(l: Loan, month: string): number {
  return Math.min(l.months, Math.max(0, monthsBetween(l.startMonth, month)));
}

/**
 * The last month anything is paid: the month the loan is paid off when that
 * happens early, otherwise the last payment of the term.
 */
export function loanFinalMonth(l: Loan): string {
  const s = loanSchedule(l);
  for (let i = s.length - 1; i >= 0; i--) if (s[i].payment > 0 || s[i].prepayment > 0) return s[i].month;
  return loanEndMonth(l);
}

/** Total interest over the life of the loan. */
export function loanTotalInterest(l: Loan): number {
  return loanSchedule(l).reduce((s, m) => s + m.interest, 0);
}

/** The period a month falls in (the first before the loan starts, the last after it ends). */
export function loanPeriodAt(l: Loan, month: string): LoanPeriod {
  const periods = normalizeLoan(l).periods;
  let p = periods[0];
  for (const x of periods) if (x.from <= month) p = x;
  return p;
}

/** Per period: when it runs, what is owed when it starts (before and after prepayment), and its payment. */
export interface LoanPeriodSummary {
  index: number;
  from: string;
  to: string;
  ratePct: number;
  /** Owed when the period starts, before its prepayment. */
  carried: number;
  prepayment: number;
  /** Owed when the period starts, after its prepayment: the amount the period repays. */
  principal: number;
  payment: number;
  /** The payment as calculated, whatever the bank's figure. */
  calculated: number;
  paymentOverride: number | null;
  /** The period pays off everything owed when it starts. */
  payOff: boolean;
}

export function loanPeriods(loan: Loan): LoanPeriodSummary[] {
  const l = normalizeLoan(loan);
  const s = loanSchedule(loan);
  const end = loanEndMonth(l);
  return l.periods.map((p, i) => {
    const first = s[monthsBetween(l.startMonth, p.from)];
    const to = i + 1 < l.periods.length ? shiftMonth(l.periods[i + 1].from, -1) : end;
    const left = monthsBetween(p.from, end) + 1;
    return {
      index: i,
      from: p.from,
      to,
      ratePct: p.ratePct,
      carried: first.opening + first.prepayment,
      prepayment: first.prepayment,
      principal: first.opening,
      payment: first.payment,
      calculated: annuityPayment(first.opening, p.ratePct, left),
      paymentOverride: p.paymentOverride,
      payOff: !!p.payOff,
    };
  });
}

function monthsBetween(from: string, to: string): number {
  const [y1, m1] = from.split('-').map(Number);
  const [y2, m2] = to.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

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

const inPeriod = (p: FixedPeriod, month: string) => (p.from === null || month >= p.from) && (p.to === null || month <= p.to);

/** The period of a fixed item that covers a month, or null (also for items without periods). */
export function fixedPeriodAt(item: Pick<FixedItem, 'periods'>, month: string): FixedPeriod | null {
  let hit: FixedPeriod | null = null;
  for (const p of item.periods ?? []) if (inPeriod(p, month)) hit = p;
  return hit;
}

/**
 * Whether a fixed item applies in a month: inside one of its periods when it
 * has them, otherwise inside its range of months (unset = every month).
 */
export function fixedActive(item: Pick<FixedItem, 'fromMonth' | 'toMonth' | 'periods'>, month: string): boolean {
  if (item.periods?.length) return fixedPeriodAt(item, month) !== null;
  return (!item.fromMonth || month >= item.fromMonth) && (!item.toMonth || month <= item.toMonth);
}

/** A fixed item's usual amount in a month: its period's amount, or its one amount; 0 when it does not apply. */
export function fixedBase(item: FixedItem, month: string): number {
  if (item.periods?.length) return fixedPeriodAt(item, month)?.amount ?? 0;
  return fixedActive(item, month) ? item.amount : 0;
}

/** A fixed item's amount in a given month: the month's own adjustment if there is one. */
export function fixedAmount(b: Pick<Budget, 'overrides'>, item: FixedItem, month: string): number {
  const o = b.overrides[month]?.[item.id];
  return o === undefined ? fixedBase(item, month) : o;
}

/**
 * Periods in shape: valid months, each from ≤ to, sorted, whole đồng. A
 * period that starts inside the previous one ends that one the month before
 * (the later entry wins on the same start); only the first may be open at the
 * start and only the last open at the end.
 */
export function normalizeFixedPeriods(raw: unknown): FixedPeriod[] {
  if (!Array.isArray(raw)) return [];
  const month = (m: unknown) => (typeof m === 'string' && /^\d{4}-\d{2}$/.test(m) ? m : null);
  const list = raw
    .filter((p) => p && typeof p === 'object')
    .map((p: { from?: unknown; to?: unknown; amount?: unknown }): FixedPeriod => {
      let from = month(p.from);
      let to = month(p.to);
      if (from && to && to < from) [from, to] = [to, from];
      return { from, to, amount: Math.max(0, Math.round(Number(p.amount) || 0)) };
    })
    .sort((a, b) => (a.from ?? '').localeCompare(b.from ?? ''));
  const out: FixedPeriod[] = [];
  for (const p of list) {
    const prev = out[out.length - 1];
    if (prev && (prev.from ?? '') === (p.from ?? '')) {
      out[out.length - 1] = p;
      continue;
    }
    // p.from is set here: only the first period sorted can be open at the start.
    if (prev && (prev.to === null || prev.to >= p.from!)) prev.to = shiftMonth(p.from!, -1);
    out.push({ ...p });
  }
  return out;
}

/** The amount to show for periods in `month`: the one that applies, else the next to start, else the last. */
export function fixedPeriodsAmountAt(periods: FixedPeriod[], month: string): number {
  const now = periods.find((p) => inPeriod(p, month));
  if (now) return now.amount;
  return (periods.find((p) => p.from !== null && p.from > month) ?? periods[periods.length - 1])?.amount ?? 0;
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
  source: 'fixed' | 'oneoff' | 'loan';
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
  /** The card plan as one line: total of all plan items, named by their notes joined with commas. */
  creditLine: Line | null;
  /** The individual card plan items. */
  creditPlanLines: Line[];
  /** Fixed items charged to the card each cycle; included in creditSpent. */
  onCardLines: Line[];
  /** Instalment parts due in this statement month; included in creditSpent. */
  instalmentLines: InstalmentLine[];
}

const total = (list: { amount: number }[]) => list.reduce((s, i) => s + i.amount, 0);

export function monthFlow(b: Budget, month: string, credit?: CreditData): MonthFlow {
  const fixedLine = (f: FixedItem): Line => {
    const amount = fixedAmount(b, f, month);
    // The usual amount of this month: the period's amount for items that change over time.
    const base = fixedBase(f, month);
    return { source: 'fixed', id: f.id, name: f.name, amount, base, overridden: amount !== base, kind: f.kind, daily: f.daily, onCard: f.onCard };
  };
  const oneOffLine = (o: OneOff): Line => ({ source: 'oneoff', id: o.id, name: o.name, amount: o.amount });

  // Items limited to a range of months count only in those months.
  const active = b.fixed.filter((f) => fixedActive(f, month));
  const fixedInLines = active.filter((f) => f.direction === 'in').map(fixedLine);
  const allOutLines = active.filter((f) => f.direction === 'out').map(fixedLine);
  // Charged to the card: part of the cycle's card spending, not a separate expense.
  const onCardLines = allOutLines.filter((l) => l.onCard && l.kind !== 'credit' && l.kind !== 'debt');
  const fixedOutLines = allOutLines.filter((l) => !onCardLines.includes(l));
  const mine = b.oneOffs.filter((o) => o.month === month);
  const extraInLines = mine.filter((o) => o.direction === 'in').map(oneOffLine);
  const extraOutLines = mine.filter((o) => o.direction === 'out').map(oneOffLine);
  // Loans from family happen once: the money received (when it is not in the money on hand
  // yet) and the one repayment of principal and interest at the end of the term.
  for (const f of b.familyLoans ?? []) {
    if (f.receive && f.startMonth === month) extraInLines.push({ source: 'loan', id: `${f.id}#receive`, name: `Nhận tiền vay: ${f.name}`, amount: f.principal });
    if (familyLoanDueMonth(f) === month) {
      extraOutLines.push({ source: 'loan', id: `${f.id}#due`, name: `Trả vay: ${f.name}`, amount: f.principal + familyLoanInterest(f), kind: 'debt' });
    }
  }

  // The card plan can be several items, each named by its note; outside it shows as one line:
  // the total, named by the notes joined with commas.
  const creditPlanLines = fixedOutLines.filter((l) => l.kind === 'credit');
  const creditPlanned = total(creditPlanLines);
  const creditLine: Line | null = creditPlanLines.length
    ? {
        source: 'fixed',
        id: 'credit-plan',
        name: creditPlanLines.map((l) => l.name).filter(Boolean).join(', ') || 'Dự chi tín dụng',
        amount: creditPlanned,
        base: total(creditPlanLines.map((l) => ({ amount: l.base ?? l.amount }))),
        overridden: creditPlanLines.some((l) => l.overridden),
        kind: 'credit',
      }
    : null;
  const cycle = credit ? creditCycle(month, credit.statementDay) : null;
  const instLines = instalmentLines(b.instalments, month);
  const spent = (credit && cycle ? creditSpent(credit.txs, cycle) : 0) + total(onCardLines) + total(instLines);
  const creditClosed = !!cycle && (credit?.today ?? dateKey()) > cycle.end;
  const creditOver = creditLine ? Math.max(0, spent - creditPlanned) : 0;
  const creditCounted = creditClosed || !creditLine ? spent : Math.max(creditPlanned, spent);

  const fixedIn = total(fixedInLines);
  // Bank loans: a fixed loan repayment in each month they run.
  const loanLines: Line[] = [];
  for (const l of b.loans ?? []) {
    const e = loanMonth(l, month);
    if (!e) continue;
    if (e.prepayment > 0) {
      // Paid early when a period starts; "payoff" when it settles everything still owed.
      const tag = e.payOff ? 'payoff' : 'prepay';
      loanLines.push({ source: 'loan', id: `${l.id}#${tag}`, name: `${e.payOff ? 'Tất toán' : 'Trả trước'}: ${l.name}`, amount: e.prepayment, kind: 'debt' });
    }
    if (e.payment > 0) loanLines.push({ source: 'loan', id: l.id, name: l.name, amount: e.payment, kind: 'debt' });
  }
  const fixedOut = total(fixedOutLines) + total(loanLines);
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
    debtPayment: total(fixedOutLines.filter((l) => l.kind === 'debt')) + total(loanLines),
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
    expenseLines: [...fixedOutLines.filter((l) => l.kind !== 'credit'), ...loanLines, ...extraOutLines],
    creditLine,
    creditPlanLines,
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

// ---- money on hand, projected ----

/**
 * Money expected at the end of each month: what the user has now plus every
 * month's saving from the month it was entered up to and including that
 * month. Months before it have no projection (null).
 */
export function projectedCash(b: Budget, cash: { amount: number; month: string } | null, months: string[], credit?: CreditData): Map<string, number | null> {
  const out = new Map<string, number | null>();
  if (!cash || !months.length) {
    for (const m of months) out.set(m, null);
    return out;
  }
  const last = [...months].sort()[months.length - 1];
  const byMonth = new Map<string, number>();
  let running = cash.amount;
  for (let m = cash.month; m <= last; m = shiftMonth(m, 1)) {
    running += monthFlow(b, m, credit).saving;
    byMonth.set(m, running);
  }
  // In the order the months were asked for.
  for (const m of months) out.set(m, byMonth.get(m) ?? null);
  return out;
}

/** What is still owed on all bank loans at the start of `month`. */
export function loanDebtNow(loans: Loan[] | undefined, month: string): number {
  return (loans ?? []).reduce((s, l) => s + loanBalance(l, loanPaidBefore(l, month)), 0);
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
