// Every credit-card transaction of one statement cycle (e.g. 15/11 – 14/12),
// with the cycle's total against the plan.
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { InstalmentSheet, TxSheet } from '../components/sheets';
import { Amount, Btn, Card, Empty, IconBtn, Meter, Row, Screen, Txt, useMoney, useUi } from '../components/ui';
import { creditCycle, cycleMonthOf, instalmentAmount, instalmentPart, monthFlow } from '../lib/finance';
import { dateKey, fmtTime, monthLabel, shiftMonth } from '../lib/format';
import { useBudget } from '../lib/hooks';
import { useStore } from '../lib/store';
import type { Instalment, Tx } from '../lib/types';

const shortDate = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

export default function CreditCycleScreen() {
  const { c } = useUi();
  const money = useMoney();
  const { budget, credit } = useBudget();
  const statementDay = useStore((s) => s.settings.statementDay);
  const txs = useStore((s) => s.txs);
  const params = useLocalSearchParams<{ month?: string }>();
  const today = dateKey();
  const initial = typeof params.month === 'string' && /^\d{4}-\d{2}$/.test(params.month) ? params.month : cycleMonthOf(today, statementDay);
  const [month, setMonth] = useState(initial);
  const [tx, setTx] = useState<Tx | undefined>(undefined);
  const instalments = useStore((s) => s.instalments);
  // `open` separate from the payload so the sheet keeps its content while closing.
  const [inst, setInst] = useState<{ open: boolean; item: Instalment | null }>({ open: false, item: null });

  const cycle = useMemo(() => creditCycle(month, statementDay), [month, statementDay]);
  const flow = useMemo(() => monthFlow(budget, month, credit), [budget, credit, month]);
  // Every card transaction in the cycle, newest first, grouped by day.
  const days = useMemo(() => {
    const list = txs.filter((t) => t.credit && t.date >= cycle.start && t.date <= cycle.end).sort((a, b) => b.ts - a.ts);
    const byDay = new Map<string, Tx[]>();
    for (const t of list) byDay.set(t.date, [...(byDay.get(t.date) ?? []), t]);
    return { count: list.length, groups: [...byDay.entries()] };
  }, [txs, cycle]);

  const open = today >= cycle.start && today <= cycle.end;
  const state = flow.creditClosed ? 'Đã chốt sổ' : open ? 'Đang trong kỳ' : 'Chưa bắt đầu';
  const hasPlan = flow.creditLine !== null;

  return (
    <Screen
      title="Thẻ tín dụng"
      eye="credit.list"
      right={
        <>
          <IconBtn name="chevron-back" onPress={() => setMonth(shiftMonth(month, -1))} label="Kỳ trước" />
          <IconBtn name="chevron-forward" onPress={() => setMonth(shiftMonth(month, 1))} label="Kỳ sau" />
          <IconBtn name="close" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} label="Đóng" />
        </>
      }>
      <Card eye={'credit.summary'} style={{ gap: 10 }}>
        <Row>
          <Txt v="heading">
            Kỳ {shortDate(cycle.start)} – {shortDate(cycle.end)}
          </Txt>
          <Txt v="small" color={flow.creditClosed ? c.text : c.muted}>{state}</Txt>
        </Row>
        <Row>
          <Txt v="label">Đã xài ({days.count} giao dịch)</Txt>
          <Amount v="title" value={flow.creditSpent} color={flow.creditOver > 0 ? c.negative : c.text} />
        </Row>
        {hasPlan ? (
          <>
            <Meter ratio={flow.creditPlanned > 0 ? flow.creditSpent / flow.creditPlanned : flow.creditSpent > 0 ? 1 : 0} color={flow.creditOver > 0 ? c.negative : c.accent} />
            <Row>
              <Txt v="small" numberOfLines={1} style={{ flexShrink: 1, marginRight: 8 }}>
                Dự chi {money(flow.creditPlanned)}
                {flow.creditLine?.name && flow.creditLine.name !== 'Dự chi tín dụng' ? ` · ${flow.creditLine.name}` : ''}
              </Txt>
              <Txt v="small" color={flow.creditOver > 0 ? c.negative : c.muted}>
                {flow.creditOver > 0 ? `Vượt ${money(flow.creditOver)}` : `${flow.creditClosed ? 'Thấp hơn' : 'Còn'} ${money(flow.creditPlanned - flow.creditSpent)}`}
              </Txt>
            </Row>
          </>
        ) : (
          <Txt v="small">Chưa đặt dự chi tín dụng (Ngân sách → Cố định → khoản chi loại “Tín dụng”).</Txt>
        )}
        <Pressable onPress={() => router.push(`/month/${month}`)} hitSlop={6} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <Txt v="small" color={c.accent}>
            {flow.creditClosed
              ? `Đã tính ${money(flow.creditCounted)} vào chi ${monthLabel(month).toLowerCase()} (số thực tế, thay cho dự chi) ›`
              : `Đang tính ${money(flow.creditCounted)} vào chi ${monthLabel(month).toLowerCase()}; chốt sổ ${shortDate(cycle.end)} sẽ thay bằng số thực tế ›`}
          </Txt>
        </Pressable>
      </Card>

      <Card eye={'credit.instalments'} style={{ gap: 2 }}>
        <Row style={{ marginBottom: 4 }}>
          <Txt v="heading">Trả góp qua thẻ</Txt>
          <Amount value={flow.instalmentLines.reduce((s, l) => s + l.amount, 0)} color={c.muted} />
        </Row>
        {instalments.length === 0 ? <Txt v="label">Chưa có khoản trả góp nào.</Txt> : null}
        {[...instalments]
          .sort((a, b) => (instalmentPart(b, month) ? 1 : 0) - (instalmentPart(a, month) ? 1 : 0) || a.startMonth.localeCompare(b.startMonth))
          .map((p) => {
            const part = instalmentPart(p, month);
            const end = shiftMonth(p.startMonth, p.months - 1);
            const status = part
              ? `Kỳ ${part}/${p.months} · tổng ${money(p.total)}`
              : month < p.startMonth
                ? `Bắt đầu ${monthLabel(p.startMonth).toLowerCase()}`
                : `Đã trả xong (${monthLabel(end).toLowerCase()})`;
            return (
              <Pressable key={p.id} onPress={() => setInst({ open: true, item: p })} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, minHeight: 52, justifyContent: 'center' })}>
                <Row>
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <Txt numberOfLines={1} color={part ? c.text : c.muted}>{p.name}</Txt>
                    <Txt v="small">{status}</Txt>
                  </View>
                  <Amount value={part ? instalmentAmount(p, part) : 0} color={part ? c.text : c.muted} />
                  <Ionicons name="chevron-forward" size={16} color={c.muted} style={{ marginLeft: 6 }} />
                </Row>
              </Pressable>
            );
          })}
        <Txt v="small" style={{ marginTop: 6 }}>Thêm hoặc sửa trả góp ở Ngân sách → Cố định.</Txt>
      </Card>

      {flow.onCardLines.length ? (
        <Card eye={'credit.oncard'} style={{ gap: 2 }}>
          <Txt v="heading" style={{ marginBottom: 4 }}>Trả qua thẻ mỗi kỳ</Txt>
          {flow.onCardLines.map((l) => (
            <Row key={l.id} style={{ minHeight: 44 }}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Txt numberOfLines={1}>{l.name}</Txt>
                <Txt v="small">Khoản cố định · không có email báo</Txt>
              </View>
              <Amount value={l.amount} />
            </Row>
          ))}
        </Card>
      ) : null}

      {days.count === 0 ? <Empty icon="card-outline" text="Chưa có giao dịch thẻ nào trong kỳ này." /> : null}

      {days.groups.map(([date, list]) => {
        const [y, m, d] = date.split('-').map(Number);
        const dayTotal = list.reduce((s, t) => s + (t.direction === 'out' ? t.amount : -t.amount), 0);
        return (
          <Card key={date} style={{ gap: 2 }}>
            <Row style={{ marginBottom: 4 }}>
              <Txt v="heading">
                {WEEKDAYS[new Date(y, m - 1, d).getDay()]}, {d}/{m}/{y}
              </Txt>
              <Amount value={dayTotal} color={c.muted} />
            </Row>
            {list.map((t) => (
              <Pressable key={t.id} onPress={() => setTx(t)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, minHeight: 52, justifyContent: 'center' })}>
                <Row>
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <Txt numberOfLines={2}>{t.note}</Txt>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Ionicons name="time-outline" size={12} color={c.muted} />
                      <Txt v="small">
                        {fmtTime(t.ts)} · {t.source === 'hsbc' ? 'HSBC' : 'nhập tay'}
                        {t.direction === 'in' ? ' · hoàn tiền' : ''}
                      </Txt>
                    </View>
                  </View>
                  <Amount value={t.direction === 'out' ? t.amount : -t.amount} color={t.direction === 'in' ? c.positive : c.text} />
                </Row>
              </Pressable>
            ))}
          </Card>
        );
      })}
      <Txt v="small">Giờ giao dịch là lúc HSBC gửi email thông báo (thường vài giây sau khi quẹt thẻ); email chỉ ghi ngày.</Txt>
      <TxSheet visible={tx !== undefined} onClose={() => setTx(undefined)} tx={tx} />
      <InstalmentSheet visible={inst.open} onClose={() => setInst((v) => ({ ...v, open: false }))} item={inst.item} defaultStart={month} />
    </Screen>
  );
}
