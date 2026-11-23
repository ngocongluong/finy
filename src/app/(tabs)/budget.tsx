import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { ACCOUNT_KINDS, AccountSheet, FixedSheet, InstalmentSheet } from '../../components/sheets';
import { Amount, Btn, Card, Chip, Row, Screen, Segmented, Txt, useMoney, useUi } from '../../components/ui';
import { cycleMonthOf, flowTable, instalmentAmount, instalmentPart, monthFlow, netWorth } from '../../lib/finance';
import { dateKey, monthKey, monthLabel, monthShort, shiftMonth } from '../../lib/format';
import { useBudget } from '../../lib/hooks';
import { useStore } from '../../lib/store';
import type { Account, FixedItem, Instalment } from '../../lib/types';

type View3 = 'table' | 'fixed' | 'accounts';

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
  const [count, setCount] = useState(6);
  // `open` is separate from the payload so a sheet keeps its content while it animates closed.
  const [fixedSheet, setFixedSheetState] = useState<{ open: boolean; direction: 'in' | 'out'; item: FixedItem | null }>({ open: false, direction: 'out', item: null });
  const setFixedSheet = (v: { direction: 'in' | 'out'; item: FixedItem | null } | null) =>
    setFixedSheetState((cur) => (v ? { open: true, ...v } : { ...cur, open: false }));
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [inst, setInst] = useState<{ open: boolean; item: Instalment | null }>({ open: false, item: null });
  const instalments = useStore((s) => s.instalments);
  const statementDay = useStore((s) => s.settings.statementDay);
  // The statement cycle open today: instalment progress is shown against it.
  const cycleMonth = cycleMonthOf(dateKey(), statementDay);

  const rows = useMemo(() => flowTable(budget, now, count, credit), [budget, credit, now, count]);
  const total = useMemo(() => netWorth(accounts), [accounts]);
  const last = rows[rows.length - 1];
  const sumIn = rows.reduce((s, r) => s + r.income, 0);
  const sumOut = rows.reduce((s, r) => s + r.expense, 0);

  const fixedIn = budget.fixed.filter((f) => f.direction === 'in');
  const fixedOut = budget.fixed.filter((f) => f.direction === 'out');
  const base = monthFlow({ ...budget, oneOffs: [], overrides: {} }, now);
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

          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[6, 12, 24].map((n) => (
              <Chip key={n} label={`${n} tháng`} active={count === n} onPress={() => setCount(n)} />
            ))}
          </View>

          <Card eye={'budget.table'} style={{ gap: 2 }}>
            <Row style={{ marginBottom: 6 }}>
              <Txt v="small" style={{ width: 66 }}>Tháng</Txt>
              <Txt v="small" style={cell}>Thu</Txt>
              <Txt v="small" style={cell}>Chi</Txt>
              <Txt v="small" style={cell}>Để dành</Txt>
              <View style={{ width: 18 }} />
            </Row>
            {rows.map((r) => {
              const special = r.extraIn > 0 || r.extraOut > 0 || r.adjusted;
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
                    <View style={{ width: 66, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Txt v="label" color={r.month === now ? c.text : c.muted}>{monthShort(r.month)}</Txt>
                      {special ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.accent }} /> : null}
                      {r.creditOver > 0 ? <Ionicons name="warning" size={13} color={c.negative} accessibilityLabel="Vượt dự chi tín dụng" /> : null}
                    </View>
                    <Txt v="num" style={cell} numberOfLines={1}>{money(r.income, true)}</Txt>
                    <Txt v="num" style={cell} numberOfLines={1}>{money(r.expense, true)}</Txt>
                    <Txt v="num" style={cell} numberOfLines={1} color={r.saving < 0 ? c.negative : c.positive}>{money(r.saving, true)}</Txt>
                    <Ionicons name="chevron-forward" size={16} color={c.muted} style={{ width: 18, textAlign: 'right' }} />
                  </Row>
                </Pressable>
              );
            })}
            <View style={{ height: 1, backgroundColor: c.border, marginVertical: 8 }} />
            <Row>
              <Txt v="label" style={{ width: 66 }}>Tổng</Txt>
              <Txt v="num" style={cell} numberOfLines={1}>{money(sumIn, true)}</Txt>
              <Txt v="num" style={cell} numberOfLines={1}>{money(sumOut, true)}</Txt>
              <Txt v="num" style={cell} numberOfLines={1} color={last.cumulative < 0 ? c.negative : c.positive}>{money(last.cumulative, true)}</Txt>
              <View style={{ width: 18 }} />
            </Row>
            <Txt v="small" style={{ marginTop: 8 }}>
              Chạm một tháng để xem và sửa chi tiết thu, chi của tháng đó. Chấm tròn = tháng có khoản phát sinh hoặc số tiền chỉnh riêng.
            </Txt>
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
            {fixedIn.map((f) => (
              <Line key={f.id} name={f.name} amount={f.amount} onPress={() => setFixedSheet({ direction: 'in', item: f })} />
            ))}
            <Btn label="Thêm nguồn thu" icon="add" kind="ghost" style={{ marginTop: 8 }} onPress={() => setFixedSheet({ direction: 'in', item: null })} />
          </Card>

          <Card eye={'budget.fixedOut'} style={{ gap: 2 }}>
            <Row style={{ marginBottom: 6 }}>
              <Txt v="heading">Chi cố định hàng tháng</Txt>
              <Amount value={base.fixedOut} color={c.muted} />
            </Row>
            {fixedOut.length === 0 ? <Txt v="label">Chưa có khoản chi nào. Thêm tiền nhà, học phí, trả nợ, quỹ chi tiêu hằng ngày…</Txt> : null}
            {fixedOut.map((f) => (
              <Line
                key={f.id}
                name={f.name}
                sub={f.kind === 'debt' ? 'Trả nợ vay' : f.kind === 'credit' ? 'Dự chi tín dụng mỗi kỳ sao kê' : f.onCard ? 'Trả qua thẻ tín dụng mỗi kỳ' : f.daily ? 'Quỹ chi tiêu hằng ngày' : undefined}
                amount={f.amount}
                onPress={() => setFixedSheet({ direction: 'out', item: f })}
              />
            ))}
            <Btn label="Thêm khoản chi" icon="add" kind="ghost" style={{ marginTop: 8 }} onPress={() => setFixedSheet({ direction: 'out', item: null })} />
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
      <InstalmentSheet visible={inst.open} onClose={() => setInst((v) => ({ ...v, open: false }))} item={inst.item} defaultStart={cycleMonth} />
    </Screen>
  );
}
