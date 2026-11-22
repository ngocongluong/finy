// Long-range projection (5-10 years). Pure functions, monthly simulation.
import { monthSummary, netWorth } from './finance';
import type { Account, MonthBudget, PlanDebt, PlanGoal, PlanParams } from './types';

export const DEFAULT_PLAN: PlanParams = {
  years: 10,
  startNetWorth: null,
  monthlyIncome: null,
  monthlyExpense: null,
  incomeGrowthPct: 5,
  inflationPct: 4,
  returnPct: 6,
  debts: null,
  goals: [],
};

/** Plan inputs with every "use the budget" placeholder resolved to a number. */
export interface PlanInputs {
  years: number;
  startNetWorth: number;
  monthlyIncome: number;
  monthlyExpense: number;
  incomeGrowthPct: number;
  inflationPct: number;
  returnPct: number;
  debts: PlanDebt[];
  goals: PlanGoal[];
}

export function resolvePlan(plan: PlanParams, budget: MonthBudget | undefined, accounts: Account[]): PlanInputs {
  const s = monthSummary(budget);
  const budgetDebts: PlanDebt[] = (budget?.items ?? [])
    .filter((i) => i.kind === 'debt' && i.amount > 0)
    .map((i) => ({ id: i.id, name: i.name, balance: null, ratePct: 0, monthlyPayment: i.amount }));
  return {
    years: Math.min(10, Math.max(5, Math.round(plan.years))),
    startNetWorth: plan.startNetWorth ?? netWorth(accounts),
    monthlyIncome: plan.monthlyIncome ?? s.income,
    monthlyExpense: plan.monthlyExpense ?? s.expense,
    incomeGrowthPct: plan.incomeGrowthPct,
    inflationPct: plan.inflationPct,
    returnPct: plan.returnPct,
    debts: plan.debts ?? budgetDebts,
    goals: plan.goals,
  };
}

export interface YearRow {
  year: number; // 0 = today
  /** Liquid assets (savings and investments). */
  assets: number;
  /** Outstanding balance of debts whose balance is known. */
  debt: number;
  netWorth: number;
  /** Net worth in today's money. */
  realNetWorth: number;
  /** Amount saved during this year (can be negative). */
  savedThisYear: number;
  monthlyIncome: number;
  monthlyExpense: number;
}

export interface Projection {
  rows: YearRow[];
  /** Month index (1-based) at which every known debt balance is paid off; null if none or never within the horizon. */
  debtFreeMonth: number | null;
  /** First month in which assets drop below zero; null when it never happens. */
  shortfallMonth: number | null;
}

export function project(inp: PlanInputs): Projection {
  const months = inp.years * 12;
  const rMonthly = Math.pow(1 + inp.returnPct / 100, 1 / 12) - 1;
  const debts = inp.debts.map((d) => ({ ...d }));
  const knownDebt = () => debts.reduce((s, d) => s + (d.balance ?? 0), 0);
  const hadKnownDebt = knownDebt() > 0;

  // Start: the entered net worth already nets out debts, so assets = net worth + known debt.
  let assets = inp.startNetWorth + knownDebt();
  let debtFreeMonth: number | null = null;
  let shortfallMonth: number | null = null;
  let savedThisYear = 0;

  const rows: YearRow[] = [
    {
      year: 0,
      assets,
      debt: knownDebt(),
      netWorth: inp.startNetWorth,
      realNetWorth: inp.startNetWorth,
      savedThisYear: 0,
      monthlyIncome: inp.monthlyIncome,
      monthlyExpense: inp.monthlyExpense,
    },
  ];

  for (let m = 1; m <= months; m++) {
    const yearIdx = Math.floor((m - 1) / 12);
    const income = inp.monthlyIncome * Math.pow(1 + inp.incomeGrowthPct / 100, yearIdx);
    const expense = inp.monthlyExpense * Math.pow(1 + inp.inflationPct / 100, yearIdx);

    let debtPaid = 0;
    for (const d of debts) {
      if (d.balance === null) {
        debtPaid += d.monthlyPayment; // unknown balance: a payment that never ends
        continue;
      }
      if (d.balance <= 0) continue;
      const withInterest = d.balance * (1 + d.ratePct / 100 / 12);
      const pay = Math.min(d.monthlyPayment, withInterest);
      d.balance = withInterest - pay;
      if (d.balance < 1) d.balance = 0;
      debtPaid += pay;
    }
    if (hadKnownDebt && debtFreeMonth === null && knownDebt() === 0) debtFreeMonth = m;

    const saved = income - expense - debtPaid;
    assets = assets * (1 + (assets > 0 ? rMonthly : 0)) + saved;
    savedThisYear += saved;

    if (m % 12 === 0) {
      const year = m / 12;
      for (const g of inp.goals) if (g.year === year) assets -= g.amount;
      const nw = assets - knownDebt();
      rows.push({
        year,
        assets,
        debt: knownDebt(),
        netWorth: nw,
        realNetWorth: nw / Math.pow(1 + inp.inflationPct / 100, year),
        savedThisYear,
        monthlyIncome: income,
        monthlyExpense: expense,
      });
      savedThisYear = 0;
    }
    if (shortfallMonth === null && assets < 0) shortfallMonth = m;
  }

  return { rows, debtFreeMonth, shortfallMonth };
}

export type ScenarioId = 'conservative' | 'base' | 'optimistic';

export const SCENARIOS: { id: ScenarioId; label: string; note: string }[] = [
  { id: 'conservative', label: 'Thận trọng', note: 'lãi −2, thu nhập tăng −2, lạm phát +1 điểm %' },
  { id: 'base', label: 'Cơ sở', note: 'theo giả định bạn nhập' },
  { id: 'optimistic', label: 'Lạc quan', note: 'lãi +2, thu nhập tăng +2 điểm %' },
];

export function scenarioInputs(inp: PlanInputs, id: ScenarioId): PlanInputs {
  if (id === 'conservative') {
    return {
      ...inp,
      returnPct: Math.max(0, inp.returnPct - 2),
      incomeGrowthPct: inp.incomeGrowthPct - 2,
      inflationPct: inp.inflationPct + 1,
    };
  }
  if (id === 'optimistic') {
    return { ...inp, returnPct: inp.returnPct + 2, incomeGrowthPct: inp.incomeGrowthPct + 2 };
  }
  return inp;
}

export function projectAll(inp: PlanInputs): Record<ScenarioId, Projection> {
  return {
    conservative: project(scenarioInputs(inp, 'conservative')),
    base: project(inp),
    optimistic: project(scenarioInputs(inp, 'optimistic')),
  };
}

/** First year (1-based) at which net worth reaches `target` in the projection, or null. */
export function yearReaching(p: Projection, target: number): number | null {
  const row = p.rows.find((r) => r.year > 0 && r.netWorth >= target);
  return row ? row.year : null;
}
