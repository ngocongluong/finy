// One month in detail: income and expenses as two separate sections, every
// line editable, plus the credit-card cycle that closes in this month.
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { CreditPlanSheet, LoanSheet, MonthLineSheet, OneOffSheet, periodLabel, TxSheet } from '../../components/sheets';
import { Amount, Btn, Card, IconBtn, Meter, Row, Screen, secret, Txt, useMoney, useUi } from '../../components/ui';
import { creditCycle, debtAtEnd, fixedPeriodAt, monthFlow, projectedCash, type Line } from '../../lib/finance';
import { dateKey, fmtPct, fmtTime, monthKey, monthLabel, shiftMonth } from '../../lib/format';
import { useBudget } from '../../lib/hooks';
import { useStore } from '../../lib/store';
import type { FamilyLoan, FixedItem, Loan, OneOff, Tx } from '../../lib/types';

const shortDate = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;

function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2).getTime() - new Date(y1, m1 - 1, d1).getTime()) / 86_400_000);
}

export default function MonthDetail() {
  const { c, gap } = useUi();
  const money = useMoney();
  const params = useLocalSearchParams<{ month?: string }>();
  const initial = typeof params.month === 'string' && /^\d{4}-\d{2}$/.test(params.month) ? params.month : monthKey();
  const [month, setMonth] = useState(initial);

  const { budget, credit } = useBudget();
  const txs = useStore((s) => s.txs);
  const statementDay = useStore((s) => s.settings.statementDay);

  const [fixedEdit, setFixedEdit] = useState<{ open: boolean; item: FixedItem | null }>({ open: false, item: null });
  const [oneOff, setOneOff] = useState<{ open: boolean; item: OneOff | null; direction: 'in' | 'out' }>({ open: false, item: null, direction: 'out' });
  const [creditSetup, setCreditSetup] = useState(false);
  const [loanEdit, setLoanEdit] = useState<{ open: boolean; item: Loan | null; family?: FamilyLoan | null }>({ open: false, item: null });
  const [tx, setTx] = useState<Tx | undefined>(undefined);

  const flow = useMemo(() => monthFlow(budget, month, credit), [budget, credit, month]);
  // Where things stand at the end of the month: the money expected (as in the table's
  // "Dự kiến" column), what is still owed on bank loans after this month's payment, and the difference.
  const cash = useStore((s) => s.cash);
  const position = useMemo(
    () => ({
      money: projectedCash(budget, cash, [month], credit).get(month) ?? null,
      debt: debtAtEnd(budget, month),
    }),
    [budget, cash, credit, month],
  );
  const cycle = useMemo(() => creditCycle(month, statementDay), [month, statementDay]);
  const cycleTxs = useMemo(
    () => txs.filter((t) => t.credit && t.date >= cycle.start && t.date <= cycle.end).sort((a, b) => b.ts - a.ts),
    [txs, cycle],
  );

  const today = dateKey();
  const cycleOpen = today >= cycle.start && today <= cycle.end;
  const daysToStatement = cycleOpen ? daysBetween(today, cycle.end) : 0;

  const openLine = (l: Line) => {
    if (l.id === 'credit-plan') {
      setCreditSetup(true);
    } else if (l.source === 'fixed') {
      const item = budget.fixed.find((f) => f.id === l.id);
      if (item) setFixedEdit({ open: true, item });
    } else if (l.source === 'loan') {
      // Prepayment and family-loan lines carry the loan's id with a suffix.
      const id = l.id.split('#')[0];
      const item = (budget.loans ?? []).find((x) => x.id === id);
      const family = (budget.familyLoans ?? []).find((x) => x.id === id);
      if (item || family) setLoanEdit({ open: true, item: item ?? null, family: family ?? null });
    } else {
      const item = budget.oneOffs.find((o) => o.id === l.id);
      if (item) setOneOff({ open: true, item, direction: item.direction });
    }
  };

  // For an item whose amount changes over time: the period this month is in.
  const periodOf = (l: Line) => {
    if (l.source !== 'fixed') return null;
    const p = fixedPeriodAt(budget.fixed.find((f) => f.id === l.id) ?? {}, month);
    return p ? periodLabel(p) : null;
  };

  // What a line is, shown under its name.
  const lineSub = (l: Line): string => {
    if (l.source === 'oneoff') return 'Phát sinh';
    if (l.source === 'loan') {
      if (l.id.endsWith('#due')) return 'Vay người thân · trả một lần gốc + lãi';
      if (l.id.endsWith('#receive')) return 'Vay người thân · tiền nhận được';
      if (l.id.endsWith('#payoff')) return 'Trả hết dư nợ · kết thúc khoản vay';
      if (l.id.endsWith('#prepay')) return 'Trả trước khoản vay · đầu giai đoạn mới';
      return 'Vay ngân hàng · trả góp đều';
    }
    if (l.overridden) return `Chỉnh riêng tháng này · thường ${money(l.base ?? 0, true)}`;
    const period = periodOf(l);
    if (period) return `Cố định · giai đoạn ${period}`;
    if (l.kind === 'debt') return 'Cố định · trả nợ vay';
    if (l.daily) return 'Cố định · quỹ chi tiêu hằng ngày';
    return 'Cố định';
  };

  const renderLine = (l: Line, positive?: boolean) => (
    <Pressable
      key={`${l.source}-${l.id}`}
      onPress={() => openLine(l)}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, minHeight: 52, justifyContent: 'center' })}>
      <Row>
        <View style={{ flex: 1, marginRight: 12 }}>
          <Txt numberOfLines={1}>{l.name}</Txt>
          <Txt v="small" color={l.overridden ? c.accent : c.muted}>
            {lineSub(l)}
          </Txt>
        </View>
        <Amount value={l.amount} color={positive ? c.positive : c.text} />
        <Ionicons name="chevron-forward" size={16} color={c.muted} style={{ marginLeft: 6 }} />
      </Row>
    </Pressable>
  );

  return (
    <Screen
      title={monthLabel(month)}
      right={
        <>
          <IconBtn name="chevron-back" onPress={() => setMonth(shiftMonth(month, -1))} label="Tháng trước" />
          <IconBtn name="chevron-forward" onPress={() => setMonth(shiftMonth(month, 1))} label="Tháng sau" />
          <IconBtn name="close" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} label="Đóng" />
        </>
      }>
      <Card eye={'month.summary'} style={{ gap: 10 }}>
        <Row><Txt v="label">Tổng thu</Txt><Amount value={flow.income} /></Row>
        <Row><Txt v="label">Tổng chi</Txt><Amount value={flow.expense} /></Row>
        <View style={{ height: 1, backgroundColor: c.border }} />
        <Row>
          <Txt v="heading">{flow.saving < 0 ? 'Thiếu hụt' : 'Để dành được'}</Txt>
          <Amount v="title" value={Math.abs(flow.saving)} color={flow.saving < 0 ? c.negative : c.positive} />
        </Row>
        <View style={{ gap: 6 }}>
          <Row>
            <Txt v="label">Chi/Thu</Txt>
            <Txt v="num">{secret(fmtPct(flow.spendRatio))}</Txt>
          </Row>
          <Meter ratio={flow.spendRatio} color={flow.spendRatio > 1 ? c.negative : c.accent} />
        </View>
      </Card>

      {/* ---- Cuối tháng: tiền dự kiến, nợ, còn lại ---- */}
      <Card eye={'month.position'} style={{ gap: 10 }}>
        <Txt v="heading">Cuối {monthLabel(month).toLowerCase()}</Txt>
        <Row style={{ gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Txt v="label">Tiền dự kiến có</Txt>
            <Txt v="small">
              {position.money !== null
                ? 'tiền đang có + để dành cộng dồn đến hết tháng'
                : cash
                  ? `chỉ tính từ ${monthLabel(cash.month).toLowerCase()}, tháng nhập tiền đang có`
                  : 'nhập Tiền đang có ở Bảng thu chi để xem'}
            </Txt>
          </View>
          {position.money === null ? (
            <Txt v="heading" color={c.muted}>—</Txt>
          ) : (
            <Amount v="heading" value={position.money} color={position.money < 0 ? c.negative : c.positive} style={{ flexShrink: 1, maxWidth: '58%', textAlign: 'right' }} />
          )}
        </Row>
        <Row style={{ gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Txt v="label">Còn nợ</Txt>
            <Txt v="small">{budget.loans?.length || budget.familyLoans?.length ? 'dư nợ các khoản vay cuối tháng' : 'chưa có khoản vay'}</Txt>
          </View>
          <Amount v="heading" value={position.debt} color={position.debt > 0 ? c.negative : c.text} style={{ flexShrink: 1, maxWidth: '58%', textAlign: 'right' }} />
        </Row>
        <View style={{ height: 1, backgroundColor: c.border }} />
        <Row style={{ gap: 12 }}>
          <Txt v="label" style={{ flex: 1 }}>Còn lại sau nợ</Txt>
          {position.money === null ? (
            <Txt v="heading" color={c.muted}>—</Txt>
          ) : (
            <Amount
              value={position.money - position.debt}
              color={position.money - position.debt < 0 ? c.negative : c.positive}
              style={{ flexShrink: 1, maxWidth: '58%', textAlign: 'right' }}
            />
          )}
        </Row>
      </Card>

      {/* ---- Thu ---- */}
      <Card eye={'month.in'} style={{ gap: 2 }}>
        <Row style={{ marginBottom: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="arrow-down-circle" size={20} color={c.positive} />
            <Txt v="heading">Thu</Txt>
          </View>
          <Amount value={flow.income} color={c.positive} />
        </Row>
        {flow.incomeLines.length === 0 ? <Txt v="label">Chưa có khoản thu nào trong tháng này.</Txt> : null}
        {flow.incomeLines.map((l) => renderLine(l, true))}
        <Btn label="Thêm khoản thu tháng này" icon="add" kind="ghost" style={{ marginTop: 8 }} onPress={() => setOneOff({ open: true, item: null, direction: 'in' })} />
      </Card>

      {/* ---- Chi ---- */}
      <Card eye={'month.out'} style={{ gap: 2 }}>
        <Row style={{ marginBottom: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="arrow-up-circle" size={20} color={c.negative} />
            <Txt v="heading">Chi</Txt>
          </View>
          <Amount value={flow.expense} />
        </Row>
        {flow.expenseLines.length === 0 && !flow.creditCounted ? <Txt v="label">Chưa có khoản chi nào trong tháng này.</Txt> : null}
        {flow.expenseLines.map((l) => renderLine(l))}
        {flow.creditLine || flow.creditCounted > 0 ? (
          <Pressable
            onPress={() => router.push(`/credit?month=${month}`)}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, minHeight: 52, justifyContent: 'center' })}>
            <Row>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Txt numberOfLines={1}>Thẻ tín dụng · kỳ {shortDate(cycle.start)} – {shortDate(cycle.end)}</Txt>
                <Txt v="small" color={flow.creditOver > 0 ? c.negative : flow.creditClosed ? c.positive : c.muted}>
                  {flow.creditClosed ? 'Đã chốt sổ · số thực tế' : flow.creditOver > 0 ? 'Đang vượt dự chi' : 'Chưa chốt · theo dự chi'}
                </Txt>
              </View>
              <Amount value={flow.creditCounted} />
              <Ionicons name="chevron-forward" size={16} color={c.muted} style={{ marginLeft: 6 }} />
            </Row>
          </Pressable>
        ) : null}
        <Btn label="Thêm khoản chi tháng này" icon="add" kind="ghost" style={{ marginTop: 8 }} onPress={() => setOneOff({ open: true, item: null, direction: 'out' })} />
      </Card>

      {/* ---- Chi tín dụng ---- */}
      <Card eye={'month.credit'} style={{ gap: 10 }}>
        <Row>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="card" size={20} color={c.accent} />
            <Txt v="heading">Chi tín dụng</Txt>
          </View>
          <Amount value={flow.creditCounted} />
        </Row>
        <Txt v="small">
          Kỳ sao kê {shortDate(cycle.start)} – {shortDate(cycle.end)}
          {cycleOpen ? (daysToStatement === 0 ? ' · hôm nay chốt sao kê' : ` · còn ${daysToStatement} ngày đến ngày sao kê`) : flow.creditClosed ? ' · đã chốt sổ, tính theo số thực tế' : ' · chưa bắt đầu'}
        </Txt>

        {flow.creditLine ? (
          <>
            {renderLine({ ...flow.creditLine, name: 'Dự chi tín dụng', overridden: false })}
            <Txt v="small" style={{ marginTop: -4 }}>{flow.creditLine.name}</Txt>
            <Row>
              <Txt v="label">Đã xài trong kỳ ({cycleTxs.length} giao dịch)</Txt>
              <Amount value={flow.creditSpent} color={flow.creditOver > 0 ? c.negative : c.text} />
            </Row>
            <Meter ratio={flow.creditPlanned > 0 ? flow.creditSpent / flow.creditPlanned : flow.creditSpent > 0 ? 1 : 0} color={flow.creditOver > 0 ? c.negative : c.accent} />
            {flow.creditOver > 0 ? (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                <Ionicons name="warning" size={18} color={c.negative} />
                <Txt color={c.negative} style={{ flex: 1 }}>
                  Vượt dự chi {money(flow.creditOver)}. Tháng này tính {money(flow.creditCounted)} cho thẻ.
                </Txt>
              </View>
            ) : flow.creditClosed ? (
              <Txt v="small">Kỳ đã chốt: tháng này tính {money(flow.creditCounted)} (số thực tế) thay cho dự chi.</Txt>
            ) : (
              <Txt v="small">Còn {money(flow.creditPlanned - flow.creditSpent)} trong dự chi của kỳ này.</Txt>
            )}
          </>
        ) : (
          <>
            <Txt v="label">Chưa đặt dự chi tín dụng. Đặt số tiền dự định quẹt thẻ mỗi kỳ để Finy báo khi vượt.</Txt>
            {flow.creditSpent > 0 ? <Row><Txt v="label">Đã xài trong kỳ</Txt><Amount value={flow.creditSpent} /></Row> : null}
            <Btn label="Đặt dự chi tín dụng" icon="add" kind="ghost" onPress={() => setCreditSetup(true)} />
          </>
        )}

        <Btn label={`Xem toàn bộ ${cycleTxs.length} giao dịch của kỳ`} icon="list-outline" kind="ghost" onPress={() => router.push(`/credit?month=${month}`)} />
        {cycleTxs.length ? <View style={{ height: 1, backgroundColor: c.border }} /> : null}
        {cycleTxs.slice(0, 5).map((t) => (
          <Pressable key={t.id} onPress={() => setTx(t)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, minHeight: 44, justifyContent: 'center' })}>
            <Row>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Txt numberOfLines={1}>{t.note}</Txt>
                <Txt v="small">{shortDate(t.date)} {fmtTime(t.ts)}{t.source === 'hsbc' ? ' · HSBC' : ' · nhập tay'}</Txt>
              </View>
              <Amount value={t.direction === 'out' ? t.amount : -t.amount} color={t.direction === 'in' ? c.positive : c.text} />
            </Row>
          </Pressable>
        ))}
        {cycleTxs.length > 5 ? <Txt v="small">5 giao dịch gần nhất — xem toàn bộ ở nút trên.</Txt> : null}
      </Card>

      <View style={{ height: gap }} />
      <MonthLineSheet visible={fixedEdit.open} onClose={() => setFixedEdit((s) => ({ ...s, open: false }))} month={month} item={fixedEdit.item} />
      <OneOffSheet
        visible={oneOff.open}
        onClose={() => setOneOff((s) => ({ ...s, open: false }))}
        item={oneOff.item}
        defaultMonth={month}
        defaultDirection={oneOff.direction}
      />
      <CreditPlanSheet visible={creditSetup} onClose={() => setCreditSetup(false)} month={month} />
      <LoanSheet visible={loanEdit.open} onClose={() => setLoanEdit((v) => ({ ...v, open: false }))} item={loanEdit.item} familyItem={loanEdit.family ?? null} />
      <TxSheet visible={tx !== undefined} onClose={() => setTx(undefined)} tx={tx} />
    </Screen>
  );
}
