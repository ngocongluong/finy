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
}

export interface PlanDebt {
  id: string;
  name: string;
  /** Outstanding balance. null = unknown, treated as a payment that never ends. */
  balance: number | null;
  ratePct: number;
  monthlyPayment: number;
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
  /** null = use this month's income from the budget. */
  monthlyIncome: number | null;
  /** null = use this month's expense items from the budget. */
  monthlyExpense: number | null;
  incomeGrowthPct: number;
  inflationPct: number;
  returnPct: number;
  /** null = derive from "debt" items of this month's budget. */
  debts: PlanDebt[] | null;
  goals: PlanGoal[];
}

export type HomeSectionId = 'today' | 'month' | 'networth' | 'budget' | 'recent' | 'plan' | 'custom';

export type MetricKey =
  | 'income'
  | 'totalOut'
  | 'expense'
  | 'saving'
  | 'debtPayment'
  | 'remaining'
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
  gmailQuery: string;
  gmailEmail: string | null;
  lastSyncTs: number | null;
  /** Overrides the key embedded at build time. */
  apiKeyOverride: string | null;
}

export interface Seed {
  month?: { income?: number; items?: { name: string; amount: number; kind: BudgetKind; daily?: boolean }[] };
  accounts?: { name: string; kind: AccountKind; balance: number }[];
}
