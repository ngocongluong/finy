import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dailyStats, monthSummary, netWorth } from '../src/lib/finance';
import { daysInMonth, fmtInput, fmtPct, fmtVND, parseAmount, shiftMonth } from '../src/lib/format';
import { htmlToText, senderAllowed } from '../src/lib/mailText';
import { project, projectAll, resolvePlan, DEFAULT_PLAN, yearReaching, type PlanInputs } from '../src/lib/plan';
import { applyUiPatch, DEFAULT_UI, normalizeUi } from '../src/lib/theme';
import type { MonthBudget, Tx } from '../src/lib/types';

// Made-up household budget used as the fixture.
const sample: MonthBudget = {
  month: '2026-11',
  income: 50_000_000,
  items: [
    { id: 'a', name: 'Trả góp', amount: 5_000_000, kind: 'debt' },
    { id: 'b', name: 'Tiền nhà', amount: 10_000_000, kind: 'expense' },
    { id: 'c', name: 'Học phí', amount: 4_000_000, kind: 'expense' },
    { id: 'd', name: 'Chi tiêu hằng ngày', amount: 9_000_000, kind: 'expense', daily: true },
    { id: 'e', name: 'Điện nước', amount: 2_000_000, kind: 'expense' },
    { id: 'f', name: 'Để dành', amount: 18_000_000, kind: 'saving' },
  ],
};

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
});

test('month summary: totals, remainder and spend ratio', () => {
  const s = monthSummary(sample);
  assert.equal(s.totalOut, 48_000_000); // spending + debt + saving
  assert.equal(s.remaining, 2_000_000);
  assert.equal(s.saving, 18_000_000);
  assert.equal(s.dailyBucket, 9_000_000);
  assert.equal(s.spendRatio, 0.6); // saving is not spending
  assert.ok(Number.isNaN(monthSummary(undefined).spendRatio));
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
  const d = dailyStats(sample, txs, '2026-11-21');
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

test('plan defaults follow the budget and accounts', () => {
  const inp = resolvePlan(DEFAULT_PLAN, sample, [{ id: '1', name: 'A', kind: 'saving', balance: 500 }]);
  assert.equal(inp.monthlyIncome, 50_000_000);
  assert.equal(inp.monthlyExpense, 25_000_000);
  assert.equal(inp.startNetWorth, 500);
  assert.deepEqual(inp.debts.map((d) => [d.name, d.monthlyPayment, d.balance]), [['Trả góp', 5_000_000, null]]);
  assert.equal(resolvePlan({ ...DEFAULT_PLAN, years: 99 }, sample, []).years, 10);
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
