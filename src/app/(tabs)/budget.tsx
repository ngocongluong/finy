import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { ACCOUNT_KINDS, AccountSheet, FixedSheet, OneOffSheet } from '../../components/sheets';
import { Amount, Btn, Card, Chip, Meter, Row, Screen, Segmented, Txt, useMoney, useUi } from '../../components/ui';
import { flowTable, monthFlow, netWorth } from '../../lib/finance';
import { fmtPct, monthKey, monthLabel, monthShort } from '../../lib/format';
import { useStore } from '../../lib/store';
import { alpha } from '../../lib/theme';
import type { Account, FixedItem, OneOff } from '../../lib/types';

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
  const fixed = useStore((s) => s.fixed);
  const oneOffs = useStore((s) => s.oneOffs);
  const accounts = useStore((s) => s.accounts);
  const hide = useStore((s) => s.hideAmounts);

  const now = monthKey();
  const [view, setView] = useState<View3>('table');
  const [count, setCount] = useState(6);
  const [month, setMonth] = useState(now); // the row whose details are shown
  // `open` is separate from the payload so a sheet keeps its content while it animates closed.
  const [fixedSheet, setFixedSheetState] = useState<{ open: boolean; direction: 'in' | 'out'; item: FixedItem | null }>({ open: false, direction: 'out', item: null });
  const [oneOffSheet, setOneOffSheetState] = useState<{ open: boolean; direction: 'in' | 'out'; item: OneOff | null }>({ open: false, direction: 'out', item: null });
  const setFixedSheet = (v: { direction: 'in' | 'out'; item: FixedItem | null } | null) =>
    setFixedSheetState((cur) => (v ? { open: true, ...v } : { ...cur, open: false }));
  const setOneOffSheet = (v: { direction: 'in' | 'out'; item: OneOff | null } | null) =>
    setOneOffSheetState((cur) => (v ? { open: true, ...v } : { ...cur, open: false }));
  const [account, setAccount] = useState<Account | null | undefined>(undefined);

  const rows = useMemo(() => flowTable(fixed, oneOffs, now, count), [fixed, oneOffs, now, count]);
  const selected = useMemo(() => monthFlow(fixed, oneOffs, month), [fixed, oneOffs, month]);
  const monthExtras = useMemo(() => oneOffs.filter((o) => o.month === month), [oneOffs, month]);
  const total = useMemo(() => netWorth(accounts), [accounts]);
  const last = rows[rows.length - 1];
  const sumIn = rows.reduce((s, r) => s + r.income, 0);
  const sumOut = rows.reduce((s, r) => s + r.expense, 0);

  const fixedIn = fixed.filter((f) => f.direction === 'in');
  const fixedOut = fixed.filter((f) => f.direction === 'out');
  const base = monthFlow(fixed, [], now);
  const empty = fixed.length === 0;
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

          <Card style={{ gap: 2 }}>
            <Row style={{ marginBottom: 6 }}>
              <Txt v="small" style={{ width: 62 }}>Tháng</Txt>
              <Txt v="small" style={cell}>Thu</Txt>
              <Txt v="small" style={cell}>Chi</Txt>
              <Txt v="small" style={cell}>Để dành</Txt>
            </Row>
            {rows.map((r) => {
              const on = r.month === month;
              const hasExtras = r.extraIn > 0 || r.extraOut > 0;
              return (
                <Pressable
                  key={r.month}
                  onPress={() => setMonth(r.month)}
                  accessibilityLabel={`${monthLabel(r.month)}: thu ${money(r.income)}, chi ${money(r.expense)}, để dành ${money(r.saving)}`}
                  style={({ pressed }) => ({
                    minHeight: 44,
                    justifyContent: 'center',
                    marginHorizontal: -8,
                    paddingHorizontal: 8,
                    borderRadius: 10,
                    backgroundColor: on ? alpha(c.accent, 0.16) : 'transparent',
                    opacity: pressed ? 0.6 : 1,
                  })}>
                  <Row>
                    <View style={{ width: 62, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Txt v="label" color={on ? c.text : c.muted}>{monthShort(r.month)}</Txt>
                      {hasExtras ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.accent }} /> : null}
                    </View>
                    <Txt v="num" style={cell} numberOfLines={1}>{money(r.income, true)}</Txt>
                    <Txt v="num" style={cell} numberOfLines={1}>{money(r.expense, true)}</Txt>
                    <Txt v="num" style={cell} numberOfLines={1} color={r.saving < 0 ? c.negative : c.positive}>{money(r.saving, true)}</Txt>
                  </Row>
                </Pressable>
              );
            })}
            <View style={{ height: 1, backgroundColor: c.border, marginVertical: 8 }} />
            <Row>
              <Txt v="label" style={{ width: 62 }}>Tổng</Txt>
              <Txt v="num" style={cell} numberOfLines={1}>{money(sumIn, true)}</Txt>
              <Txt v="num" style={cell} numberOfLines={1}>{money(sumOut, true)}</Txt>
              <Txt v="num" style={cell} numberOfLines={1} color={last.cumulative < 0 ? c.negative : c.positive}>{money(last.cumulative, true)}</Txt>
            </Row>
            <Txt v="small" style={{ marginTop: 8 }}>
              Chấm tròn = tháng có khoản phát sinh. Chạm một tháng để xem chi tiết và thêm khoản phát sinh.
            </Txt>
          </Card>

          <Card style={{ gap: 10 }}>
            <Txt v="heading">{monthLabel(month)}</Txt>
            <Row><Txt v="label">Thu cố định</Txt><Amount value={selected.fixedIn} /></Row>
            {selected.extraIn > 0 ? <Row><Txt v="label">Thu phát sinh</Txt><Amount value={selected.extraIn} /></Row> : null}
            <Row><Txt v="label">Chi cố định</Txt><Amount value={selected.fixedOut} /></Row>
            {selected.extraOut > 0 ? <Row><Txt v="label">Chi phát sinh</Txt><Amount value={selected.extraOut} /></Row> : null}
            <View style={{ height: 1, backgroundColor: c.border }} />
            <Row>
              <Txt v="heading">{selected.saving < 0 ? 'Thiếu hụt' : 'Để dành được'}</Txt>
              <Amount v="title" value={Math.abs(selected.saving)} color={selected.saving < 0 ? c.negative : c.positive} />
            </Row>
            <View style={{ gap: 6 }}>
              <Row>
                <Txt v="label">Chi/Thu</Txt>
                <Txt v="num">{hide ? '•••' : fmtPct(selected.spendRatio)}</Txt>
              </Row>
              <Meter ratio={selected.spendRatio} color={selected.spendRatio > 1 ? c.negative : c.accent} />
            </View>
          </Card>

          <Card style={{ gap: 2 }}>
            <Txt v="heading" style={{ marginBottom: 6 }}>Phát sinh {monthLabel(month).toLowerCase()}</Txt>
            {monthExtras.length === 0 ? <Txt v="label">Chưa có khoản phát sinh nào trong tháng này.</Txt> : null}
            {monthExtras.map((o) => (
              <Line
                key={o.id}
                name={o.name}
                sub={o.direction === 'in' ? 'Thu phát sinh' : 'Chi phát sinh'}
                amount={o.direction === 'in' ? o.amount : -o.amount}
                color={o.direction === 'in' ? c.positive : c.text}
                onPress={() => setOneOffSheet({ item: o, direction: o.direction })}
              />
            ))}
            <Row style={{ gap: 10, marginTop: 8 }}>
              <Btn label="Chi phát sinh" icon="add" kind="ghost" style={{ flex: 1 }} onPress={() => setOneOffSheet({ item: null, direction: 'out' })} />
              <Btn label="Thu phát sinh" icon="add" kind="ghost" style={{ flex: 1 }} onPress={() => setOneOffSheet({ item: null, direction: 'in' })} />
            </Row>
          </Card>
        </>
      ) : null}

      {view === 'fixed' ? (
        <>
          <Card style={{ gap: 2 }}>
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

          <Card style={{ gap: 2 }}>
            <Row style={{ marginBottom: 6 }}>
              <Txt v="heading">Chi cố định hàng tháng</Txt>
              <Amount value={base.fixedOut} color={c.muted} />
            </Row>
            {fixedOut.length === 0 ? <Txt v="label">Chưa có khoản chi nào. Thêm tiền nhà, học phí, trả nợ, quỹ chi tiêu hằng ngày…</Txt> : null}
            {fixedOut.map((f) => (
              <Line
                key={f.id}
                name={f.name}
                sub={f.kind === 'debt' ? 'Trả nợ vay' : f.daily ? 'Quỹ chi tiêu hằng ngày' : undefined}
                amount={f.amount}
                onPress={() => setFixedSheet({ direction: 'out', item: f })}
              />
            ))}
            <Btn label="Thêm khoản chi" icon="add" kind="ghost" style={{ marginTop: 8 }} onPress={() => setFixedSheet({ direction: 'out', item: null })} />
          </Card>

          <Card style={{ gap: 6 }}>
            <Txt v="label">{base.saving < 0 ? 'Mỗi tháng thiếu (chưa tính phát sinh)' : 'Mỗi tháng để dành được (chưa tính phát sinh)'}</Txt>
            <Amount v="hero" value={Math.abs(base.saving)} color={base.saving < 0 ? c.negative : c.positive} />
            <Txt v="small">= thu cố định − chi cố định. Khoản chỉ có ở vài tháng thì nhập ở “Bảng thu chi” dưới dạng phát sinh.</Txt>
          </Card>
        </>
      ) : null}

      {view === 'accounts' ? (
        <Card style={{ gap: 4 }}>
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
      <OneOffSheet
        visible={oneOffSheet.open}
        onClose={() => setOneOffSheet(null)}
        item={oneOffSheet.item}
        defaultMonth={month}
        defaultDirection={oneOffSheet.direction}
      />
      <AccountSheet visible={account !== undefined} onClose={() => setAccount(undefined)} account={account} />
    </Screen>
  );
}
