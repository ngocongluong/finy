import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { SpendBars, Sparkline } from '../../components/charts';
import { TxSheet } from '../../components/sheets';
import { Amount, Btn, Card, Empty, IconBtn, Meter, Row, Screen, Txt, useMoney, useUi } from '../../components/ui';
import { dailySeries, dailyStats, monthSummary, netWorth } from '../../lib/finance';
import { dateKey, fmtPct, monthKey, monthLabel } from '../../lib/format';
import { project, resolvePlan } from '../../lib/plan';
import { useStore } from '../../lib/store';
import { CHART, METRIC_LABELS } from '../../lib/theme';
import type { HomeSectionId, MetricKey } from '../../lib/types';

export default function Home() {
  const { c, gap } = useUi();
  const money = useMoney();
  const ui = useStore((s) => s.ui);
  const budgets = useStore((s) => s.budgets);
  const accounts = useStore((s) => s.accounts);
  const txs = useStore((s) => s.txs);
  const plan = useStore((s) => s.plan);
  const hide = useStore((s) => s.hideAmounts);
  const toggleHide = useStore((s) => s.toggleHide);
  const [addOpen, setAddOpen] = useState(false);

  const today = dateKey();
  const month = monthKey();
  const budget = budgets[month];
  const sum = useMemo(() => monthSummary(budget), [budget]);
  const daily = useMemo(() => dailyStats(budget, txs, today), [budget, txs, today]);
  const series = useMemo(() => dailySeries(txs, today, 14), [txs, today]);
  const total = useMemo(() => netWorth(accounts), [accounts]);
  const proj = useMemo(() => project(resolvePlan(plan, budget, accounts)), [plan, budget, accounts]);
  const lastRow = proj.rows[proj.rows.length - 1];

  const metric = (k: MetricKey): string => {
    switch (k) {
      case 'income': return money(sum.income);
      case 'totalOut': return money(sum.totalOut);
      case 'expense': return money(sum.expense);
      case 'saving': return money(sum.saving);
      case 'debtPayment': return money(sum.debtPayment);
      case 'remaining': return money(sum.remaining);
      case 'spendRatio': return fmtPct(sum.spendRatio);
      case 'savingRate': return fmtPct(sum.savingRate);
      case 'netWorth': return money(total);
      case 'dailyAllowance': return money(daily.allowance);
      case 'spentToday': return money(daily.spentToday);
      case 'spentMonth': return money(daily.spentMonth);
      case 'projectedNetWorth': return money(lastRow.netWorth);
    }
  };

  const over = daily.leftToday < 0;
  const sections: Record<HomeSectionId, React.ReactNode> = {
    today: (
      <Card key="today" style={{ gap }}>
        <Row>
          <Txt v="label">{over ? 'Hôm nay đã vượt hạn mức' : 'Hôm nay còn tiêu được'}</Txt>
          <Txt v="small">còn {daily.daysLeft} ngày trong tháng</Txt>
        </Row>
        {daily.bucket > 0 ? (
          <>
            <Amount v="hero" value={Math.abs(daily.leftToday)} color={over ? c.negative : c.text} />
            <Meter ratio={daily.allowance > 0 ? daily.spentToday / daily.allowance : daily.spentToday > 0 ? 1 : 0} color={over ? c.negative : c.accent} />
            <Row>
              <Txt v="small">Đã tiêu {money(daily.spentToday)}</Txt>
              <Txt v="small">Hạn mức {money(daily.allowance)}</Txt>
            </Row>
          </>
        ) : (
          <Txt v="label">Chưa có quỹ chi tiêu hằng ngày. Vào Ngân sách, mở một mục chi tiêu và bật “quỹ chi tiêu hằng ngày”.</Txt>
        )}
        <Btn label="Nhập chi tiêu" icon="add" onPress={() => setAddOpen(true)} />
        <View style={{ gap: 6 }}>
          <Txt v="small">Chi tiêu 14 ngày gần nhất</Txt>
          <SpendBars data={series} allowance={daily.baseAllowance} />
        </View>
        {daily.bucket > 0 ? (
          <Row>
            <Txt v="label">Quỹ tháng còn lại</Txt>
            <Amount value={daily.leftMonth} color={daily.leftMonth < 0 ? c.negative : c.text} />
          </Row>
        ) : null}
      </Card>
    ),
    month: (
      <Card key="month" style={{ gap: 10 }} onPress={() => router.navigate('/budget')}>
        <Txt v="heading">{monthLabel(month)}</Txt>
        <Row><Txt v="label">Thu nhập</Txt><Amount value={sum.income} /></Row>
        <Row><Txt v="label">Tổng chi (gồm để dành)</Txt><Amount value={sum.totalOut} /></Row>
        <Row><Txt v="label">Trong đó để dành</Txt><Amount value={sum.saving} /></Row>
        <Row>
          <Txt v="label">Tồn</Txt>
          <Amount value={sum.remaining} color={sum.remaining < 0 ? c.negative : c.positive} signed />
        </Row>
        <View style={{ gap: 6, marginTop: 4 }}>
          <Row>
            <Txt v="label">Chi/Thu (không tính để dành)</Txt>
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
        <Txt v="heading">Các mục lớn nhất</Txt>
        {budget?.items.length ? (
          [...budget.items]
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 5)
            .map((i) => (
              <View key={i.id} style={{ gap: 5 }}>
                <Row>
                  <Txt numberOfLines={1} style={{ flex: 1, marginRight: 12 }}>{i.name}</Txt>
                  <Amount value={i.amount} />
                </Row>
                <Meter ratio={sum.totalOut > 0 ? i.amount / sum.totalOut : 0} color={CHART.series[0]} />
              </View>
            ))
        ) : (
          <Txt v="label">Chưa có mục nào trong tháng này.</Txt>
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
                <Txt v="small">{t.date.slice(8, 10)}/{t.date.slice(5, 7)} · {t.source === 'hsbc' ? 'HSBC' : 'Nhập tay'}</Txt>
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
          <IconBtn name={hide ? 'eye-off-outline' : 'eye-outline'} onPress={toggleHide} label={hide ? 'Hiện số tiền' : 'Ẩn số tiền'} />
          <IconBtn name="settings-outline" onPress={() => router.push('/settings')} label="Cài đặt" />
        </>
      }>
      {visible.length ? visible : <Empty icon="grid-outline" text="Mọi khối trên trang này đang ẩn. Nhờ Finy bật lại hoặc khôi phục giao diện trong Cài đặt." />}
      <TxSheet visible={addOpen} onClose={() => setAddOpen(false)} />
    </Screen>
  );
}
