import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ACCOUNT_KINDS, AccountSheet, CreditPlanSheet, FixedSheet, InstalmentSheet, LoanSheet, NumberSheet } from '../../components/sheets';
import { Amount, Btn, Card, Chip, EyeToggle, HideScope, Row, Screen, Segmented, Txt, useMoney, useUi } from '../../components/ui';
import { cycleMonthOf, debtNow, familyLoanDueMonth, familyLoanInterest, fixedActive, flowTable, loanEndMonth, loanFinalMonth, projectedCash, instalmentAmount, instalmentPart, loanBalance, loanPaidBefore, loanMonth, loanPart, loanPayment, loanPeriodAt, monthFlow, netWorth, paidSummary } from '../../lib/finance';
import { dateKey, monthKey, monthLabel, monthShort, shiftMonth } from '../../lib/format';
import { useBudget } from '../../lib/hooks';
import { useStore } from '../../lib/store';
import type { Account, FamilyLoan, FixedItem, Instalment, Loan } from '../../lib/types';

type View3 = 'table' | 'fixed' | 'accounts';

/**
 * A fixed item in the lists: its amount this month, and for one that changes
 * over time, until when it lasts, or when it starts / ended (then muted).
 */
function fixedNow(f: FixedItem, month: string): { amount: number; when?: string; muted: boolean } {
  const periods = f.periods?.length ? f.periods : f.fromMonth || f.toMonth ? [{ from: f.fromMonth ?? null, to: f.toMonth ?? null, amount: f.amount }] : null;
  if (!periods) return { amount: f.amount, muted: false };
  const count = periods.length > 1 ? `${periods.length} giai đoạn` : '';
  const say = (text: string) => [count, text].filter(Boolean).join(' · ');
  const cur = periods.find((p) => (p.from === null || month >= p.from) && (p.to === null || month <= p.to));
  if (cur) return { amount: cur.amount, when: say(cur.to ? `đến ${monthLabel(cur.to).toLowerCase()}` : ''), muted: false };
  const next = periods.find((p) => p.from !== null && p.from > month);
  if (next?.from) return { amount: next.amount, when: say(`bắt đầu ${monthLabel(next.from).toLowerCase()}`), muted: true };
  const last = periods[periods.length - 1];
  return { amount: last.amount, when: say(last.to ? `đã hết từ sau ${monthLabel(last.to).toLowerCase()}` : ''), muted: true };
}

/** One tappable line: name on the left, amount on the right. */
function Line({ name, sub, amount, color, onPress, icon }: { name: string; sub?: string; amount: number; color?: string; onPress: () => void; icon?: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, minHeight: 48, justifyContent: 'center' })}>
      <Row>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, marginRight: 12 }}>
          {icon}
          <View style={{ flexShrink: 1 }}>
            <Txt numberOfLines={1}>{name}</Txt>
            {sub ? <Txt v="small">{sub}</Txt> : null}
          </View>
        </View>
        <Amount value={amount} color={color} />
      </Row>
    </Pressable>
  );
}

export default function Budget() {
  const { c, gap } = useUi();
  const money = useMoney();
  const { budget, credit } = useBudget();
  const accounts = useStore((s) => s.accounts);

  const now = monthKey();
  const [view, setView] = useState<View3>('table');
  // What the table covers: the next n months, or one calendar year (this year and the next 29).
  const [period, setPeriod] = useState<{ kind: 'next'; months: number } | { kind: 'year'; year: number }>({ kind: 'next', months: 6 });
  const thisYear = Number(now.slice(0, 4));
  const years = Array.from({ length: 30 }, (_, i) => thisYear + i);
  const start = period.kind === 'year' ? `${period.year}-01` : now;
  const count = period.kind === 'year' ? 12 : period.months;
  // `open` is separate from the payload so a sheet keeps its content while it animates closed.
  const [fixedSheet, setFixedSheetState] = useState<{ open: boolean; direction: 'in' | 'out'; item: FixedItem | null }>({ open: false, direction: 'out', item: null });
  const setFixedSheet = (v: { direction: 'in' | 'out'; item: FixedItem | null } | null) =>
    setFixedSheetState((cur) => (v ? { open: true, ...v } : { ...cur, open: false }));
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [inst, setInst] = useState<{ open: boolean; item: Instalment | null }>({ open: false, item: null });
  const instalments = useStore((s) => s.instalments);
  const loans = useStore((s) => s.loans);
  const familyLoans = useStore((s) => s.familyLoans);
  // The loan form: a bank loan or a loan from family to edit, or neither to add one of either kind.
  const [loan, setLoan] = useState<{ open: boolean; item: Loan | null; family?: FamilyLoan | null }>({ open: false, item: null });
  const statementDay = useStore((s) => s.settings.statementDay);
  // The statement cycle open today: instalment progress is shown against it.
  const cycleMonth = cycleMonthOf(dateKey(), statementDay);

  const rows = useMemo(() => flowTable(budget, start, count, credit), [budget, credit, start, count]);
  // Months whose expenses are all ticked off as paid (in the month's detail).
  const paidMarks = useStore((s) => s.paid);
  const allPaid = useMemo(() => {
    const done = new Set<string>();
    for (const r of rows) {
      const p = paidSummary(r, paidMarks[r.month]);
      if (p.total > 0 && p.count === p.total) done.add(r.month);
    }
    return done;
  }, [rows, paidMarks]);
  // Money on hand now, what is owed on loans, and the money expected at the end of each month.
  const cash = useStore((s) => s.cash);
  const setCash = useStore((s) => s.setCash);
  const [cashOpen, setCashOpen] = useState(false);
  const debt = useMemo(() => debtNow(budget, now), [budget, now]);
  const projected = useMemo(() => projectedCash(budget, cash, rows.map((r) => r.month), credit), [budget, cash, rows, credit]);
  const total = useMemo(() => netWorth(accounts), [accounts]);
  const last = rows[rows.length - 1];
  const sumIn = rows.reduce((s, r) => s + r.income, 0);
  const sumOut = rows.reduce((s, r) => s + r.expense, 0);

  const fixedIn = budget.fixed.filter((f) => f.direction === 'in');
  const fixedOut = budget.fixed.filter((f) => f.direction === 'out' && f.kind !== 'credit');
  // The card plan shows as one line: its total, named by the notes of its items. An item set
  // for one month only is not a monthly expense: it shows in that month's detail instead.
  const monthOnly = (f: FixedItem) => f.kind === 'credit' && !!f.fromMonth && f.fromMonth === f.toMonth;
  const creditPlan = budget.fixed.filter((f) => f.direction === 'out' && f.kind === 'credit' && !monthOnly(f));
  const [planOpen, setPlanOpen] = useState(false);
  const statementDayForPlan = useStore((s) => s.settings.statementDay);
  // The plan for the statement cycle open today; items for other periods are counted apart.
  const creditPlanNow = creditPlan.filter((f) => fixedActive(f, cycleMonthOf(dateKey(), statementDayForPlan)));
  // A usual month: without one-offs, one-month adjustments or card items, and family-loan events.
  const base = monthFlow({ ...budget, fixed: budget.fixed.filter((f) => !monthOnly(f)), oneOffs: [], overrides: {}, familyLoans: [] }, now);
  const empty = budget.fixed.length === 0;
  const cell = { flex: 1, textAlign: 'right' as const };

  return (
    <Screen title="Ngân sách">
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'table', label: 'Bảng thu chi' },
          { value: 'fixed', label: 'Cố định' },
          { value: 'accounts', label: 'Tài khoản' },
        ]}
      />

      {view === 'table' ? (
        <>
          {empty ? (
            <Card style={{ gap: 10 }}>
              <Txt v="heading">Bắt đầu từ thu chi cố định</Txt>
              <Txt v="label">Nhập các nguồn thu và khoản chi lặp lại hàng tháng. Finy sẽ lập bảng thu/chi và tính số để dành được cho từng tháng.</Txt>
              <Btn label="Nhập thu chi cố định" icon="add" onPress={() => setView('fixed')} />
            </Card>
          ) : null}

          <Card eye={'budget.summary'} style={{ gap: 10 }}>
            <Pressable onPress={() => setCashOpen(true)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Row style={{ gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Txt v="label">Tiền đang có</Txt>
                  <Txt v="small">{cash ? `nhập ${monthLabel(cash.month).toLowerCase()} · chạm để sửa` : 'Chạm để nhập'}</Txt>
                </View>
                <Amount v="heading" value={cash?.amount ?? 0} color={c.positive} style={{ flexShrink: 1, maxWidth: '58%', textAlign: 'right' }} />
              </Row>
            </Pressable>
            <Pressable onPress={() => setView('fixed')} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Row style={{ gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Txt v="label">Tiền đang nợ</Txt>
                  <Txt v="small">{budget.loans?.length || budget.familyLoans?.length ? 'dư nợ các khoản vay hiện tại' : 'Chưa có khoản vay — nhập ở Cố định'}</Txt>
                </View>
                <Amount v="heading" value={debt} color={debt > 0 ? c.negative : c.text} style={{ flexShrink: 1, maxWidth: '58%', textAlign: 'right' }} />
              </Row>
            </Pressable>
            <View style={{ height: 1, backgroundColor: c.border }} />
            <Row style={{ gap: 12 }}>
              <Txt v="label" style={{ flex: 1 }}>Còn lại sau nợ</Txt>
              <Amount value={(cash?.amount ?? 0) - debt} color={(cash?.amount ?? 0) - debt < 0 ? c.negative : c.positive} style={{ flexShrink: 1, maxWidth: '58%', textAlign: 'right' }} />
            </Row>
          </Card>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
            {[6, 12, 24, 36].map((n) => (
              <Chip key={n} label={`${n} tháng tới`} active={period.kind === 'next' && period.months === n} onPress={() => setPeriod({ kind: 'next', months: n })} />
            ))}
            {years.map((y) => (
              <Chip key={y} label={String(y)} active={period.kind === 'year' && period.year === y} onPress={() => setPeriod({ kind: 'year', year: y })} />
            ))}
          </ScrollView>

          <Card style={{ gap: 2 }}>
            <HideScope id="budget.table">
            {/* The eye sits in its own title row, so the columns get the card's full width. */}
            <Row style={{ marginTop: -6, marginBottom: 2 }}>
              <Txt v="heading">Bảng thu chi</Txt>
              <EyeToggle id="budget.table" />
            </Row>
            <Row style={{ marginBottom: 6 }}>
              <Txt v="small" style={{ width: 54 }}>Tháng</Txt>
              <Txt v="small" style={cell}>Thu</Txt>
              <Txt v="small" style={cell}>Chi</Txt>
              <Txt v="small" style={cell}>Để dành</Txt>
              <Txt v="small" style={cell}>Dự kiến</Txt>
            </Row>
            {rows.map((r) => {
              const special = r.extraIn > 0 || r.extraOut > 0 || r.adjusted;
              const done = allPaid.has(r.month);
              return (
                <Pressable
                  key={r.month}
                  onPress={() => router.push(`/month/${r.month}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`${monthLabel(r.month)}: thu ${money(r.income)}, chi ${money(r.expense)}, để dành ${money(r.saving)}. Chạm để xem và sửa chi tiết.`}
                  style={({ pressed }) => ({
                    minHeight: 48,
                    justifyContent: 'center',
                    marginHorizontal: -8,
                    paddingHorizontal: 8,
                    borderRadius: 10,
                    backgroundColor: pressed ? c.cardAlt : 'transparent',
                  })}>
                  <Row>
                    <View style={{ width: 54 }}>
                      <Txt v="label" numberOfLines={1} color={r.month === now ? c.text : c.muted}>{monthShort(r.month)}</Txt>
                      {/* Markers go under the month so they never run into the first amount column. */}
                      {special || r.creditOver > 0 || done ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                          {special ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.accent }} /> : null}
                          {r.creditOver > 0 ? <Ionicons name="warning" size={11} color={c.negative} accessibilityLabel="Vượt dự chi tín dụng" /> : null}
                          {done ? <Ionicons name="checkmark-circle" size={11} color={c.positive} accessibilityLabel="Đã chi xong" /> : null}
                        </View>
                      ) : null}
                    </View>
                    <Txt v="num" style={cell} numberOfLines={1} adjustsFontSizeToFit>{money(r.income, true)}</Txt>
                    <Txt v="num" style={cell} numberOfLines={1} adjustsFontSizeToFit>{money(r.expense, true)}</Txt>
                    <Txt v="num" style={cell} numberOfLines={1} adjustsFontSizeToFit color={r.saving < 0 ? c.negative : c.positive}>{money(r.saving, true)}</Txt>
                    <Txt v="num" style={cell} numberOfLines={1} adjustsFontSizeToFit color={(projected.get(r.month) ?? 0) < 0 ? c.negative : c.text}>
                      {projected.get(r.month) == null ? '—' : money(projected.get(r.month)!, true)}
                    </Txt>
                  </Row>
                </Pressable>
              );
            })}
            <View style={{ height: 1, backgroundColor: c.border, marginVertical: 8 }} />
            <Row>
              <Txt v="label" style={{ width: 54 }} numberOfLines={1} adjustsFontSizeToFit>{period.kind === 'year' ? `Cả ${period.year}` : 'Tổng'}</Txt>
              <Txt v="num" style={cell} numberOfLines={1}>{money(sumIn, true)}</Txt>
              <Txt v="num" style={cell} numberOfLines={1}>{money(sumOut, true)}</Txt>
              <Txt v="num" style={cell} numberOfLines={1} adjustsFontSizeToFit color={last.cumulative < 0 ? c.negative : c.positive}>{money(last.cumulative, true)}</Txt>
              <Txt v="num" style={cell} numberOfLines={1} adjustsFontSizeToFit>{projected.get(last.month) == null ? '—' : money(projected.get(last.month)!, true)}</Txt>
            </Row>
            <Txt v="small" style={{ marginTop: 8 }}>
              Dự kiến = tiền đang có + để dành cộng dồn đến cuối tháng đó (tính từ tháng nhập tiền đang có). Chạm một tháng để xem, sửa chi tiết thu, chi và đánh dấu khoản đã chi. Chấm tròn = tháng có khoản phát sinh hoặc số tiền chỉnh riêng; dấu tick xanh = đã chi xong mọi khoản.
            </Txt>
          </HideScope>
          </Card>
        </>
      ) : null}

      {view === 'fixed' ? (
        <>
          <Card eye={'budget.fixedIn'} style={{ gap: 2 }}>
            <Row style={{ marginBottom: 6 }}>
              <Txt v="heading">Thu cố định hàng tháng</Txt>
              <Amount value={base.fixedIn} color={c.muted} />
            </Row>
            {fixedIn.length === 0 ? <Txt v="label">Chưa có nguồn thu nào. Thêm lương và các khoản thu đều đặn khác.</Txt> : null}
            {fixedIn.map((f) => {
              const s = fixedNow(f, now);
              return <Line key={f.id} name={f.name} sub={s.when || undefined} amount={s.amount} color={s.muted ? c.muted : undefined} onPress={() => setFixedSheet({ direction: 'in', item: f })} />;
            })}
            <Btn label="Thêm nguồn thu" icon="add" kind="ghost" style={{ marginTop: 8 }} onPress={() => setFixedSheet({ direction: 'in', item: null })} />
          </Card>

          <Card eye={'budget.fixedOut'} style={{ gap: 2 }}>
            <Row style={{ marginBottom: 6 }}>
              <Txt v="heading">Chi cố định hàng tháng</Txt>
              <Amount value={base.fixedOut} color={c.muted} />
            </Row>
            <Line
              name="Dự chi tín dụng"
              sub={
                creditPlan.length
                  ? [creditPlanNow.map((f) => f.name).join(', '), creditPlan.length > creditPlanNow.length ? `+${creditPlan.length - creditPlanNow.length} khoản giai đoạn khác` : '']
                      .filter(Boolean)
                      .join(' · ') || 'Không có khoản nào áp dụng kỳ này'
                  : 'Chưa có khoản hàng tháng — chạm để nhập'
              }
              amount={creditPlanNow.reduce((s, f) => s + f.amount, 0)}
              icon={<Ionicons name="card-outline" size={20} color={c.muted} />}
              onPress={() => setPlanOpen(true)}
            />
            {fixedOut.length === 0 ? <Txt v="label">Chưa có khoản chi nào. Thêm tiền nhà, học phí, trả nợ, quỹ chi tiêu hằng ngày…</Txt> : null}
            {fixedOut.map((f) => {
              const s = fixedNow(f, now);
              const what = f.kind === 'debt' ? 'Trả nợ vay' : f.onCard ? 'Trả qua thẻ tín dụng mỗi kỳ' : f.daily ? 'Quỹ chi tiêu hằng ngày' : '';
              return (
                <Line
                  key={f.id}
                  name={f.name}
                  sub={[what, s.when].filter(Boolean).join(' · ') || undefined}
                  amount={s.amount}
                  color={s.muted ? c.muted : undefined}
                  onPress={() => setFixedSheet({ direction: 'out', item: f })}
                />
              );
            })}
            <Btn label="Thêm khoản chi" icon="add" kind="ghost" style={{ marginTop: 8 }} onPress={() => setFixedSheet({ direction: 'out', item: null })} />
          </Card>

          <Card eye={'budget.loans'} style={{ gap: 2 }}>
            <Row style={{ marginBottom: 6 }}>
              <Txt v="heading">Quản lý khoản vay</Txt>
              {/* Paid on loans this month: bank payments, and a family loan when it falls due now. */}
              <Amount
                value={
                  loans.reduce((s, l) => s + loanPayment(l, now), 0) +
                  familyLoans.reduce((s, l) => s + (familyLoanDueMonth(l) === now ? l.principal + familyLoanInterest(l) : 0), 0)
                }
                color={c.muted}
              />
            </Row>
            {loans.length + familyLoans.length === 0 ? (
              <Txt v="label">
                Chưa có khoản vay nào. Vay ngân hàng: Finy tự tính số trả mỗi tháng và cộng vào chi cố định. Vay người thân: trả một lần (gốc + lãi) vào cuối thời hạn, tính vào đúng tháng đó.
              </Txt>
            ) : null}
            {loans.map((l) => {
              const paid = loanPaidBefore(l, now);
              // A loan paid off early stops at the month it is settled.
              const final = loanFinalMonth(l);
              const early = final < loanEndMonth(l);
              const running = loanPart(l, now) !== null && now <= final;
              const rate = loanPeriodAt(l, now).ratePct;
              const extra = early ? ` · tất toán ${monthLabel(final).toLowerCase()}` : l.periods.length > 1 ? ` · ${l.periods.length} giai đoạn` : '';
              // Paying more than the bank asks: the amount shown is what is paid; the bank's figure beside it.
              const e = loanMonth(l, now);
              const bank = e && e.payment > e.bank ? ` · ngân hàng thu ${money(e.bank, true)}` : '';
              const sub = running
                ? `${String(rate).replace('.', ',')}%/năm · kỳ ${paid + 1}/${l.months} · dư nợ ${money(loanBalance(l, paid), true)}${bank}${extra}`
                : now < l.startMonth
                  ? `Bắt đầu trả ${monthLabel(l.startMonth).toLowerCase()}`
                  : early
                    ? `Đã tất toán ${monthLabel(final).toLowerCase()}`
                    : 'Đã trả xong';
              return (
                <Line
                  key={l.id}
                  name={l.name}
                  sub={`Ngân hàng · ${sub}`}
                  amount={running ? loanPayment(l, now) : loanPayment(l)}
                  color={running ? c.text : c.muted}
                  onPress={() => setLoan({ open: true, item: l, family: null })}
                />
              );
            })}
            {familyLoans.map((l) => {
              // Nothing monthly: the principal and interest in one payment at the end of the term.
              const due = familyLoanDueMonth(l);
              const total = l.principal + familyLoanInterest(l);
              const rate = l.ratePct > 0 ? `lãi ${String(l.ratePct).replace('.', ',')}%/năm` : 'không lãi';
              const sub =
                now > due
                  ? `Người thân · đã trả ${monthLabel(due).toLowerCase()}`
                  : `Người thân · ${rate} · trả một lần ${monthLabel(due).toLowerCase()}`;
              return (
                <Line
                  key={l.id}
                  name={l.name}
                  sub={sub}
                  amount={total}
                  color={now > due ? c.muted : c.text}
                  onPress={() => setLoan({ open: true, item: null, family: l })}
                />
              );
            })}
            <Btn label="Thêm khoản vay" icon="add" kind="ghost" style={{ marginTop: 8 }} onPress={() => setLoan({ open: true, item: null, family: null })} />
          </Card>

          <Card eye={'budget.instalments'} style={{ gap: 2 }}>
            <Row style={{ marginBottom: 6 }}>
              <Txt v="heading">Trả góp qua thẻ</Txt>
              <Amount value={instalments.reduce((s, p) => { const n = instalmentPart(p, cycleMonth); return s + (n ? instalmentAmount(p, n) : 0); }, 0)} color={c.muted} />
            </Row>
            {instalments.length === 0 ? (
              <Txt v="label">Chưa có khoản trả góp nào. Nhập tổng tiền và số tháng, Finy tự chia ra mỗi tháng và cộng vào chi tín dụng.</Txt>
            ) : null}
            {[...instalments]
              .sort((a, b) => (instalmentPart(b, cycleMonth) ? 1 : 0) - (instalmentPart(a, cycleMonth) ? 1 : 0) || a.startMonth.localeCompare(b.startMonth))
              .map((p) => {
                const part = instalmentPart(p, cycleMonth);
                const end = shiftMonth(p.startMonth, p.months - 1);
                const sub = part
                  ? `Kỳ ${part}/${p.months} · tổng ${money(p.total)} · đến ${monthLabel(end).toLowerCase()}`
                  : cycleMonth < p.startMonth
                    ? `${p.months} tháng · bắt đầu ${monthLabel(p.startMonth).toLowerCase()}`
                    : `Đã trả xong ${monthLabel(end).toLowerCase()}`;
                return (
                  <Line
                    key={p.id}
                    name={p.name}
                    sub={sub}
                    amount={instalmentAmount(p, part ?? 1)}
                    color={part ? c.text : c.muted}
                    onPress={() => setInst({ open: true, item: p })}
                  />
                );
              })}
            <Btn label="Thêm khoản trả góp" icon="add" kind="ghost" style={{ marginTop: 8 }} onPress={() => setInst({ open: true, item: null })} />
          </Card>

          <Card eye={'budget.fixedSummary'} style={{ gap: 6 }}>
            <Txt v="label">{base.saving < 0 ? 'Mỗi tháng thiếu (chưa tính phát sinh)' : 'Mỗi tháng để dành được (chưa tính phát sinh)'}</Txt>
            <Amount v="hero" value={Math.abs(base.saving)} color={base.saving < 0 ? c.negative : c.positive} />
            <Txt v="small">= thu cố định − chi cố định. Muốn một tháng khác đi, mở tháng đó trong “Bảng thu chi” để sửa riêng hoặc thêm khoản phát sinh.</Txt>
          </Card>
        </>
      ) : null}

      {view === 'accounts' ? (
        <Card eye={'budget.accounts'} style={{ gap: 4 }}>
          <Txt v="label">Tổng tiền hiện có</Txt>
          <Amount v="hero" value={total} color={total < 0 ? c.negative : c.text} />
          <View style={{ height: 8 }} />
          {accounts.length === 0 ? <Txt v="label">Thêm các tài khoản, sổ tiết kiệm, khoản đầu tư và khoản nợ để Finy biết bạn đang có bao nhiêu.</Txt> : null}
          {accounts.map((a) => {
            const kind = ACCOUNT_KINDS.find((k) => k.value === a.kind) ?? ACCOUNT_KINDS[1];
            return (
              <Line
                key={a.id}
                name={a.name}
                sub={kind.label}
                amount={a.kind === 'debt' ? -a.balance : a.balance}
                color={a.kind === 'debt' ? c.negative : c.text}
                icon={<Ionicons name={kind.icon} size={20} color={c.muted} />}
                onPress={() => setAccount(a)}
              />
            );
          })}
          <Btn label="Thêm tài khoản" icon="add" kind="ghost" onPress={() => setAccount(null)} style={{ marginTop: 8 }} />
        </Card>
      ) : null}

      <View style={{ height: gap }} />
      <FixedSheet visible={fixedSheet.open} onClose={() => setFixedSheet(null)} direction={fixedSheet.direction} item={fixedSheet.item} />
      <AccountSheet visible={account !== undefined} onClose={() => setAccount(undefined)} account={account} />
      <NumberSheet
        visible={cashOpen}
        onClose={() => setCashOpen(false)}
        title="Tiền đang có"
        label="Tổng tiền bạn đang có"
        hint="Dùng làm điểm xuất phát cho cột Dự kiến, tính từ tháng này."
        value={cash?.amount ?? 0}
        onSave={(n) => setCash(n ?? 0)}
      />
      <CreditPlanSheet visible={planOpen} onClose={() => setPlanOpen(false)} month={cycleMonth} />
      <LoanSheet visible={loan.open} onClose={() => setLoan((v) => ({ ...v, open: false }))} item={loan.item} familyItem={loan.family ?? null} />
      <InstalmentSheet visible={inst.open} onClose={() => setInst((v) => ({ ...v, open: false }))} item={inst.item} defaultStart={cycleMonth} />
    </Screen>
  );
}
