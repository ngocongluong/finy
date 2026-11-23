/** A source of income or an expense that repeats every month. */
export interface FixedItem {
  id: string;
  name: string;
  amount: number;
  direction: 'in' | 'out';
  /**
   * Only for direction "out":
   * - expense: ordinary spending
   * - debt: a loan repayment (feeds the long-range plan's debts)
   * - credit: a planned credit-card spend per statement cycle, named by its
   *   note; the plan is the sum of these items, and actual card spending is
   *   compared against it.
   */
  kind?: 'expense' | 'debt' | 'credit';
  /**
   * Only for ordinary expenses: charged to the credit card every month (an
   * instalment plan, a subscription the bank sends no email for). Its amount
   * is added to each statement cycle's card spending instead of being a
   * separate expense.
   */
  onCard?: boolean;
  /** Only for direction "out": the bucket that day-to-day spending is tracked against. */
  daily?: boolean;
  /**
   * The months the item applies in (YYYY-MM, both included). Unset = every
   * month. Credit-card plan items use it for "this month only" (from = to) and
   * "from month to month".
   */
  fromMonth?: string;
  toMonth?: string;
  /**
   * An amount that changes over time: each period has its own monthly amount.
   * When set, the item counts only in the months a period covers (at that
   * period's amount), `fromMonth` / `toMonth` are not used, and `amount` is
   * the amount that applied when the item was saved (for lists and messages).
   */
  periods?: FixedPeriod[];
}

/**
 * A stretch of months in which a fixed item has one monthly amount. Periods
 * are sorted and do not overlap; months between two periods have none.
 */
export interface FixedPeriod {
  /** First month (YYYY-MM); null = from the beginning (first period only). */
  from: string | null;
  /** Last month (YYYY-MM), included; null = no end (last period only). */
  to: string | null;
  amount: number;
}

/** An expected one-off income or expense in one specific month. */
export interface OneOff {
  id: string;
  month: string; // YYYY-MM
  name: string;
  amount: number;
  direction: 'in' | 'out';
}

/**
 * One stretch of a loan with its own terms. A period runs from `from` until
 * the month before the next period starts; the last one until the loan ends.
 */
export interface LoanPeriod {
  /** First month (YYYY-MM) of the period. The first period starts with the first payment. */
  from: string;
  /** Annual interest rate in this period, percent (fixed or the expected floating rate). */
  ratePct: number;
  /** Paid early at the start of the period, VND. Always 0 for the first period. */
  prepayment: number;
  /**
   * The payment the bank actually charges in this period, when it differs
   * from the calculation (day-count interest, fees). null = calculated.
   */
  paymentOverride: number | null;
  /**
   * Everything still owed is paid at the start of the period (the loan is
   * settled; `prepayment` then records that amount). Never on the first
   * period; no period follows one.
   */
  payOff?: boolean;
}

/**
 * A bank loan repaid in equal monthly payments (principal + interest). At the
 * start of every period the payment is recalculated from the balance owed
 * (after any prepayment), the period's rate and the months left.
 */
export interface Loan {
  id: string;
  name: string;
  /** Amount borrowed, VND. */
  principal: number;
  /** Number of monthly payments over the whole loan. */
  months: number;
  /** Month (YYYY-MM) of the first payment. */
  startMonth: string;
  /** At least one; sorted by `from`; the first starts at `startMonth`. */
  periods: LoanPeriod[];
}

/**
 * Money borrowed from family or friends. Nothing is paid monthly: the
 * principal, plus simple interest for the whole term when there is interest,
 * is paid back in one go at the end of the term.
 */
export interface FamilyLoan {
  id: string;
  name: string;
  /** Amount borrowed, VND. */
  principal: number;
  /** Month (YYYY-MM) the money is received. */
  startMonth: string;
  /** Term in months; the repayment falls this many months after startMonth. */
  months: number;
  /** Annual interest, percent, simple; 0 = no interest. */
  ratePct: number;
  /** Count the money received as income in startMonth (it is not in the money on hand yet). */
  receive?: boolean;
}

/** A purchase paid off on the credit card in equal monthly parts. */
export interface Instalment {
  id: string;
  name: string;
  /** Total to pay back, VND. */
  total: number;
  /** Number of monthly parts. */
  months: number;
  /** Statement month (YYYY-MM) of the first part. */
  startMonth: string;
}

/**
 * Per-month adjustments of fixed items: overrides[month][fixedItemId] is the
 * amount to use in that month instead of the item's usual amount (0 = skipped).
 */
export type Overrides = Record<string, Record<string, number>>;

/** What the bank's latest card email says about the credit card. */
export interface CreditCardInfo {
  last4: string;
  /** Outstanding balance ("dư nợ hiện tại"). */
  balance: number;
  /** Available credit ("số dư khả dụng"). */
  available: number;
  /** When the bank reported it. */
  asOf: number;
}

// Legacy per-month budget (app versions before the fixed / one-off model). Only read for migration.
export type BudgetKind = 'expense' | 'debt' | 'saving';

export interface BudgetItem {
  id: string;
  name: string;
  amount: number;
  kind: BudgetKind;
  /** The bucket that day-to-day spending is tracked against. */
  daily?: boolean;
}

export interface MonthBudget {
  month: string; // YYYY-MM
  income: number;
  items: BudgetItem[];
}

export type AccountKind = 'cash' | 'bank' | 'saving' | 'invest' | 'debt';

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  /** Always positive. Accounts of kind "debt" are subtracted from the total. */
  balance: number;
}

export interface Tx {
  id: string;
  ts: number;
  date: string; // YYYY-MM-DD (local)
  amount: number;
  direction: 'out' | 'in';
  note: string;
  source: 'manual' | 'hsbc';
  /** Whether this counts against the daily spending allowance. */
  countsDaily: boolean;
  /** Gmail message id for imported transactions (dedupe key). */
  extId?: string;
  /** Paid with the credit card: counted in the statement cycle it falls in. */
  credit?: boolean;
}

export interface PlanDebt {
  id: string;
  name: string;
  /** Outstanding balance. null = unknown, treated as a payment that never ends. */
  balance: number | null;
  ratePct: number;
  monthlyPayment: number;
  /**
   * Bank loans only: the exact schedule from the current month on (index 0 =
   * this month): what is paid (payment + any prepayment) and what is owed
   * after. Used instead of the single rate and payment, so rate changes and
   * prepayments in later periods are followed. Never stored.
   */
  schedule?: { payment: number; balance: number }[];
}

export interface PlanGoal {
  id: string;
  name: string;
  amount: number;
  /** Year offset from now (1 = one year from now). */
  year: number;
}

export interface PlanParams {
  years: number; // 5..10
  /** null = use the current total of all accounts. */
  startNetWorth: number | null;
  /** null = use the total of the fixed monthly incomes. */
  monthlyIncome: number | null;
  /** null = use the total of the fixed monthly expenses (loan repayments excluded). */
  monthlyExpense: number | null;
  incomeGrowthPct: number;
  inflationPct: number;
  returnPct: number;
  /** null = derive from the fixed monthly expenses marked as loan repayments. */
  debts: PlanDebt[] | null;
  goals: PlanGoal[];
}

export type HomeSectionId = 'credit' | 'month' | 'budget' | 'recent' | 'plan' | 'custom';

export type MetricKey =
  | 'income'
  | 'expense'
  | 'saving'
  | 'extraIncome'
  | 'extraExpense'
  | 'debtPayment'
  | 'creditSpent'
  | 'creditPlanned'
  | 'spendRatio'
  | 'savingRate'
  | 'netWorth'
  | 'dailyAllowance'
  | 'spentToday'
  | 'spentMonth'
  | 'projectedNetWorth';

export interface CustomCard {
  id: string;
  title: string;
  lines: { label: string; metric?: MetricKey; text?: string }[];
}

export interface UiColors {
  bg: string;
  card: string;
  cardAlt: string;
  text: string;
  muted: string;
  accent: string;
  onAccent: string;
  positive: string;
  negative: string;
  warning: string;
  border: string;
}

export interface UiConfig {
  colors: UiColors;
  radius: number;
  fontScale: number;
  density: 'comfortable' | 'compact';
  amountFormat: 'full' | 'compact';
  title: string;
  home: { id: HomeSectionId; visible: boolean }[];
  customCards: CustomCard[];
}

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Short descriptions of what Finy changed while answering. */
  actions?: string[];
  error?: boolean;
}

export interface AppSettings {
  autoLockSec: number;
  hideAmountsOnOpen: boolean;
  /** Day of the month the credit-card statement closes (1-28). */
  statementDay: number;
  gmailQuery: string;
  gmailEmail: string | null;
  lastSyncTs: number | null;
  /** Outcome of the most recent sync, shown on the Transactions tab. */
  lastSyncReport: { ts: number; text: string; error: boolean } | null;
  /** Overrides the key embedded at build time. */
  apiKeyOverride: string | null;
}

/** Money the user has now, as entered, and the month it was entered (the projection starts there). */
export interface CashOnHand {
  amount: number;
  month: string; // YYYY-MM
}

/** First-run data bundled at build time from secrets/seed.json. */
export interface Seed {
  /** Money on hand; applied once when the app has none yet. */
  cashOnHand?: number;
  fixed?: Omit<FixedItem, 'id'>[];
  oneOffs?: Omit<OneOff, 'id'>[];
  accounts?: { name: string; kind: AccountKind; balance: number }[];
}
