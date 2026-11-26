import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';
import { TxSheet } from '../../components/sheets';
import { Amount, Btn, Card, Chip, Empty, IconBtn, Row, Screen, Txt, useMoney, useUi } from '../../components/ui';
import { dateKey, dayLabel, fmtDateTime, fmtTime, fmtVND } from '../../lib/format';
import { creditOverMessage, runSync, shouldAlertCreditOver } from '../../lib/hsbc';
import { useStore } from '../../lib/store';
import type { Tx } from '../../lib/types';

type Filter = 'all' | 'manual' | 'hsbc';

export default function Transactions() {
  const { c, gap } = useUi();
  const money = useMoney();
  const txs = useStore((s) => s.txs);
  const gmailEmail = useStore((s) => s.settings.gmailEmail);
  const lastSync = useStore((s) => s.settings.lastSyncTs);
  const report = useStore((s) => s.settings.lastSyncReport);

  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<Tx | null | undefined>(undefined); // undefined = closed, null = new
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [shown, setShown] = useState(60);

  const today = dateKey();
  const groups = useMemo(() => {
    const list = txs.filter((t) => filter === 'all' || t.source === filter).slice(0, shown);
    const byDay = new Map<string, Tx[]>();
    for (const t of list) byDay.set(t.date, [...(byDay.get(t.date) ?? []), t]);
    return [...byDay.entries()];
  }, [txs, filter, shown]);
  const totalCount = txs.filter((t) => filter === 'all' || t.source === filter).length;

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    setStatus({ text: 'Đang kết nối Gmail…' });
    try {
      const r = await runSync((text) => setStatus({ text }));
      // runSync records the outcome; the card below shows it.
      setStatus(null);
      if (r?.creditOver && (await shouldAlertCreditOver(r.creditOver))) Alert.alert('Chi tín dụng vượt dự chi', creditOverMessage(r.creditOver, fmtVND));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Screen title="Giao dịch" eye="tx.list" right={<IconBtn name="add-circle" size={28} color={c.accent} onPress={() => setEditing(null)} label="Nhập chi tiêu" />}>
      <Card style={{ gap: 10 }}>
        <Row>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Txt v="heading">HSBC qua Gmail</Txt>
            <Txt v="small">
              {gmailEmail
                ? `${gmailEmail}${lastSync ? ` · đồng bộ lần cuối ${fmtDateTime(lastSync)}` : ''}`
                : 'Chưa kết nối Gmail'}
            </Txt>
          </View>
          {syncing ? <ActivityIndicator color={c.accent} /> : null}
        </Row>
        {gmailEmail ? (
          <Btn label={syncing ? 'Đang đồng bộ…' : 'Đồng bộ giao dịch HSBC'} icon="sync" kind="ghost" onPress={sync} disabled={syncing} />
        ) : (
          <Btn label="Kết nối Gmail trong Cài đặt" icon="mail-outline" kind="ghost" onPress={() => router.push('/settings')} />
        )}
        {status ? (
          <Txt v="small" color={status.error ? c.negative : c.muted}>{status.text}</Txt>
        ) : report ? (
          <Txt v="small" color={report.error ? c.negative : c.muted}>
            {fmtDateTime(report.ts)}: {report.text}
          </Txt>
        ) : null}
      </Card>

      <Btn label="Ghi chú chi tiền mặt" icon="cash-outline" kind="ghost" onPress={() => router.push('/cash')} />

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip label="Tất cả" active={filter === 'all'} onPress={() => setFilter('all')} />
        <Chip label="Nhập tay" active={filter === 'manual'} onPress={() => setFilter('manual')} />
        <Chip label="HSBC" active={filter === 'hsbc'} onPress={() => setFilter('hsbc')} />
      </View>

      {groups.length === 0 ? <Empty icon="receipt-outline" text="Chưa có giao dịch. Bấm + để nhập khoản chi đầu tiên." /> : null}

      {groups.map(([date, list]) => {
        const spent = list.filter((t) => t.direction === 'out' && t.countsDaily).reduce((s, t) => s + t.amount, 0);
        return (
          <Card key={date} style={{ gap: 2 }}>
            <Row style={{ marginBottom: 6 }}>
              <Txt v="heading">{dayLabel(date, today)}</Txt>
              <Txt v="small">chi tiêu {money(spent)}</Txt>
            </Row>
            {list.map((t) => (
              <Pressable key={t.id} onPress={() => setEditing(t)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, minHeight: 50, justifyContent: 'center' })}>
                <Row>
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <Txt numberOfLines={1}>{t.note}</Txt>
                    <Txt v="small">
                      {fmtTime(t.ts)} · {t.source === 'hsbc' ? 'HSBC' : 'Nhập tay'}
                      {t.credit ? ' · thẻ tín dụng' : t.direction === 'out' && !t.countsDaily ? ' · không tính vào chi hằng ngày' : ''}
                    </Txt>
                  </View>
                  <Amount value={t.direction === 'out' ? -t.amount : t.amount} color={t.direction === 'in' ? c.positive : c.text} signed />
                </Row>
              </Pressable>
            ))}
          </Card>
        );
      })}

      {totalCount > shown ? <Btn label={`Xem thêm (${totalCount - shown} giao dịch cũ hơn)`} kind="ghost" onPress={() => setShown(shown + 100)} /> : null}
      <View style={{ height: gap }} />
      <TxSheet visible={editing !== undefined} onClose={() => setEditing(undefined)} tx={editing} />
    </Screen>
  );
}
