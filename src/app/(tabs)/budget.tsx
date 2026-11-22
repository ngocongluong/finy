import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { ACCOUNT_KINDS, AccountSheet, ItemSheet, NumberSheet } from '../../components/sheets';
import { Amount, Btn, Card, IconBtn, Meter, Row, Screen, Txt, useUi } from '../../components/ui';
import { monthSummary, netWorth } from '../../lib/finance';
import { fmtPct, monthKey, monthLabel, shiftMonth } from '../../lib/format';
import { useStore } from '../../lib/store';
import type { Account, BudgetItem, BudgetKind } from '../../lib/types';

const GROUPS: { kind: BudgetKind; label: string }[] = [
  { kind: 'expense', label: 'Chi tiêu' },
  { kind: 'debt', label: 'Trả nợ' },
  { kind: 'saving', label: 'Để dành' },
];

export default function Budget() {
  const { c, gap } = useUi();
  const budgets = useStore((s) => s.budgets);
  const accounts = useStore((s) => s.accounts);
  const hide = useStore((s) => s.hideAmounts);
  const ensureMonth = useStore((s) => s.ensureMonth);
  const setIncome = useStore((s) => s.setIncome);
  const loaded = useStore((s) => s.loaded);

  const [month, setMonth] = useState(monthKey());
  const [item, setItem] = useState<BudgetItem | null | undefined>(undefined); // undefined = closed, null = new
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [incomeOpen, setIncomeOpen] = useState(false);

  useEffect(() => {
    if (loaded) ensureMonth(month);
  }, [loaded, month, ensureMonth]);

  const budget = budgets[month];
  const sum = useMemo(() => monthSummary(budget), [budget]);
  const total = useMemo(() => netWorth(accounts), [accounts]);
  const isCurrent = month === monthKey();

  return (
    <Screen title="Ngân sách">
      <Card style={{ gap }}>
        <Row>
          <IconBtn name="chevron-back" onPress={() => setMonth(shiftMonth(month, -1))} label="Tháng trước" />
          <View style={{ alignItems: 'center' }}>
            <Txt v="heading">{monthLabel(month)}</Txt>
            {!isCurrent ? (
              <Pressable onPress={() => setMonth(monthKey())} hitSlop={8}>
                <Txt v="small" color={c.accent}>Về tháng này</Txt>
              </Pressable>
            ) : null}
          </View>
          <IconBtn name="chevron-forward" onPress={() => setMonth(shiftMonth(month, 1))} label="Tháng sau" />
        </Row>

        <Pressable onPress={() => setIncomeOpen(true)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <Row>
            <Txt v="label">Thu nhập (chạm để sửa)</Txt>
            <Amount value={sum.income} />
          </Row>
        </Pressable>
        <Row><Txt v="label">Tổng chi (gồm để dành)</Txt><Amount value={sum.totalOut} /></Row>
        <Row>
          <Txt v="label">Tồn</Txt>
          <Amount value={sum.remaining} color={sum.remaining < 0 ? c.negative : c.positive} signed />
        </Row>
        <View style={{ gap: 6 }}>
          <Row>
            <Txt v="label">Chi/Thu (không tính để dành)</Txt>
            <Txt v="num">{hide ? '•••' : fmtPct(sum.spendRatio)}</Txt>
          </Row>
          <Meter ratio={sum.spendRatio} color={sum.spendRatio > 1 ? c.negative : c.accent} />
          {sum.income === 0 ? <Txt v="small">Nhập thu nhập của tháng để Finy tính Tồn và tỷ lệ Chi/Thu.</Txt> : null}
        </View>
      </Card>

      {GROUPS.map((g) => {
        const items = (budget?.items ?? []).filter((i) => i.kind === g.kind);
        if (!items.length) return null;
        const groupTotal = items.reduce((s, i) => s + i.amount, 0);
        return (
          <Card key={g.kind} style={{ gap: 4 }}>
            <Row style={{ marginBottom: 6 }}>
              <Txt v="heading">{g.label}</Txt>
              <Amount value={groupTotal} color={c.muted} />
            </Row>
            {items.map((i) => (
              <Pressable key={i.id} onPress={() => setItem(i)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, minHeight: 46, justifyContent: 'center' })}>
                <Row>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, marginRight: 12 }}>
                    <Txt numberOfLines={1} style={{ flexShrink: 1 }}>{i.name}</Txt>
                    {i.daily ? <Ionicons name="today-outline" size={15} color={c.accent} accessibilityLabel="Quỹ chi tiêu hằng ngày" /> : null}
                  </View>
                  <Amount value={i.amount} />
                </Row>
              </Pressable>
            ))}
          </Card>
        );
      })}
      <Btn label="Thêm mục chi / để dành" icon="add" kind="ghost" onPress={() => setItem(null)} />

      <Card style={{ gap: 4 }}>
        <Txt v="label">Tổng tiền hiện có</Txt>
        <Amount v="hero" value={total} color={total < 0 ? c.negative : c.text} />
        <View style={{ height: 8 }} />
        {accounts.map((a) => {
          const kind = ACCOUNT_KINDS.find((k) => k.value === a.kind) ?? ACCOUNT_KINDS[1];
          return (
            <Pressable key={a.id} onPress={() => setAccount(a)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, minHeight: 50, justifyContent: 'center' })}>
              <Row>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, marginRight: 12 }}>
                  <Ionicons name={kind.icon} size={20} color={c.muted} />
                  <View style={{ flexShrink: 1 }}>
                    <Txt numberOfLines={1}>{a.name}</Txt>
                    <Txt v="small">{kind.label}</Txt>
                  </View>
                </View>
                <Amount value={a.kind === 'debt' ? -a.balance : a.balance} color={a.kind === 'debt' ? c.negative : c.text} />
              </Row>
            </Pressable>
          );
        })}
        <Btn label="Thêm tài khoản" icon="add" kind="ghost" onPress={() => setAccount(null)} style={{ marginTop: 8 }} />
      </Card>

      <ItemSheet visible={item !== undefined} onClose={() => setItem(undefined)} month={month} item={item} />
      <AccountSheet visible={account !== undefined} onClose={() => setAccount(undefined)} account={account} />
      <NumberSheet
        visible={incomeOpen}
        onClose={() => setIncomeOpen(false)}
        title={`Thu nhập ${monthLabel(month).toLowerCase()}`}
        label="Tổng thu nhập"
        value={sum.income}
        onSave={(n) => setIncome(month, n ?? 0)}
      />
    </Screen>
  );
}
