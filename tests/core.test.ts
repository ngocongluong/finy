import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dailyStats, flowTable, migrateLegacyBudget, monthFlow, netWorth } from '../src/lib/finance';
import { daysInMonth, fmtInput, fmtPct, fmtVND, monthShort, parseAmount, shiftMonth } from '../src/lib/format';
import { htmlToText, senderAllowed } from '../src/lib/mailText';
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

test('month helpers', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(daysInMonth('2026-11'), 30);
  assert.equal(daysInMonth('2028-02'), 29);
  assert.equal(monthShort('2027-01'), 'T1/27');
});

test('a month with only fixed items: saving is income minus expenses', () => {
  const f = monthFlow(fixed, oneOffs, '2026-11');
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
  const jan = monthFlow(fixed, oneOffs, '2027-01');
  assert.equal(jan.extraIn, 40_000_000);
  assert.equal(jan.extraOut, 15_000_000);
  assert.equal(jan.income, 90_000_000);
  assert.equal(jan.expense, 45_000_000);
  assert.equal(jan.saving, 45_000_000);

  const feb = monthFlow(fixed, oneOffs, '2027-02');
  assert.equal(feb.saving, 20_000_000 - 60_000_000); // a shortfall month
  assert.equal(monthFlow(fixed, oneOffs, '2027-03').saving, 20_000_000);
});

test('nothing entered yet: zeros, and ratios are undefined rather than wrong', () => {
  const f = monthFlow([], [], '2026-11');
  assert.equal(f.income, 0);
  assert.equal(f.saving, 0);
  assert.ok(Number.isNaN(f.spendRatio));
  assert.ok(Number.isNaN(f.savingRate));
});

test('the cash-flow table lists consecutive months with a running total', () => {
  const rows = flowTable(fixed, oneOffs, '2026-11', 5);
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
  assert.equal(monthFlow(migrated, [], '2026-11').saving, 36_000_000);
  assert.deepEqual(migrateLegacyBudget({ month: '2026-11', income: 0, items: [] }), []);
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
  const inp = resolvePlan(DEFAULT_PLAN, fixed, oneOffs, [{ id: '1', name: 'A', kind: 'saving', balance: 500 }], '2026-11');
  assert.equal(inp.monthlyIncome, 50_000_000);
  assert.equal(inp.monthlyExpense, 25_000_000); // loan repayments are modelled as debts, not expenses
  assert.equal(inp.startNetWorth, 500);
  assert.deepEqual(inp.debts.map((d) => [d.name, d.monthlyPayment, d.balance]), [['Trả góp', 5_000_000, null]]);
  // Month 1 is 2026-11, so January 2027 is month 3 and February is month 4; the past one-off is ignored.
  assert.deepEqual(inp.extraByMonth, { 3: 25_000_000, 4: -60_000_000 });
  assert.equal(resolvePlan({ ...DEFAULT_PLAN, years: 99 }, fixed, [], [], '2026-11').years, 10);
  // A manual override wins over the fixed items.
  assert.equal(resolvePlan({ ...DEFAULT_PLAN, monthlyIncome: 1 }, fixed, [], [], '2026-11').monthlyIncome, 1);
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
  const domains = ['hsbc.com.vn', 'hsbc.com'];
  assert.ok(senderAllowed('HSBC Vietnam <alerts@hsbc.com.vn>', domains));
  assert.ok(senderAllowed('no-reply@notification.hsbc.com', domains));
  assert.ok(!senderAllowed('HSBC <alerts@hsbc.com.vn.evil.io>', domains));
  assert.ok(!senderAllowed('"alerts@hsbc.com.vn" <phish@gmail.com>', domains));
  assert.ok(!senderAllowed('x@nothsbc.com', domains));
});

test('html email bodies become readable text', () => {
  const text = htmlToText('<html><head><style>p{}</style></head><body><p>S&#7889; ti&#7873;n:&nbsp;<b>1.250.000 VND</b></p><div>T&amp;T Mart</div></body></html>');
  assert.equal(text, 'Số tiền: 1.250.000 VND\nT&T Mart');
});
