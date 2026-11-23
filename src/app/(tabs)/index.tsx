import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { Sparkline } from '../../components/charts';
import { Amount, Btn, Card, Empty, IconBtn, Meter, Row, Screen, Txt, useMoney, useUi } from '../../components/ui';
import { creditCycle, cycleMonthOf, dailyStats, monthFlow, netWorth, type MonthFlow } from '../../lib/finance';
import { dateKey, fmtDateTime, fmtPct, fmtTime, monthKey, monthLabel } from '../../lib/format';
import { useBudget } from '../../lib/hooks';
import { project, resolvePlan } from '../../lib/plan';
import { useStore } from '../../lib/store';
import { alpha, CHART, METRIC_LABELS } from '../../lib/theme';
import type { HomeSectionId, MetricKey } from '../../lib/types';

/** One statement cycle: what was spent, against the plan. Tapping opens all its transactions. */
function CycleBox({ flow, title, statementDay }: { flow: MonthFlow; title: string; statementDay: number }) {
  const { c, r } = useUi();
  const money = useMoney();
  const cyc = creditCycle(flow.month, statementDay);
  const sd = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
  const hasPlan = flow.creditLine !== null;
  return (
    <Pressable
      onPress={() => router.push(`/credit?month=${flow.month}`)}
      accessibilityRole="button"
      accessibilityLabel={`${title}, từ ${sd(cyc.start)} đến ${sd(cyc.end)}. Chạm để xem toàn bộ giao dịch.`}
      style={({ pressed }) => ({ backgroundColor: c.cardAlt, borderRadius: Math.min(r, 14), padding: 12, gap: 8, opacity: pressed ? 0.75 : 1 })}>
      <Row>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt v="label" color={c.text}>{title}</Txt>
          {flow.creditClosed ? (
            <View style={{ backgroundColor: alpha(c.positive, 0.18), borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="checkmark-circle" size={12} color={c.positive} />
              <Txt v="small" color={c.positive} style={{ fontWeight: '700' }}>Đã chốt sổ</Txt>
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Txt v="small">{sd(cyc.start)} – {sd(cyc.end)}</Txt>
          <Ionicons name="chevron-forward" size={14} color={c.muted} />
        </View>
      </Row>
      <Amount v="title" value={flow.creditSpent} color={flow.creditOver > 0 ? c.negative : c.text} />
      {hasPlan ? (
        <>
          <Meter ratio={flow.creditPlanned > 0 ? flow.creditSpent / flow.creditPlanned : flow.creditSpent > 0 ? 1 : 0} color={flow.creditOver > 0 ? c.negative : c.accent} />
          <Row>
            <Txt v="small">Dự chi {money(flow.creditPlanned)}</Txt>
            <Txt v="small" color={flow.creditOver > 0 ? c.negative : c.muted}>
              {flow.creditOver > 0 ? `Vượt ${money(flow.creditOver)}` : flow.creditClosed ? `Thấp hơn ${money(flow.creditPlanned - flow.creditSpent)}` : `Còn ${money(flow.creditPlanned - flow.creditSpent)}`}
            </Txt>
          </Row>
        </>
      ) : (
        <Txt v="small">Chưa đặt dự chi tín dụng.</Txt>
      )}
      {flow.creditClosed ? <Txt v="small">Tính vào chi {monthLabel(flow.month).toLowerCase()} theo số thực tế.</Txt> : null}
    </Pressable>
  );
}

export default function Home() {
  const { c, gap } = useUi();
  const money = useMoney();
  const ui = useStore((s) => s.ui);
  const { budget, credit } = useBudget();
  const statementDay = useStore((s) => s.settings.statementDay);
  const creditCard = useStore((s) => s.creditCard);
  const accounts = useStore((s) => s.accounts);
  const txs = useStore((s) => s.txs);
  const plan = useStore((s) => s.plan);
  const hide = useStore((s) => s.hideAmounts);
  const toggleHide = useStore((s) => s.toggleHide);

  const today = dateKey();
  const month = monthKey();
  const sum = useMemo(() => monthFlow(budget, month, credit), [budget, credit, month]);
  // The statement cycle open today (it may close next month), compared with the plan.
  const cycle = useMemo(() => creditCycle(cycleMonthOf(today, statementDay), statementDay), [today, statementDay]);
  const card = useMemo(() => monthFlow(budget, cycle.month, credit), [budget, credit, cycle.month]);
  // From the day after the statement day, the cycle that closed this month is shown too:
  // its total is final and is paid with this month's salary.
  const closedCard = useMemo(
    () => (cycle.month !== month ? monthFlow(budget, month, credit) : null),
    [budget, credit, cycle.month, month],
  );
  const shortDate = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
  const daily = useMemo(() => dailyStats(sum.dailyBucket, txs, today), [sum.dailyBucket, txs, today]);
  // This month's expenses, largest first, at the amounts that apply this month.
  const outs = useMemo(
    () =>
      [...sum.expenseLines, ...(sum.creditLine ? [sum.creditLine] : [])]
        .filter((i) => i.amount > 0)
        .sort((a, b) => b.amount - a.amount),
    [sum],
  );
  const total = useMemo(() => netWorth(accounts), [accounts]);
  const proj = useMemo(() => project(resolvePlan(plan, budget, accounts, month)), [plan, budget, accounts, month]);
  const lastRow = proj.rows[proj.rows.length - 1];

  const metric = (k: MetricKey): string => {
    switch (k) {
      case 'income': return money(sum.income);
      case 'expense': return money(sum.expense);
      case 'saving': return money(sum.saving);
      case 'extraIncome': return money(sum.extraIn);
      case 'extraExpense': return money(sum.extraOut);
      case 'debtPayment': return money(sum.debtPayment);
      case 'creditSpent': return money(card.creditSpent);
      case 'creditPlanned': return money(card.creditPlanned);
      case 'spendRatio': return fmtPct(sum.spendRatio);
      case 'savingRate': return fmtPct(sum.savingRate);
      case 'netWorth': return money(total);
      case 'dailyAllowance': return money(daily.allowance);
      case 'spentToday': return money(daily.spentToday);
      case 'spentMonth': return money(daily.spentMonth);
      case 'projectedNetWorth': return money(lastRow.netWorth);
    }
  };

  const sections: Record<HomeSectionId, React.ReactNode> = {
    credit:
      card.creditLine || card.creditSpent > 0 || (closedCard && closedCard.creditSpent > 0) ? (
        <Card key="credit" style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="card" size={18} color={c.accent} />
            <Txt v="heading">Thẻ tín dụng</Txt>
          </View>
          <CycleBox flow={card} title={closedCard ? 'Kỳ này' : 'Kỳ hiện tại'} statementDay={statementDay} />
          {closedCard ? <CycleBox flow={closedCard} title="Kỳ trước" statementDay={statementDay} /> : null}
          {creditCard ? (
            <Txt v="small">
              Dư nợ {money(creditCard.balance)} · còn khả dụng {money(creditCard.available)} (HSBC báo lúc {fmtDateTime(creditCard.asOf)})
            </Txt>
          ) : null}
        </Card>
      ) : null,
    month: (
      <Card key="month" style={{ gap: 10 }} onPress={() => router.push(`/month/${month}`)}>
        <Txt v="heading">{monthLabel(month)}</Txt>
        <Row><Txt v="label">Thu{sum.extraIn > 0 ? ' (gồm phát sinh)' : ''}</Txt><Amount value={sum.income} /></Row>
        <Row><Txt v="label">Chi{sum.extraOut > 0 || sum.creditOver > 0 ? ' (gồm phát sinh)' : ''}</Txt><Amount value={sum.expense} /></Row>
        <Row>
          <Txt v="label">{sum.saving < 0 ? 'Thiếu hụt' : 'Để dành được'}</Txt>
          <Amount value={Math.abs(sum.saving)} color={sum.saving < 0 ? c.negative : c.positive} />
        </Row>
        <View style={{ gap: 6, marginTop: 4 }}>
          <Row>
            <Txt v="label">Chi/Thu</Txt>
            <Txt v="num">{hide ? '•••' : fmtPct(sum.spendRatio)}</Txt>
          </Row>
          <Meter ratio={sum.spendRatio} color={sum.spendRatio > 1 ? c.negative : c.accent} />
        </View>
      </Card>
    ),
    networth: (
      <Card key="networth" style={{ gap: 6 }} onPress={() => router.navigate('/budget')}>
        <Txt v="label">Tổng tiền hiện có</Txt>
        <Amount v="hero" value={total} color={total < 0 ? c.negative : c.text} />
        <Txt v="small">{accounts.length ? `${accounts.length} tài khoản — chạm để cập nhật` : 'Chưa có tài khoản nào — chạm để thêm'}</Txt>
      </Card>
    ),
    budget: (
      <Card key="budget" style={{ gap: 12 }} onPress={() => router.navigate('/budget')}>
        <Txt v="heading">Khoản chi lớn nhất tháng này</Txt>
        {outs.length ? (
          outs.slice(0, 5).map((i) => (
              <View key={i.id} style={{ gap: 5 }}>
                <Row>
                  <Txt numberOfLines={1} style={{ flex: 1, marginRight: 12 }}>{i.name}</Txt>
                  <Amount value={i.amount} />
                </Row>
                <Meter ratio={sum.expense > 0 ? i.amount / sum.expense : 0} color={CHART.series[0]} />
              </View>
            ))
        ) : (
          <Txt v="label">Chưa có khoản chi nào. Nhập thu chi cố định ở tab Ngân sách.</Txt>
        )}
      </Card>
    ),
    recent: (
      <Card key="recent" style={{ gap: 10 }} onPress={() => router.navigate('/transactions')}>
        <Txt v="heading">Giao dịch gần đây</Txt>
        {txs.length ? (
          txs.slice(0, 5).map((t) => (
            <Row key={t.id}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Txt numberOfLines={1}>{t.note}</Txt>
                <Txt v="small">{t.date.slice(8, 10)}/{t.date.slice(5, 7)} {fmtTime(t.ts)} · {t.source === 'hsbc' ? 'HSBC' : 'Nhập tay'}</Txt>
              </View>
              <Amount value={t.direction === 'out' ? -t.amount : t.amount} color={t.direction === 'in' ? c.positive : c.text} signed />
            </Row>
          ))
        ) : (
          <Txt v="label">Chưa có giao dịch.</Txt>
        )}
      </Card>
    ),
    plan: (
      <Card key="plan" style={{ gap: 6 }} onPress={() => router.navigate('/plan')}>
        <Txt v="label">Sau {lastRow.year} năm (kịch bản cơ sở)</Txt>
        <Amount v="title" value={lastRow.netWorth} color={lastRow.netWorth < 0 ? c.negative : c.text} />
        <Sparkline values={proj.rows.map((r) => r.netWorth)} />
        <Txt v="small">Tài sản ròng dự phóng — chạm để xem chi tiết</Txt>
      </Card>
    ),
    custom: ui.customCards.length ? (
      <React.Fragment key="custom">
        {ui.customCards.map((card) => (
          <Card key={card.id} style={{ gap: 8 }}>
            <Txt v="heading">{card.title}</Txt>
            {card.lines.map((l, i) =>
              l.metric ? (
                <Row key={i}>
                  <Txt v="label" style={{ flex: 1, marginRight: 12 }}>{l.label || METRIC_LABELS[l.metric]}</Txt>
                  <Txt v="num">{metric(l.metric)}</Txt>
                </Row>
              ) : (
                <View key={i}>
                  {l.label ? <Txt v="label">{l.label}</Txt> : null}
                  {l.text ? <Txt>{l.text}</Txt> : null}
                </View>
              ),
            )}
          </Card>
        ))}
      </React.Fragment>
    ) : null,
  };

  const visible = ui.home.filter((h) => h.visible).map((h) => sections[h.id]).filter(Boolean);

  return (
    <Screen
      title={ui.title}
      right={
        <>
          <IconBtn name="settings-outline" onPress={() => router.push('/settings')} label="Cài đặt" />
        </>
      }>
      {card.creditOver > 0 ? (
        <Pressable
          onPress={() => router.push(`/month/${cycle.month}`)}
          accessibilityRole="button"
          style={({ pressed }) => ({
            flexDirection: 'row',
            gap: 10,
            alignItems: 'flex-start',
            backgroundColor: alpha(c.negative, 0.14),
            borderColor: c.negative,
            borderWidth: 1,
            borderRadius: 14,
            padding: 12,
            opacity: pressed ? 0.8 : 1,
          })}>
          <Ionicons name="warning" size={20} color={c.negative} />
          <View style={{ flex: 1 }}>
            <Txt v="heading">Chi tín dụng vượt dự chi</Txt>
            <Txt v="label" color={c.text}>
              Kỳ sao kê {shortDate(cycle.end)}: đã xài {money(card.creditSpent)}, vượt {money(card.creditOver)} so với dự chi {money(card.creditPlanned)}.
            </Txt>
          </View>
        </Pressable>
      ) : null}
      {visible.length ? visible : <Empty icon="grid-outline" text="Mọi khối trên trang này đang ẩn. Nhờ Finy bật lại hoặc khôi phục giao diện trong Cài đặt." />}
    </Screen>
  );
}
