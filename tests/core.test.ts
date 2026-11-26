import assert from 'node:assert/strict';
import { test } from 'node:test';
import { annuityPayment, CARD_KEY, cashMonth, frequentNotes, creditCycle, normalizePaid, paidSummary, debtAtEnd, debtNow, familyLoanDueMonth, familyLoanInterest, familyLoanOwed, fixedPeriodAt, fixedPeriodsAmountAt, loanDebtNow, loanFinalMonth, loanMonth, loanPeriods, normalizeFixedPeriods, loanSchedule, normalizeLoan, projectedCash, creditSpent, cycleMonthOf, dailyStats, flowTable, instalmentAmount, loanBalance, loanPaidBefore, loanPart, loanPayment, loanSpend, loanTotalInterest, instalmentLines, instalmentPart, markCreditItem, migrateLegacyBudget, monthFlow, netWorth, type Budget } from '../src/lib/finance';
import { daysInMonth, fmtInput, fmtPct, fmtTime, fmtVND, maskMoney, monthShort, parseAmount, shiftMonth } from '../src/lib/format';
import { ALLOWED_SENDER_DOMAINS, fxToVnd, htmlToText, looksLikeTransaction, parseHsbcCardEmail, senderAllowed } from '../src/lib/mailText';
import { project, projectAll, resolvePlan, DEFAULT_PLAN, yearReaching, type PlanInputs } from '../src/lib/plan';
import { applyUiPatch, DEFAULT_UI, normalizeUi } from '../src/lib/theme';
import type { CashNote, FamilyLoan, FixedItem, Loan, OneOff, Tx } from '../src/lib/types';

// Made-up household used as the fixture.
const fixed: FixedItem[] = [
  { id: 'i1', name: 'Lương', amount: 45_000_000, direction: 'in' },
  { id: 'i2', name: 'Cho thuê phòng', amount: 5_000_000, direction: 'in' },
  { id: 'o1', name: 'Trả góp', amount: 5_000_000, direction: 'out', kind: 'debt' },
  { id: 'o2', name: 'Tiền nhà', amount: 10_000_000, direction: 'out', kind: 'expense' },
  { id: 'o3', name: 'Học phí', amount: 4_000_000, direction: 'out', kind: 'expense' },
  { id: 'o4', name: 'Chi tiêu hằng ngày', amount: 9_000_000, direction: 'out', kind: 'expense', daily: true },
  { id: 'o5', name: 'Điện nước', amount: 2_000_000, direction: 'out', kind: 'expense' },
];

const oneOffs: OneOff[] = [
  { id: 'x1', month: '2027-01', name: 'Thưởng Tết', amount: 40_000_000, direction: 'in' },
  { id: 'x2', month: '2027-01', name: 'Quà Tết', amount: 15_000_000, direction: 'out' },
  { id: 'x3', month: '2027-02', name: 'Sửa xe', amount: 60_000_000, direction: 'out' },
  { id: 'x4', month: '2026-09', name: 'Đã qua', amount: 7_000_000, direction: 'out' },
];

const B: Budget = { fixed, oneOffs, overrides: {} };

/** A one-period loan in the current shape. */
const mkLoan = (o: { principal: number; ratePct: number; months: number; startMonth: string; paymentOverride?: number | null }): Loan => ({
  id: 'l',
  name: 'Vay',
  principal: o.principal,
  months: o.months,
  startMonth: o.startMonth,
  periods: [{ from: o.startMonth, ratePct: o.ratePct, prepayment: 0, paymentOverride: o.paymentOverride ?? null }],
});

test('money formatting', () => {
  assert.equal(fmtVND(20_000_000), '20.000.000 đ');
  assert.equal(fmtVND(-1_500_000), '−1.500.000 đ');
  assert.equal(fmtVND(20_000_000, 'compact'), '20 tr');
  assert.equal(fmtVND(1_250_000_000, 'compact'), '1,25 tỷ');
  assert.equal(fmtVND(150_000, 'compact'), '150k');
  assert.equal(fmtPct(0.4634, 2), '46,34%');
  assert.equal(fmtInput('01500000'), '1.500.000');
});

test('amount parsing accepts how people type money', () => {
  assert.equal(parseAmount('1.500.000'), 1_500_000);
  assert.equal(parseAmount('1500000'), 1_500_000);
  assert.equal(parseAmount('20tr'), 20_000_000);
  assert.equal(parseAmount('1,5tr'), 1_500_000);
  assert.equal(parseAmount('150k'), 150_000);
  assert.equal(parseAmount('1.2 tỷ'), 1_200_000_000);
  assert.equal(parseAmount(''), 0);
  assert.equal(parseAmount('abc'), 0);
});

test('money in chat text is hidden, dates and percentages are not', () => {
  assert.equal(
    maskMoney('Tháng 12 bạn xài 38 triệu, vượt 3.000.000 đ (8,6%) — kỳ 15/11–14/12, ly cà phê 62k.'),
    'Tháng 12 bạn xài •••, vượt ••• (8,6%) — kỳ 15/11–14/12, ly cà phê •••.',
  );
  assert.equal(maskMoney('Còn 1,2 tỷ và 250.000 VND'), 'Còn ••• và •••');
  assert.equal(fmtTime(new Date(2026, 10, 20, 9, 5, 7).getTime()), '09:05:07');
});

test('month helpers', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(daysInMonth('2026-11'), 30);
  assert.equal(daysInMonth('2028-02'), 29);
  assert.equal(monthShort('2027-01'), 'T1/27');
});

test('a month with only fixed items: saving is income minus expenses', () => {
  const f = monthFlow(B, '2026-11');
  assert.equal(f.income, 50_000_000);
  assert.equal(f.expense, 30_000_000);
  assert.equal(f.saving, 20_000_000);
  assert.equal(f.extraIn, 0);
  assert.equal(f.extraOut, 0);
  assert.equal(f.debtPayment, 5_000_000);
  assert.equal(f.dailyBucket, 9_000_000);
  assert.equal(f.spendRatio, 0.6);
  assert.equal(f.savingRate, 0.4);
});

test('one-offs change only their own month', () => {
  const jan = monthFlow(B, '2027-01');
  assert.equal(jan.extraIn, 40_000_000);
  assert.equal(jan.extraOut, 15_000_000);
  assert.equal(jan.income, 90_000_000);
  assert.equal(jan.expense, 45_000_000);
  assert.equal(jan.saving, 45_000_000);

  const feb = monthFlow(B, '2027-02');
  assert.equal(feb.saving, 20_000_000 - 60_000_000); // a shortfall month
  assert.equal(monthFlow(B, '2027-03').saving, 20_000_000);
});

test('nothing entered yet: zeros, and ratios are undefined rather than wrong', () => {
  const f = monthFlow({ fixed: [], oneOffs: [], overrides: {} }, '2026-11');
  assert.equal(f.income, 0);
  assert.equal(f.saving, 0);
  assert.ok(Number.isNaN(f.spendRatio));
  assert.ok(Number.isNaN(f.savingRate));
});

test('the cash-flow table lists consecutive months with a running total', () => {
  const rows = flowTable(B, '2026-11', 5);
  assert.deepEqual(rows.map((r) => r.month), ['2026-11', '2026-12', '2027-01', '2027-02', '2027-03']);
  assert.deepEqual(rows.map((r) => r.saving), [20_000_000, 20_000_000, 45_000_000, -40_000_000, 20_000_000]);
  assert.deepEqual(rows.map((r) => r.cumulative), [20_000_000, 40_000_000, 85_000_000, 45_000_000, 65_000_000]);
  // The one-off dated before the table starts is not counted anywhere.
  assert.equal(rows.reduce((s, r) => s + r.extraOut, 0), 75_000_000);
});

test('old per-month budgets convert to fixed items', () => {
  const migrated = migrateLegacyBudget({
    month: '2026-11',
    income: 50_000_000,
    items: [
      { id: 'a', name: 'Trả góp', amount: 5_000_000, kind: 'debt' },
      { id: 'b', name: 'Chi tiêu hằng ngày', amount: 9_000_000, kind: 'expense', daily: true },
      { id: 'c', name: 'Chi thêm', amount: 0, kind: 'expense' }, // zero placeholder: dropped
      { id: 'd', name: 'Để dành', amount: 18_000_000, kind: 'saving' }, // saving is calculated now: dropped
    ],
  });
  assert.deepEqual(
    migrated.map((f) => [f.name, f.amount, f.direction, f.kind, f.daily]),
    [
      ['Thu nhập', 50_000_000, 'in', undefined, undefined],
      ['Trả góp', 5_000_000, 'out', 'debt', undefined],
      ['Chi tiêu hằng ngày', 9_000_000, 'out', 'expense', true],
    ],
  );
  assert.equal(migrated[1].id, 'a'); // ids are kept
  assert.equal(monthFlow({ fixed: migrated, oneOffs: [], overrides: {} }, '2026-11').saving, 36_000_000);
  assert.deepEqual(migrateLegacyBudget({ month: '2026-11', income: 0, items: [] }), []);
});

test('a fixed item can have its own amount in one month without changing the others', () => {
  const b: Budget = { ...B, oneOffs: [], overrides: { '2026-12': { i1: 60_000_000, o3: 0 } } };
  const dec = monthFlow(b, '2026-12');
  assert.equal(dec.fixedIn, 65_000_000); // salary 60 instead of 45, plus rent 5
  assert.equal(dec.fixedOut, 26_000_000); // tuition skipped this month
  assert.equal(dec.saving, 39_000_000);
  assert.ok(dec.adjusted);
  const salary = dec.incomeLines.find((l) => l.id === 'i1')!;
  assert.deepEqual([salary.amount, salary.base, salary.overridden], [60_000_000, 45_000_000, true]);
  assert.equal(dec.expenseLines.find((l) => l.id === 'o3')!.amount, 0);

  const jan = monthFlow(b, '2027-01');
  assert.equal(jan.saving, 20_000_000);
  assert.ok(!jan.adjusted);
  // The long-range plan sees the difference in that month only: +15 income, +4 not spent.
  assert.deepEqual(resolvePlan(DEFAULT_PLAN, b, [], '2026-11').extraByMonth, { 2: 19_000_000 });
});

test('income and expense lines are listed separately, fixed before one-offs', () => {
  const jan = monthFlow(B, '2027-01');
  assert.deepEqual(jan.incomeLines.map((l) => [l.name, l.source]), [['Lương', 'fixed'], ['Cho thuê phòng', 'fixed'], ['Thưởng Tết', 'oneoff']]);
  assert.deepEqual(jan.expenseLines.map((l) => l.name), ['Trả góp', 'Tiền nhà', 'Học phí', 'Chi tiêu hằng ngày', 'Điện nước', 'Quà Tết']);
  assert.equal(jan.creditLine, null);
});

test('credit-card statement cycle: closes on the statement day and belongs to that month', () => {
  assert.deepEqual(creditCycle('2026-12', 14), { month: '2026-12', start: '2026-11-15', end: '2026-12-14' });
  assert.deepEqual(creditCycle('2027-01', 14), { month: '2027-01', start: '2026-12-15', end: '2027-01-14' });
  assert.deepEqual(creditCycle('2027-03', 28), { month: '2027-03', start: '2027-03-01', end: '2027-03-28' }); // after a 28-day February
  assert.equal(cycleMonthOf('2026-11-14', 14), '2026-11');
  assert.equal(cycleMonthOf('2026-11-15', 14), '2026-12');
  assert.equal(cycleMonthOf('2026-12-31', 14), '2027-01');
});

test('card spending: an open cycle counts the plan (or more), a closed one counts what was spent', () => {
  const card = (date: string, amount: number, extra: Partial<Tx> = {}): Tx => ({
    id: date + amount, ts: 0, date, amount, direction: 'out', note: '', source: 'hsbc', countsDaily: false, credit: true, ...extra,
  });
  const txs = [
    card('2026-11-14', 9_000_000), // previous cycle
    card('2026-11-15', 2_000_000),
    card('2026-12-01', 5_000_000),
    card('2026-12-14', 1_000_000),
    card('2026-12-10', 500_000, { direction: 'in' }), // refund
    card('2026-12-15', 7_000_000), // next cycle
    card('2026-12-02', 3_000_000, { credit: undefined }), // not a card transaction
  ];
  assert.equal(creditSpent(txs, creditCycle('2026-12', 14)), 7_500_000);

  const withPlan = (planned: number): Budget => ({
    fixed: [...fixed, { id: 'cc', name: 'Thẻ tín dụng', amount: planned, direction: 'out', kind: 'credit' }],
    oneOffs: [],
    overrides: {},
  });
  const open = { txs, statementDay: 14, today: '2026-12-01' };
  const closed = { txs, statementDay: 14, today: '2026-12-15' };
  const under = monthFlow(withPlan(8_000_000), '2026-12', open);
  assert.deepEqual([under.creditPlanned, under.creditSpent, under.creditOver, under.creditClosed], [8_000_000, 7_500_000, 0, false]);
  assert.equal(under.creditCounted, 8_000_000); // still open: the plan is what is budgeted
  assert.equal(under.expense, 30_000_000 + 8_000_000);
  assert.deepEqual(under.creditPlanLines.map((l) => l.id), ['cc']); // the plan item behind the combined line
  assert.ok(!under.expenseLines.some((l) => l.id === 'cc')); // shown in its own section

  const over = monthFlow(withPlan(6_000_000), '2026-12', open);
  assert.equal(over.creditOver, 1_500_000);
  assert.equal(over.creditCounted, 7_500_000);
  assert.equal(over.expense, 30_000_000 + 7_500_000);
  assert.equal(over.saving, 50_000_000 - 37_500_000);

  // Closed on the 14th: the actual total replaces the plan, also when it is lower.
  const closedUnder = monthFlow(withPlan(8_000_000), '2026-12', closed);
  assert.deepEqual([closedUnder.creditClosed, closedUnder.creditCounted, closedUnder.expense], [true, 7_500_000, 37_500_000]);
  // The statement day itself is still inside the cycle.
  assert.equal(monthFlow(withPlan(8_000_000), '2026-12', { ...open, today: '2026-12-14' }).creditClosed, false);
  // A future month's cycle is open, so it is budgeted at the plan.
  assert.equal(monthFlow(withPlan(8_000_000), '2027-01', closed).creditCounted, 8_000_000);

  // Without a credit plan, card spending is counted as it is.
  const none = monthFlow(B, '2026-12', open);
  assert.deepEqual([none.creditSpent, none.creditOver, none.creditCounted, none.expense], [7_500_000, 0, 7_500_000, 37_500_000]);
});

test('an expense named like a credit card becomes the credit plan, once and only when unambiguous', () => {
  const list = [
    { id: 'a', name: 'Tiền Tín dụng', amount: 5, direction: 'out' as const, kind: 'expense' as const },
    { id: 'b', name: 'Tiền nhà', amount: 9, direction: 'out' as const, kind: 'expense' as const },
  ];
  assert.equal(markCreditItem(list).find((f) => f.id === 'a')!.kind, 'credit');
  assert.equal(markCreditItem(list).find((f) => f.id === 'b')!.kind, 'expense');
  const two = [...list, { id: 'c', name: 'Credit card 2', amount: 1, direction: 'out' as const, kind: 'expense' as const }];
  assert.deepEqual(markCreditItem(two), two);
  const already = [{ ...list[0], kind: 'expense' as const }, { id: 'd', name: 'Thẻ', amount: 1, direction: 'out' as const, kind: 'credit' as const }];
  assert.deepEqual(markCreditItem(already), already);
});

test('the HSBC card-transaction email is read without a model', () => {
  const body = `\tKính gởi Quý khách,

Chúng tôi xin thông báo thẻ tín dụng X1234 của Quý khách vừa thực hiện giao dịch với số tiền 185,000 VND tại HIGHLANDS COFFEE Q1 vào ngày 5/12/2026.

Dư nợ hiện tại là 12,345,678 VND và số dư khả dụng là 87,654,322 VND

Nếu Quý khách cần thêm thông tin, vui lòng liên hệ Trung Tâm Dịch Vụ Khách Hàng`;
  assert.deepEqual(parseHsbcCardEmail(body), {
    last4: '1234', amount: 185_000, currency: 'VND', merchant: 'HIGHLANDS COFFEE Q1', date: '2026-12-05', balance: 12_345_678, available: 87_654_322,
  });
  // Line breaks in odd places (HTML-to-text) and a missing balance sentence.
  const wrapped = 'thẻ tín dụng X9876 của Quý khách\nvừa thực hiện giao dịch với số tiền\n1,250,000 VND tại SHOP A.B vào ngày 20/11/2026.';
  assert.deepEqual(parseHsbcCardEmail(wrapped), {
    last4: '9876', amount: 1_250_000, currency: 'VND', merchant: 'SHOP A.B', date: '2026-11-20', balance: null, available: null,
  });
  // A foreign-currency amount keeps its decimals and its currency so the caller can set it aside.
  const usd = parseHsbcCardEmail('thẻ tín dụng X1234 của Quý khách vừa thực hiện giao dịch với số tiền 12.50 USD tại APP STORE vào ngày 1/1/2027.');
  assert.deepEqual([usd?.amount, usd?.currency], [12.5, 'USD']);
  assert.equal(parseHsbcCardEmail('Sao kê thẻ tín dụng tháng 11 của Quý khách đã sẵn sàng.'), null);
  assert.equal(parseHsbcCardEmail('thẻ tín dụng X1 của Quý khách vừa thực hiện giao dịch với số tiền 10 VND tại A vào ngày 40/13/2026.'), null);
});

test('net worth subtracts debts', () => {
  assert.equal(
    netWorth([
      { id: '1', name: 'A', kind: 'bank', balance: 100 },
      { id: '2', name: 'B', kind: 'debt', balance: 30 },
    ]),
    70,
  );
});

test('daily allowance adapts to what was already spent', () => {
  const tx = (date: string, amount: number, extra: Partial<Tx> = {}): Tx => ({
    id: date + amount, ts: 0, date, amount, direction: 'out', note: '', source: 'manual', countsDaily: true, ...extra,
  });
  const txs = [
    tx('2026-11-01', 4_000_000),
    tx('2026-11-20', 500_000),
    tx('2026-11-21', 200_000),
    tx('2026-11-21', 900_000, { countsDaily: false }), // loan repayment: ignored
    tx('2026-11-21', 300_000, { direction: 'in' }), // income: ignored
    tx('2026-10-31', 999_999), // other month: ignored
  ];
  const d = dailyStats(9_000_000, txs, '2026-11-21');
  assert.equal(d.daysLeft, 10);
  assert.equal(d.spentToday, 200_000);
  assert.equal(d.spentMonth, 4_700_000);
  assert.equal(d.allowance, (9_000_000 - 4_500_000) / 10);
  assert.equal(d.leftMonth, 4_300_000);
});

const flat: PlanInputs = {
  years: 5, startNetWorth: 100, monthlyIncome: 30, monthlyExpense: 20,
  incomeGrowthPct: 0, inflationPct: 0, returnPct: 0, debts: [], goals: [],
};

test('projection with no growth is plain arithmetic', () => {
  const p = project(flat);
  assert.equal(p.rows.length, 6);
  assert.equal(p.rows[5].netWorth, 100 + 10 * 60);
  assert.equal(p.rows[1].savedThisYear, 120);
  assert.equal(p.shortfallMonth, null);
});

test('projection: returns compound, goals are deducted, real value is deflated', () => {
  const p = project({ ...flat, monthlyIncome: 0, monthlyExpense: 0, returnPct: 10, inflationPct: 5, goals: [{ id: 'g', name: 'x', amount: 10, year: 1 }] });
  assert.ok(Math.abs(p.rows[1].netWorth - (110 - 10)) < 1e-6);
  assert.ok(Math.abs(p.rows[1].realNetWorth - 100 / 1.05) < 1e-6);
});

test('projection: a known debt is paid off and frees cash flow; unknown balance never ends', () => {
  const withDebt = project({ ...flat, debts: [{ id: 'd', name: 'loan', balance: 60, ratePct: 0, monthlyPayment: 5 }] });
  assert.equal(withDebt.debtFreeMonth, 12);
  assert.equal(withDebt.rows[0].netWorth, 100);
  // Net worth is unchanged by repaying a 0% loan: assets fall, debt falls.
  assert.equal(withDebt.rows[5].netWorth, 100 + 10 * 60);
  const endless = project({ ...flat, debts: [{ id: 'd', name: 'loan', balance: null, ratePct: 0, monthlyPayment: 5 }] });
  assert.equal(endless.debtFreeMonth, null);
  assert.equal(endless.rows[5].netWorth, 100 + 5 * 60);
});

test('projection flags a shortfall and scenarios are ordered', () => {
  const p = project({ ...flat, startNetWorth: 10, monthlyIncome: 10, monthlyExpense: 15 });
  assert.equal(p.shortfallMonth, 3);
  const all = projectAll({ ...flat, returnPct: 6, incomeGrowthPct: 5, inflationPct: 4 });
  const end = (id: 'conservative' | 'base' | 'optimistic') => all[id].rows[5].netWorth;
  assert.ok(end('conservative') < end('base') && end('base') < end('optimistic'));
  assert.equal(yearReaching(project(flat), 340), 2);
  assert.equal(yearReaching(project(flat), 1e9), null);
});

test('projection applies one-off cash flows in their month', () => {
  const p = project({ ...flat, extraByMonth: { 3: 50, 14: -30 } });
  assert.equal(p.rows[1].netWorth, 100 + 120 + 50);
  assert.equal(p.rows[2].netWorth, 100 + 240 + 50 - 30);
  assert.equal(p.rows[5].netWorth, 100 + 600 + 20);
});

test('plan defaults follow the fixed items, one-offs and accounts', () => {
  const inp = resolvePlan(DEFAULT_PLAN, B, [{ id: '1', name: 'A', kind: 'saving', balance: 500 }], '2026-11');
  assert.equal(inp.monthlyIncome, 50_000_000);
  assert.equal(inp.monthlyExpense, 25_000_000); // loan repayments are modelled as debts, not expenses
  assert.equal(inp.startNetWorth, 500);
  assert.deepEqual(inp.debts.map((d) => [d.name, d.monthlyPayment, d.balance]), [['Trả góp', 5_000_000, null]]);
  // Month 1 is 2026-11, so January 2027 is month 3 and February is month 4; the past one-off is ignored.
  assert.deepEqual(inp.extraByMonth, { 3: 25_000_000, 4: -60_000_000 });
  assert.equal(resolvePlan({ ...DEFAULT_PLAN, years: 99 }, { ...B, oneOffs: [] }, [], '2026-11').years, 10);
  // A manual override wins over the fixed items.
  assert.equal(resolvePlan({ ...DEFAULT_PLAN, monthlyIncome: 1 }, { ...B, oneOffs: [] }, [], '2026-11').monthlyIncome, 1);
});

test('UI patches: valid changes apply, unreadable or malformed ones are rejected', () => {
  assert.deepEqual(normalizeUi(DEFAULT_UI), DEFAULT_UI);
  assert.deepEqual(normalizeUi(null), DEFAULT_UI);

  const ok = applyUiPatch(DEFAULT_UI, { colors: { accent: '#34D399' }, radius: 99, amountFormat: 'compact', home: [{ id: 'plan', visible: true }, { id: 'month', visible: false }] });
  assert.ok('ui' in ok);
  if ('ui' in ok) {
    assert.equal(ok.ui.colors.accent, '#34D399');
    assert.equal(ok.ui.radius, 28); // clamped
    assert.equal(ok.ui.amountFormat, 'compact');
    assert.deepEqual(ok.ui.home.slice(0, 2), [{ id: 'plan', visible: true }, { id: 'month', visible: false }]);
    assert.equal(ok.ui.home.length, DEFAULT_UI.home.length); // nothing lost
  }

  const unreadable = applyUiPatch(DEFAULT_UI, { colors: { text: '#101216' } });
  assert.ok('errors' in unreadable && unreadable.errors.some((e) => e.includes('colors.text')));
  const malformed = applyUiPatch(DEFAULT_UI, { colors: { accent: 'red' } });
  assert.ok('errors' in malformed);
  const unknown = applyUiPatch(DEFAULT_UI, { home: [{ id: 'nope' as never, visible: true }] });
  assert.ok('errors' in unknown);
});

test('a saved layout: removed sections are dropped, new ones go where the default has them', () => {
  const old = { ...DEFAULT_UI, home: [{ id: 'plan', visible: true }, { id: 'today', visible: false }, { id: 'month', visible: false }] } as never;
  const ui = normalizeUi(old);
  const home = ui.home.map((h) => h.id);
  assert.deepEqual(home.slice(0, 3), ['credit', 'plan', 'month']); // credit first, as in the default; saved order kept
  assert.ok(!home.includes('today' as never));
  assert.equal(home.length, DEFAULT_UI.home.length);
  assert.equal(ui.home.find((h) => h.id === 'month')!.visible, false);
  assert.deepEqual(ui.colors, DEFAULT_UI.colors); // the rest of the saved config is not thrown away
});

test('a saved custom card that uses a metric which no longer exists keeps its text', () => {
  const res = applyUiPatch(DEFAULT_UI, { customCards: [{ id: 'c', title: 'Cũ', lines: [{ label: 'Tồn', metric: 'remaining' as never }, { label: 'Thu', metric: 'income' }] }] });
  assert.ok('ui' in res);
  if ('ui' in res) {
    assert.deepEqual(res.ui.customCards[0].lines, [
      { label: 'Tồn', metric: undefined, text: undefined },
      { label: 'Thu', metric: 'income', text: undefined },
    ]);
  }
});

test('only mail from the bank is trusted', () => {
  const domains = ALLOWED_SENDER_DOMAINS;
  assert.ok(senderAllowed('HSBC <alerts@notification.hsbc.com.hk>', domains));
  assert.ok(!senderAllowed('x@hsbc.com.hk.evil.io', domains));
  assert.ok(senderAllowed('HSBC Vietnam <alerts@hsbc.com.vn>', domains));
  assert.ok(senderAllowed('no-reply@notification.hsbc.com', domains));
  assert.ok(!senderAllowed('HSBC <alerts@hsbc.com.vn.evil.io>', domains));
  assert.ok(!senderAllowed('"alerts@hsbc.com.vn" <phish@gmail.com>', domains));
  assert.ok(!senderAllowed('x@nothsbc.com', domains));
});

test('a foreign-currency card purchase is priced from the balance change, else estimated', () => {
  // Balance went from 30,000,000 to 31,320,500 after a 50 USD purchase: that is what the bank booked.
  assert.deepEqual(fxToVnd(50, 'USD', 30_000_000, 31_320_500), { amount: 1_320_500, estimated: false });
  // A payment landed in between (the balance fell): not usable, fall back to the rate.
  assert.deepEqual(fxToVnd(10, 'USD', 30_000_000, 12_000_000), { amount: 265_000, estimated: true });
  assert.deepEqual(fxToVnd(10, 'usd', null, 5_000_000), { amount: 265_000, estimated: true });
  assert.equal(fxToVnd(10, 'XYZ', null, null), null);
});

test('a fixed expense charged to the card is part of every cycle, not a separate expense', () => {
  const b: Budget = {
    fixed: [
      ...fixed,
      { id: 'cc', name: 'Thẻ tín dụng', amount: 35_000_000, direction: 'out', kind: 'credit' },
      { id: 'inst', name: 'Trả góp điện thoại', amount: 3_000_000, direction: 'out', kind: 'expense', onCard: true },
    ],
    oneOffs: [],
    overrides: {},
  };
  const tx: Tx = { id: 't', ts: 0, date: '2026-11-20', amount: 30_000_000, direction: 'out', note: '', source: 'hsbc', countsDaily: false, credit: true };
  const closed = monthFlow(b, '2026-12', { txs: [tx], statementDay: 14, today: '2026-12-20' });
  assert.equal(closed.creditSpent, 33_000_000);
  assert.equal(closed.creditCounted, 33_000_000);
  assert.equal(closed.expense, 30_000_000 + 33_000_000); // not counted a second time
  assert.ok(!closed.expenseLines.some((l) => l.id === 'inst'));
  assert.deepEqual(closed.onCardLines.map((l) => l.id), ['inst']);
});

test('an instalment is split evenly, the remainder on the last part, and adds up exactly', () => {
  const p = { id: 'p', name: 'Laptop', total: 10_000_000, months: 3, startMonth: '2026-11' };
  assert.deepEqual([1, 2, 3].map((n) => instalmentAmount(p, n)), [3_333_333, 3_333_333, 3_333_334]);
  assert.equal([1, 2, 3].reduce((s, n) => s + instalmentAmount(p, n), 0), 10_000_000);
  assert.deepEqual(['2026-10', '2026-11', '2027-01', '2027-02'].map((m) => instalmentPart(p, m)), [null, 1, 3, null]);
  assert.deepEqual(instalmentLines([p], '2026-12'), [{ id: 'p', name: 'Laptop', amount: 3_333_333, part: 2, months: 3 }]);
});

test('instalment parts are added to the card spending of their statement cycle', () => {
  const b: Budget = {
    fixed: [...fixed, { id: 'cc', name: 'Thẻ tín dụng', amount: 20_000_000, direction: 'out', kind: 'credit' }],
    oneOffs: [],
    overrides: {},
    instalments: [
      { id: 'a', name: 'Điện thoại', total: 12_000_000, months: 12, startMonth: '2026-06' }, // part 7 in December
      { id: 'b', name: 'Đã xong', total: 3_000_000, months: 3, startMonth: '2026-01' },
    ],
  };
  const tx: Tx = { id: 't', ts: 0, date: '2026-11-20', amount: 15_000_000, direction: 'out', note: '', source: 'hsbc', countsDaily: false, credit: true };
  const closed = monthFlow(b, '2026-12', { txs: [tx], statementDay: 14, today: '2026-12-20' });
  assert.equal(closed.creditSpent, 16_000_000);
  assert.deepEqual(closed.instalmentLines.map((l) => [l.name, l.part, l.amount]), [['Điện thoại', 7, 1_000_000]]);
  assert.equal(closed.expense, 30_000_000 + 16_000_000);
  // After the last part the plan stops adding anything.
  assert.equal(monthFlow(b, '2027-06', { txs: [], statementDay: 14, today: '2027-07-01' }).creditSpent, 0);
});

test('a bank loan: equal monthly payments that repay it exactly', () => {
  // 1,000,000,000 at 12%/year over 12 months: the standard annuity formula.
  assert.equal(annuityPayment(1_000_000_000, 12, 12), 88_848_789);
  assert.equal(annuityPayment(1_200_000, 0, 12), 100_000); // no interest: principal / months
  const loan = mkLoan({ principal: 1_000_000_000, ratePct: 12, months: 12, startMonth: '2026-01' });
  assert.equal(loanBalance(loan, 12), 0); // the last payment clears what rounding left
  assert.equal(loanBalance(loan, 0), 1_000_000_000);
  assert.ok(Math.abs(loanBalance(loan, 1) - (1_010_000_000 - 88_848_789)) <= 1); // one month of interest, minus the payment
  assert.ok(Math.abs(loanTotalInterest(loan) - (88_848_789 * 12 - 1_000_000_000)) <= 12); // rounding of monthly interest
  assert.deepEqual(['2025-12', '2026-01', '2026-12', '2027-01'].map((m) => loanPart(loan, m)), [null, 1, 12, null]);
  assert.equal(loanPaidBefore(loan, '2026-04'), 3);
  // The bank's own figure wins over the calculation.
  assert.equal(loanPayment(mkLoan({ principal: 1_000_000_000, ratePct: 12, months: 12, startMonth: '2026-01', paymentOverride: 90_000_000 })), 90_000_000);
});

test('a loan is a fixed loan repayment while it runs, and an exact debt in the long-range plan', () => {
  const loan = { ...mkLoan({ principal: 1_000_000_000, ratePct: 12, months: 12, startMonth: '2026-11' }), name: 'Vay mua nhà' };
  const b: Budget = { fixed, oneOffs: [], overrides: {}, loans: [loan] };
  const nov = monthFlow(b, '2026-11');
  assert.equal(nov.expense, 30_000_000 + 88_848_789);
  assert.equal(nov.debtPayment, 5_000_000 + 88_848_789);
  assert.ok(nov.expenseLines.some((l) => l.source === 'loan' && l.amount === 88_848_789));
  assert.equal(monthFlow(b, '2027-11').expense, 30_000_000); // paid off: no longer an expense
  const inp = resolvePlan(DEFAULT_PLAN, b, [], '2027-01');
  const d = inp.debts.find((x) => x.id === 'l')!;
  assert.deepEqual([d.balance, d.ratePct, d.monthlyPayment], [loanBalance(loan, 2), 12, 88_848_789]);
});

test('the card plan can be several items: one line with the total and the notes joined', () => {
  const b: Budget = {
    fixed: [
      ...fixed,
      { id: 'c1', name: 'Ăn uống', amount: 10_000_000, direction: 'out', kind: 'credit' },
      { id: 'c2', name: 'Xăng xe', amount: 3_000_000, direction: 'out', kind: 'credit' },
    ],
    oneOffs: [],
    overrides: {},
  };
  const f = monthFlow(b, '2026-12', { txs: [], statementDay: 14, today: '2026-12-01' });
  assert.equal(f.creditPlanned, 13_000_000);
  assert.deepEqual([f.creditLine?.name, f.creditLine?.amount], ['Ăn uống, Xăng xe', 13_000_000]);
  assert.deepEqual(f.creditPlanLines.map((l) => l.id), ['c1', 'c2']);
  assert.ok(!f.expenseLines.some((l) => l.kind === 'credit')); // not listed one by one among expenses
  assert.equal(f.expense, 30_000_000 + 13_000_000);
});

test('projected money: what is on hand plus each month\'s saving, from the month it was entered', () => {
  const b: Budget = { fixed, oneOffs, overrides: {} };
  const p = projectedCash(b, { amount: 100_000_000, month: '2026-12' }, ['2026-11', '2026-12', '2027-01', '2027-02']);
  // 20M a month; January has the bonus (+45M saving), February the repair (-40M).
  assert.deepEqual([...p.values()], [null, 120_000_000, 165_000_000, 125_000_000]);
  assert.deepEqual([...projectedCash(b, null, ['2026-12']).values()], [null]);
});

test('money owed on loans now, and the plan starting from cash minus that', () => {
  const loan = mkLoan({ principal: 1_000_000_000, ratePct: 12, months: 12, startMonth: '2026-11' });
  assert.equal(loanDebtNow([loan], '2026-11'), 1_000_000_000);
  assert.equal(loanDebtNow([loan], '2027-01'), loanBalance(loan, 2));
  const b: Budget = { fixed, oneOffs: [], overrides: {}, loans: [loan] };
  assert.equal(resolvePlan(DEFAULT_PLAN, b, [], '2026-11', { amount: 1_500_000_000 }).startNetWorth, 500_000_000);
  // Accounts, when kept, still win.
  assert.equal(resolvePlan(DEFAULT_PLAN, b, [{ id: 'a', name: 'A', kind: 'bank', balance: 7 }], '2026-11', { amount: 1 }).startNetWorth, 7);
});

test('a loan in periods: a prepayment and a new rate recalculate the payment over the months left', () => {
  const loan: Loan = {
    id: 'l',
    name: 'Vay',
    principal: 1_200_000_000,
    months: 24,
    startMonth: '2026-01',
    periods: [
      { from: '2026-01', ratePct: 6, prepayment: 0, paymentOverride: null },
      { from: '2026-07', ratePct: 9, prepayment: 300_000_000, paymentOverride: null },
    ],
  };
  const [p1, p2] = loanPeriods(loan);
  assert.equal(p1.payment, annuityPayment(1_200_000_000, 6, 24));
  assert.deepEqual([p1.from, p1.to, p2.from, p2.to], ['2026-01', '2026-06', '2026-07', '2027-12']);
  // Period 2 starts from what was owed after six payments, minus the prepayment, at 9% over 18 months.
  const owed = loanBalance(loan, 6);
  assert.equal(p2.carried, owed);
  assert.equal(p2.principal, owed - 300_000_000);
  assert.equal(p2.payment, annuityPayment(owed - 300_000_000, 9, 18));
  assert.equal(loanBalance(loan, 24), 0);

  // The month of the prepayment: it is spent that month, next to the new payment.
  const b: Budget = { fixed: [], oneOffs: [], overrides: {}, loans: [loan] };
  const july = monthFlow(b, '2026-07');
  assert.deepEqual(july.expenseLines.map((l) => [l.name, l.amount]), [['Trả trước: Vay', 300_000_000], ['Vay', p2.payment]]);
  assert.equal(monthFlow(b, '2026-08').expense, p2.payment);
  assert.equal(loanMonth(loan, '2026-07')?.prepayment, 300_000_000);
});

test('loans saved by older versions (one rate on the loan) become one period; periods are tidied', () => {
  const old = { id: 'x', name: 'Cũ', principal: 100, ratePct: 7, months: 12, startMonth: '2026-01', paymentOverride: 9 };
  assert.deepEqual(normalizeLoan(old).periods, [{ from: '2026-01', ratePct: 7, prepayment: 0, paymentOverride: 9 }]);
  const messy = normalizeLoan({
    id: 'y', name: 'X', principal: 100, months: 12, startMonth: '2026-01',
    periods: [
      { from: '2026-05', ratePct: 8, prepayment: 5, paymentOverride: null },
      { from: '2025-12', ratePct: 6, prepayment: 99, paymentOverride: null }, // becomes the first period
      { from: '2027-06', ratePct: 9, prepayment: 0, paymentOverride: null }, // after the loan ends: dropped
    ],
  });
  assert.deepEqual(messy.periods.map((p) => [p.from, p.ratePct, p.prepayment]), [['2026-01', 6, 0], ['2026-05', 8, 5]]);
  assert.equal(loanSchedule(messy).length, 12);
});

test('the long-range plan follows a loan period by period', () => {
  const loan: Loan = {
    id: 'l', name: 'Vay', principal: 1_200_000_000, months: 24, startMonth: '2026-11',
    periods: [
      { from: '2026-11', ratePct: 6, prepayment: 0, paymentOverride: null },
      { from: '2027-03', ratePct: 9, prepayment: 300_000_000, paymentOverride: null },
    ],
  };
  const b: Budget = { fixed: [], oneOffs: [], overrides: {}, loans: [loan] };
  const inp = resolvePlan({ ...DEFAULT_PLAN, monthlyIncome: 0, monthlyExpense: 0, incomeGrowthPct: 0, inflationPct: 0, returnPct: 0 }, b, [], '2026-11', { amount: 2_000_000_000 });
  const d = inp.debts[0];
  assert.equal(d.schedule?.[4].payment, 300_000_000 + loanPeriods(loan)[1].payment); // March 2027: prepayment + new payment
  const p = project(inp);
  assert.equal(p.debtFreeMonth, 24);
  // Cash minus debt at the start; after the loan, net worth fell by exactly the interest paid.
  assert.equal(p.rows[0].netWorth, 2_000_000_000 - 1_200_000_000);
  assert.ok(Math.abs(p.rows[2].netWorth - (2_000_000_000 - 1_200_000_000 - loanTotalInterest(loan))) < 1_000);
});

test('credit plan items for one month, a range, or all the time', () => {
  const b: Budget = {
    fixed: [
      ...fixed,
      { id: 'c1', name: 'Ăn uống', amount: 10_000_000, direction: 'out', kind: 'credit' },
      { id: 'c2', name: 'Quà Tết', amount: 8_000_000, direction: 'out', kind: 'credit', fromMonth: '2027-01', toMonth: '2027-01' },
      { id: 'c3', name: 'Du lịch', amount: 5_000_000, direction: 'out', kind: 'credit', fromMonth: '2027-03', toMonth: '2027-05' },
    ],
    oneOffs: [],
    overrides: {},
  };
  const plan = (m: string) => monthFlow(b, m, { txs: [], statementDay: 14, today: '2026-12-01' });
  assert.deepEqual([plan('2026-12').creditPlanned, plan('2026-12').creditLine?.name], [10_000_000, 'Ăn uống']);
  assert.deepEqual([plan('2027-01').creditPlanned, plan('2027-01').creditLine?.name], [18_000_000, 'Ăn uống, Quà Tết']);
  assert.deepEqual(['2027-02', '2027-03', '2027-05', '2027-06'].map((m) => plan(m).creditPlanned), [10_000_000, 15_000_000, 15_000_000, 10_000_000]);
  // The long-range plan sees the months where an item starts or stops: Tết only in January, the trip March to May.
  const inp = resolvePlan(DEFAULT_PLAN, b, [], '2026-11');
  assert.deepEqual([inp.extraByMonth?.[3], inp.extraByMonth?.[4], inp.extraByMonth?.[5], inp.extraByMonth?.[7], inp.extraByMonth?.[8]], [-8_000_000, undefined, -5_000_000, -5_000_000, undefined]);
});

test('only bank mail that reads like a transaction is sent on to Claude', () => {
  assert.ok(looksLikeTransaction('Tài khoản của Quý khách vừa ghi nợ 1.500.000 VND, giao dịch chuyển khoản.'));
  assert.ok(!looksLikeTransaction('Ưu đãi hoàn tiền 10% khi mở thẻ mới tại HSBC!'));
  assert.ok(!looksLikeTransaction('Sao kê tháng 11 của Quý khách đã sẵn sàng.'));
});

test('html email bodies become readable text', () => {
  const text = htmlToText('<html><head><style>p{}</style></head><body><p>S&#7889; ti&#7873;n:&nbsp;<b>1.250.000 VND</b></p><div>T&amp;T Mart</div></body></html>');
  assert.equal(text, 'Số tiền: 1.250.000 VND\nT&T Mart');
});

test('a fixed income in periods: each month counts its own period amount, none outside them', () => {
  const salary: FixedItem = {
    id: 'p1',
    name: 'Lương',
    amount: 30_000_000,
    direction: 'in',
    periods: [
      { from: null, to: '2027-03', amount: 30_000_000 },
      { from: '2027-04', to: '2027-12', amount: 33_000_000 },
      { from: '2028-03', to: null, amount: 36_000_000 },
    ],
  };
  const b: Budget = { fixed: [salary], oneOffs: [], overrides: {} };
  assert.deepEqual(
    ['2026-11', '2027-03', '2027-04', '2027-12', '2028-01', '2028-02', '2028-03', '2040-01'].map((m) => monthFlow(b, m).income),
    [30_000_000, 30_000_000, 33_000_000, 33_000_000, 0, 0, 36_000_000, 36_000_000],
  );
  assert.equal(fixedPeriodAt(salary, '2028-01'), null);
  // A month's own amount still wins, and the line knows the period amount it replaces.
  const adj: Budget = { ...b, overrides: { '2027-05': { p1: 40_000_000 }, '2028-01': { p1: 1 } } };
  const line = monthFlow(adj, '2027-05').incomeLines[0];
  assert.deepEqual([line.amount, line.base, line.overridden], [40_000_000, 33_000_000, true]);
  // The table: April 2027 (month 6 from November 2026) gets the raise.
  const rows = flowTable(adj, '2026-11', 18);
  assert.deepEqual([rows[0].income, rows[5].income, rows[6].income, rows[14].income, rows[16].income], [30_000_000, 33_000_000, 40_000_000, 0, 36_000_000]);
  // The long-range plan sees each change against the current month; an adjustment in a month
  // outside every period counts for nothing, as in the table.
  const inp = resolvePlan(DEFAULT_PLAN, adj, [], '2026-11');
  assert.equal(inp.monthlyIncome, 30_000_000);
  assert.deepEqual([inp.extraByMonth?.[5], inp.extraByMonth?.[6], inp.extraByMonth?.[7], inp.extraByMonth?.[15], inp.extraByMonth?.[17]], [undefined, 3_000_000, 10_000_000, -30_000_000, 6_000_000]);
});

test('fixed-item periods are put in order and never overlap', () => {
  const periods = normalizeFixedPeriods([
    { from: '2027-06', to: null, amount: 3.6 },
    { from: '2027-03', to: '2026-12', amount: 1 },
    { from: null, to: '2027-01', amount: 2 },
  ]);
  assert.deepEqual(periods, [
    { from: null, to: '2026-11', amount: 2 },
    { from: '2026-12', to: '2027-03', amount: 1 },
    { from: '2027-06', to: null, amount: 4 },
  ]);
  assert.deepEqual(normalizeFixedPeriods('nope'), []);
  // The amount shown in lists: the one that applies, else the next to start.
  assert.deepEqual(['2026-05', '2027-04', '2030-01'].map((m) => fixedPeriodsAmountAt(periods, m)), [2, 4, 4]);
});

test('paying a loan off: the whole balance in that month, nothing after, later periods dropped', () => {
  const base = mkLoan({ principal: 1_200_000_000, ratePct: 6, months: 360, startMonth: '2026-11' });
  const loan = normalizeLoan({
    ...base,
    periods: [
      ...base.periods,
      { from: '2027-03', ratePct: 8, prepayment: 5, paymentOverride: 1, payOff: true },
      { from: '2028-01', ratePct: 9, prepayment: 0, paymentOverride: null },
    ],
  });
  assert.deepEqual(loan.periods.slice(1), [{ from: '2027-03', ratePct: 8, prepayment: 5, paymentOverride: null, payOff: true }]);
  const owed = loanBalance(loan, loanPaidBefore(loan, '2027-03'));
  assert.ok(owed > 1_100_000_000 && owed < 1_200_000_000);
  const e = loanMonth(loan, '2027-03')!;
  assert.deepEqual([e.prepayment, e.payOff, e.payment, e.closing], [owed, true, 0, 0]);
  assert.deepEqual([loanFinalMonth(loan), loanFinalMonth(base)], ['2027-03', '2056-10']);
  assert.equal(loanDebtNow([loan], '2027-04'), 0);
  assert.deepEqual([loanPeriods(loan)[1].payOff, loanPeriods(loan)[1].prepayment], [true, owed]);
  // The month it is paid off shows one line for it; later months have none.
  const b: Budget = { fixed: [], oneOffs: [], overrides: {}, loans: [loan] };
  assert.deepEqual(monthFlow(b, '2027-03').expenseLines.map((l) => [l.id, l.name, l.amount]), [['l#payoff', 'Tất toán: Vay', owed]]);
  assert.equal(monthFlow(b, '2027-04').expenseLines.length, 0);
  assert.ok(loanTotalInterest(loan) < loanTotalInterest(base) / 50);
});

test("the end of a month: money expected, and what is still owed after that month's payment", () => {
  // 0% so every payment is 10tr; income 30tr: 20tr set aside each month.
  const loan = mkLoan({ principal: 120_000_000, ratePct: 0, months: 12, startMonth: '2026-11' });
  const b: Budget = { fixed: [{ id: 'i', name: 'Lương', amount: 30_000_000, direction: 'in' }], oneOffs: [], overrides: {}, loans: [loan] };
  const cash = { amount: 100_000_000, month: '2026-11' };
  const money = projectedCash(b, cash, ['2027-01']).get('2027-01')!;
  const debt = loanDebtNow(b.loans, shiftMonth('2027-01', 1));
  assert.deepEqual([money, debt, money - debt], [160_000_000, 90_000_000, 70_000_000]);
  // Before the month the money on hand was entered there is nothing to project from.
  assert.equal(projectedCash(b, cash, ['2026-10']).get('2026-10'), null);
});

test('a loan from family: nothing monthly, principal and simple interest paid in one go at the end', () => {
  const fam: FamilyLoan = { id: 'f', name: 'Bố mẹ', principal: 500_000_000, startMonth: '2026-11', months: 24, ratePct: 6 };
  assert.deepEqual([familyLoanDueMonth(fam), familyLoanInterest(fam)], ['2028-11', 60_000_000]);
  // Owed: from the month it is received (principal) to the month it is due (everything), then nothing.
  assert.deepEqual(
    ['2026-10', '2026-11', '2026-12', '2027-11', '2028-11', '2028-12'].map((m) => familyLoanOwed(fam, m)),
    [0, 500_000_000, 502_500_000, 530_000_000, 560_000_000, 0],
  );
  // At the end of a month: a month's more interest; nothing once paid back.
  assert.deepEqual(['2026-10', '2026-11', '2028-10', '2028-11'].map((m) => familyLoanOwed(fam, m, 'end')), [0, 502_500_000, 560_000_000, 0]);
  const b: Budget = { fixed: [], oneOffs: [], overrides: {}, familyLoans: [fam] };
  // No monthly payment: the repayment is an expense of the due month only.
  assert.deepEqual(['2026-12', '2027-06', '2028-10'].map((m) => monthFlow(b, m).expense), [0, 0, 0]);
  const due = monthFlow(b, '2028-11');
  assert.deepEqual([due.expense, due.expenseLines.map((l) => l.id)], [560_000_000, ['f#due']]);
  assert.equal(monthFlow({ ...b, familyLoans: [{ ...fam, ratePct: 0 }] }, '2028-11').expense, 500_000_000);
  // The money received counts as income only when it is not in the money on hand yet.
  assert.equal(monthFlow(b, '2026-11').income, 0);
  assert.equal(monthFlow({ ...b, familyLoans: [{ ...fam, receive: true }] }, '2026-11').income, 500_000_000);
  // Debt: with the bank loans, now and at a month's end.
  assert.deepEqual([debtNow(b, '2026-11'), debtAtEnd(b, '2028-10'), debtAtEnd(b, '2028-11')], [500_000_000, 560_000_000, 0]);
  // The long-range plan starts from money on hand minus it, and pays it in one go.
  const inp = resolvePlan({ ...DEFAULT_PLAN, monthlyIncome: 0, monthlyExpense: 0 }, b, [], '2026-11', { amount: 1_000_000_000 });
  assert.equal(inp.startNetWorth, 500_000_000);
  const d = inp.debts.find((x) => x.id === 'f')!;
  assert.deepEqual([d.balance, d.monthlyPayment, d.schedule![23].payment, d.schedule![24].payment, d.schedule![24].balance], [500_000_000, 0, 0, 560_000_000, 0]);
});

test('spending more than the bank asks: the month\'s expense, the balance follows the bank\'s schedule', () => {
  const base = mkLoan({ principal: 1_200_000_000, ratePct: 6, months: 360, startMonth: '2026-11' });
  const bank = annuityPayment(1_200_000_000, 6, 360);
  const loan = normalizeLoan({ ...base, periods: [{ ...base.periods[0], actualPayment: 10_000_000 }] });
  assert.equal(loan.periods[0].actualPayment, 10_000_000);
  const first = loanMonth(loan, '2026-11')!;
  // The bank still charges its payment and the balance falls by it alone; 10 million is spent.
  assert.deepEqual([first.payment, first.spend, first.closing], [bank, 10_000_000, loanMonth(base, '2026-11')!.closing]);
  assert.equal(loanSpend(loan, '2026-11'), 10_000_000);
  assert.deepEqual(loanSchedule(loan).map((m) => [m.payment, m.closing]), loanSchedule(base).map((m) => [m.payment, m.closing]));
  assert.deepEqual([loanFinalMonth(loan), loanTotalInterest(loan)], [loanFinalMonth(base), loanTotalInterest(base)]);
  assert.equal(loanDebtNow([loan], '2027-11'), loanDebtNow([base], '2027-11'));
  // Nothing is spent once the loan has ended.
  assert.equal(loanSpend(loan, '2056-11'), 0);
  // The period shows the bank's payment and the user's own.
  assert.deepEqual([loanPeriods(loan)[0].payment, loanPeriods(loan)[0].actualPayment, loanPeriods(base)[0].actualPayment], [bank, 10_000_000, null]);
  // In the month: the line is what the user spends, with the bank's figure beside it.
  const b: Budget = { fixed: [], oneOffs: [], overrides: {}, loans: [loan] };
  const line = monthFlow(b, '2026-11').expenseLines[0];
  assert.deepEqual([line.amount, line.bank], [10_000_000, bank]);
  assert.equal(monthFlow(b, '2026-11').expense, 10_000_000);
  assert.equal(monthFlow({ ...b, loans: [base] }, '2026-11').expenseLines[0].bank, undefined);
  // Less than the bank's payment: the bank's payment is what is spent.
  const less = normalizeLoan({ ...base, periods: [{ ...base.periods[0], actualPayment: 5_000_000 }] });
  assert.deepEqual(loanSchedule(less).map((m) => m.spend), loanSchedule(base).map((m) => m.payment));
  // The long-range plan spends the larger amount and owes what the bank's schedule says.
  const plan = resolvePlan(DEFAULT_PLAN, b, [], '2026-11');
  const debt = plan.debts.find((d) => d.id === 'l')!;
  assert.deepEqual([debt.monthlyPayment, debt.schedule![0].payment, debt.schedule![0].balance], [10_000_000, 10_000_000, first.closing]);
  // A period that pays the loan off has nothing monthly to pay.
  const off = normalizeLoan({ ...base, periods: [...base.periods, { from: '2027-03', ratePct: 6, prepayment: 0, paymentOverride: null, actualPayment: 9, payOff: true }] });
  assert.equal(off.periods[1].actualPayment, undefined);
});

test('expenses ticked off as paid: planned, paid, and what is set aside either way', () => {
  const b: Budget = { ...B, fixed: [...fixed, { id: 'c1', name: 'Ăn ngoài', amount: 8_000_000, direction: 'out', kind: 'credit' }] };
  const flow = monthFlow(b, '2026-12');
  assert.equal(flow.expense, 38_000_000);
  const none = paidSummary(flow, undefined);
  assert.deepEqual([none.planned, none.paid, none.left, none.count, none.total], [38_000_000, 0, 38_000_000, 0, 6]);
  assert.deepEqual([none.plannedSaving, none.actualSaving], [12_000_000, 50_000_000]);
  const some = paidSummary(flow, ['fixed:o1', 'fixed:o2', CARD_KEY, 'fixed:gone']);
  assert.deepEqual([some.paid, some.left, some.count, some.total], [23_000_000, 15_000_000, 3, 6]);
  assert.deepEqual([some.plannedSaving, some.actualSaving], [12_000_000, 27_000_000]);
  const all = paidSummary(flow, ['fixed:o1', 'fixed:o2', 'fixed:o3', 'fixed:o4', 'fixed:o5', CARD_KEY]);
  assert.deepEqual([all.paid, all.left, all.count, all.actualSaving], [38_000_000, 0, 6, 12_000_000]);
  assert.deepEqual(normalizePaid({ '2026-12': ['a', 'a', '', 3], bad: ['x'], '2027-01': [], '2027-02': 'x' }), { '2026-12': ['a'] });
});

test('cash notes: a month day by day with totals, and the notes used most often', () => {
  const at = (date: string, h: number) => new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), h).getTime();
  const n = (id: string, date: string, h: number, amount: number, note: string): CashNote => ({ id, ts: at(date, h), date, amount, note });
  const notes = [
    n('a', '2026-11-03', 7, 30_000, 'Ăn sáng'),
    n('b', '2026-11-03', 12, 5_000, 'Gửi xe'),
    n('c', '2026-11-05', 7, 35_000, 'ăn sáng'),
    n('d', '2026-10-31', 9, 200_000, 'Chợ'),
    n('e', '2026-11-05', 18, 120_000, ''),
  ];
  const m = cashMonth(notes, '2026-11');
  assert.deepEqual([m.total, m.count], [190_000, 4]);
  assert.deepEqual(m.days.map((d) => [d.date, d.total, d.notes.map((x) => x.id)]), [
    ['2026-11-05', 155_000, ['e', 'c']],
    ['2026-11-03', 35_000, ['b', 'a']],
  ]);
  assert.deepEqual(cashMonth(notes, '2026-12'), { total: 0, count: 0, days: [] });
  // Same words in any case count together; empty notes are not suggested; ties go to the most recent.
  assert.deepEqual(frequentNotes(notes), ['ăn sáng', 'Gửi xe', 'Chợ']);
  assert.deepEqual(frequentNotes(notes, 1), ['ăn sáng']);
});
