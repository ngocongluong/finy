// One month in detail: income and expenses as two separate sections, every
// line editable, plus the credit-card cycle that closes in this month.
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { CreditPlanSheet, LoanSheet, MonthLineSheet, OneOffSheet, TxSheet } from '../../components/sheets';
import { Amount, Btn, Card, IconBtn, Meter, Row, Screen, secret, Txt, useMoney, useUi } from '../../components/ui';
import { creditCycle, monthFlow, type Line } from '../../lib/finance';
import { dateKey, fmtPct, fmtTime, monthKey, monthLabel, shiftMonth } from '../../lib/format';
import { useBudget } from '../../lib/hooks';
import { useStore } from '../../lib/store';
import type { FixedItem, Loan, OneOff, Tx } from '../../lib/types';

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
  const [loanEdit, setLoanEdit] = useState<{ open: boolean; item: Loan | null }>({ open: false, item: null });
  const [tx, setTx] = useState<Tx | undefined>(undefined);

  const flow = useMemo(() => monthFlow(budget, month, credit), [budget, credit, month]);
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
      // A prepayment line carries the loan's id with a suffix.
      const item = (budget.loans ?? []).find((x) => x.id === l.id.split('#')[0]);
      if (item) setLoanEdit({ open: true, item });
    } else {
      const item = budget.oneOffs.find((o) => o.id === l.id);
      if (item) setOneOff({ open: true, item, direction: item.direction });
    }
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
            {l.source === 'oneoff'
              ? 'Phát sinh'
              : l.source === 'loan'
                ? l.id.endsWith('#prepay')
                  ? 'Trả trước khoản vay · đầu giai đoạn mới'
                  : 'Vay ngân hàng · trả góp đều'
              : l.overridden
                ? `Chỉnh riêng tháng này · thường ${money(l.base ?? 0, true)}`
                : l.kind === 'debt'
                  ? 'Cố định · trả nợ vay'
                  : l.daily
                    ? 'Cố định · quỹ chi tiêu hằng ngày'
                    : 'Cố định'}
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
      <CreditPlanSheet visible={creditSetup} onClose={() => setCreditSetup(false)} />
      <LoanSheet visible={loanEdit.open} onClose={() => setLoanEdit((v) => ({ ...v, open: false }))} item={loanEdit.item} />
      <TxSheet visible={tx !== undefined} onClose={() => setTx(undefined)} tx={tx} />
    </Screen>
  );
}
