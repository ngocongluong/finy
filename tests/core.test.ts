import assert from 'node:assert/strict';
import { test } from 'node:test';
import { creditCycle, creditSpent, cycleMonthOf, dailyStats, flowTable, markCreditItem, migrateLegacyBudget, monthFlow, netWorth, type Budget } from '../src/lib/finance';
import { daysInMonth, fmtInput, fmtPct, fmtTime, fmtVND, maskMoney, monthShort, parseAmount, shiftMonth } from '../src/lib/format';
import { ALLOWED_SENDER_DOMAINS, htmlToText, looksLikeTransaction, parseHsbcCardEmail, senderAllowed } from '../src/lib/mailText';
import { project, projectAll, resolvePlan, DEFAULT_PLAN, yearReaching, type PlanInputs } from '../src/lib/plan';
import { applyUiPatch, DEFAULT_UI, normalizeUi } from '../src/lib/theme';
import type { FixedItem, OneOff, Tx } from '../src/lib/types';

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
  assert.equal(under.creditLine?.id, 'cc');
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

  const ok = applyUiPatch(DEFAULT_UI, { colors: { accent: '#34D399' }, radius: 99, amountFormat: 'compact', home: [{ id: 'plan', visible: true }, { id: 'today', visible: false }] });
  assert.ok('ui' in ok);
  if ('ui' in ok) {
    assert.equal(ok.ui.colors.accent, '#34D399');
    assert.equal(ok.ui.radius, 28); // clamped
    assert.equal(ok.ui.amountFormat, 'compact');
    assert.deepEqual(ok.ui.home.slice(0, 2), [{ id: 'plan', visible: true }, { id: 'today', visible: false }]);
    assert.equal(ok.ui.home.length, DEFAULT_UI.home.length); // nothing lost
  }

  const unreadable = applyUiPatch(DEFAULT_UI, { colors: { text: '#101216' } });
  assert.ok('errors' in unreadable && unreadable.errors.some((e) => e.includes('colors.text')));
  const malformed = applyUiPatch(DEFAULT_UI, { colors: { accent: 'red' } });
  assert.ok('errors' in malformed);
  const unknown = applyUiPatch(DEFAULT_UI, { home: [{ id: 'nope' as never, visible: true }] });
  assert.ok('errors' in unknown);
});

test('a layout saved before a section existed gets the new section where the default has it', () => {
  const old = { ...DEFAULT_UI, home: [{ id: 'plan' as const, visible: true }, { id: 'today' as const, visible: false }, { id: 'month' as const, visible: true }] };
  const home = normalizeUi(old).home.map((h) => h.id);
  assert.deepEqual(home.slice(0, 4), ['plan', 'today', 'credit', 'month']); // credit right after today, saved order kept
  assert.equal(home.length, DEFAULT_UI.home.length);
  assert.equal(normalizeUi(old).home.find((h) => h.id === 'today')!.visible, false);
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

test('only bank mail that reads like a transaction is sent on to Claude', () => {
  assert.ok(looksLikeTransaction('Tài khoản của Quý khách vừa ghi nợ 1.500.000 VND, giao dịch chuyển khoản.'));
  assert.ok(!looksLikeTransaction('Ưu đãi hoàn tiền 10% khi mở thẻ mới tại HSBC!'));
  assert.ok(!looksLikeTransaction('Sao kê tháng 11 của Quý khách đã sẵn sàng.'));
});

test('html email bodies become readable text', () => {
  const text = htmlToText('<html><head><style>p{}</style></head><body><p>S&#7889; ti&#7873;n:&nbsp;<b>1.250.000 VND</b></p><div>T&amp;T Mart</div></body></html>');
  assert.equal(text, 'Số tiền: 1.250.000 VND\nT&T Mart');
});
