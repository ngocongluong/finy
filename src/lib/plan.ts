// Long-range projection (5-10 years). Pure functions, monthly simulation.
import { debtNow, familyLoanDueMonth, familyLoanInterest, familyLoanOwed, fixedActive, fixedBase, loanBalance, loanMonth, loanPaidBefore, loanPeriodAt, monthFlow, netWorth, type Budget } from './finance';
import { shiftMonth } from './format';
import type { Account, PlanDebt, PlanGoal, PlanParams } from './types';

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
  /**
   * Net extra cash flow (income - expense) by simulation month, where 1 is
   * the current month: one-offs plus per-month adjustments of fixed items.
   */
  extraByMonth?: Record<number, number>;
}

/**
 * Fills in the plan's "follow my budget" placeholders from the cash-flow data:
 * fixed incomes, fixed expenses, loan repayments, and everything that makes a
 * particular month differ from the usual one (one-offs and per-month adjustments).
 */
export function resolvePlan(
  plan: PlanParams,
  budget: Budget,
  accounts: Account[],
  currentMonth: string,
  cash: { amount: number } | null = null,
): PlanInputs {
  const { fixed, oneOffs, overrides } = budget;
  const base = monthFlow({ fixed, oneOffs: [], overrides: {} }, currentMonth);
  const years = Math.min(10, Math.max(5, Math.round(plan.years)));
  // Repayments entered as fixed expenses, at what they are now; later changes count month by month below.
  const fixedDebts: PlanDebt[] = fixed
    .filter((f) => f.direction === 'out' && f.kind === 'debt' && fixedBase(f, currentMonth) > 0)
    .map((f): PlanDebt => ({ id: f.id, name: f.name, balance: null, ratePct: 0, monthlyPayment: fixedBase(f, currentMonth) }))
    // Bank loans are known exactly: what is still owed now, the rate and the payment.
    .concat(
      (budget.loans ?? [])
        .filter((l) => loanPaidBefore(l, currentMonth) < l.months)
        .map(
          (l): PlanDebt => ({
            id: l.id,
            name: l.name,
            balance: loanBalance(l, loanPaidBefore(l, currentMonth)),
            ratePct: loanPeriodAt(l, currentMonth).ratePct,
            monthlyPayment: loanMonth(l, currentMonth)?.payment ?? loanMonth(l, l.startMonth)?.payment ?? 0,
            // Month by month from now: later periods (new rate, prepayment) are followed exactly.
            schedule: Array.from({ length: years * 12 }, (_, i) => {
              const m = shiftMonth(currentMonth, i);
              const e = loanMonth(l, m);
              if (e) return { payment: e.payment + e.prepayment, balance: e.closing };
              return { payment: 0, balance: m < l.startMonth ? l.principal : 0 };
            }),
          }),
        ),
    )
    // Loans from family: nothing monthly, the principal and interest in one payment at the end.
    .concat(
      (budget.familyLoans ?? [])
        .filter((l) => familyLoanDueMonth(l) >= currentMonth)
        .map(
          (l): PlanDebt => ({
            id: l.id,
            name: l.name,
            balance: familyLoanOwed(l, currentMonth),
            ratePct: l.ratePct,
            monthlyPayment: 0,
            schedule: Array.from({ length: years * 12 }, (_, i) => {
              const m = shiftMonth(currentMonth, i);
              return { payment: m === familyLoanDueMonth(l) ? l.principal + familyLoanInterest(l) : 0, balance: familyLoanOwed(l, m, 'end') };
            }),
          }),
        ),
    );

  const extraByMonth: Record<number, number> = {};
  const lastMonth = shiftMonth(currentMonth, years * 12 - 1);
  const [y0, m0] = currentMonth.split('-').map(Number);
  const add = (month: string, net: number) => {
    if (month < currentMonth || month > lastMonth || net === 0) return;
    const [y1, m1] = month.split('-').map(Number);
    const index = (y1 - y0) * 12 + (m1 - m0) + 1;
    extraByMonth[index] = (extraByMonth[index] ?? 0) + net;
  };
  for (const o of oneOffs) add(o.month, o.direction === 'in' ? o.amount : -o.amount);
  // Money from family still to come in (its repayment is in the debts above).
  for (const l of budget.familyLoans ?? []) if (l.receive) add(l.startMonth, l.principal);
  // Fixed items whose amount changes over time (periods, or limited to some months):
  // the base month includes what applies now; other months differ by the change.
  for (const f of fixed) {
    if (!f.periods?.length && !f.fromMonth && !f.toMonth) continue;
    const now = fixedBase(f, currentMonth);
    const sign = f.direction === 'in' ? 1 : -1;
    for (let m = currentMonth; m <= lastMonth; m = shiftMonth(m, 1)) {
      const change = fixedBase(f, m) - now;
      if (change) add(m, sign * change);
    }
  }
  // A month's own amount replaces the usual amount of that month (only where the item applies).
  for (const [month, byId] of Object.entries(overrides)) {
    for (const f of fixed) {
      const amount = byId[f.id];
      if (amount === undefined || !fixedActive(f, month)) continue;
      const usual = fixedBase(f, month);
      add(month, f.direction === 'in' ? amount - usual : usual - amount);
    }
  }

  return {
    years,
    // Accounts when the user keeps them; otherwise money on hand minus what is owed on all loans.
    startNetWorth: plan.startNetWorth ?? (accounts.length || !cash ? netWorth(accounts) : cash.amount - debtNow(budget, currentMonth)),
    monthlyIncome: plan.monthlyIncome ?? base.fixedIn,
    monthlyExpense: plan.monthlyExpense ?? base.fixedOut - base.debtPayment,
    incomeGrowthPct: plan.incomeGrowthPct,
    inflationPct: plan.inflationPct,
    returnPct: plan.returnPct,
    debts: plan.debts ?? fixedDebts,
    goals: plan.goals,
    extraByMonth,
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
      if (d.schedule) {
        const e = d.schedule[m - 1];
        debtPaid += e?.payment ?? 0;
        d.balance = e ? e.balance : 0;
        continue;
      }
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

    const saved = income - expense - debtPaid + (inp.extraByMonth?.[m] ?? 0);
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
