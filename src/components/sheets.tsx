// Add / edit forms, shared by several screens.
import React, { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Alert, Pressable, Switch, Text, View } from 'react-native';
import { creditCycle, familyLoanDueMonth, familyLoanInterest, fixedBase, fixedPeriodAt, fixedPeriodsAmountAt, instalmentAmount, loanBalance, loanFinalMonth, loanPaidBefore, loanPeriods, loanTotalInterest, normalizeFamilyLoan, normalizeLoan } from '../lib/finance';
import { dateKey, dayLabel, fmtVND, monthKey, monthLabel, monthShort, shiftMonth } from '../lib/format';
import { useStore } from '../lib/store';
import type { Account, AccountKind, FamilyLoan, FixedItem, FixedPeriod, Instalment, Loan, OneOff, Tx } from '../lib/types';
import { AmountField, Btn, Chip, Field, IconBtn, Row, Segmented, Sheet, Txt, useMoney, useUi } from './ui';

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  const { c } = useUi();
  return (
    <Row style={{ gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Txt>{label}</Txt>
        {hint ? <Txt v="small">{hint}</Txt> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: c.accent, false: c.border }} thumbColor={c.text} />
    </Row>
  );
}

export { Toggle };

function confirmDelete(what: string, onYes: () => void) {
  Alert.alert('Xoá?', `Xoá ${what}? Thao tác này không hoàn tác được.`, [
    { text: 'Không', style: 'cancel' },
    { text: 'Xoá', style: 'destructive', onPress: onYes },
  ]);
}

function shiftDate(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d + delta));
}

/** Record or edit one transaction. `tx` = edit mode. */
export function TxSheet({ visible, onClose, tx }: { visible: boolean; onClose: () => void; tx?: Tx | null }) {
  const addTx = useStore((s) => s.addTx);
  const updateTx = useStore((s) => s.updateTx);
  const deleteTx = useStore((s) => s.deleteTx);
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [date, setDate] = useState(dateKey());
  const [counts, setCounts] = useState(true);
  const [credit, setCredit] = useState(false);
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setAmount(tx?.amount ?? 0);
    setNote(tx?.note ?? '');
    setDirection(tx?.direction ?? 'out');
    setDate(tx?.date ?? dateKey());
    setCounts(tx?.countsDaily ?? true);
    setCredit(!!tx?.credit);
    setKey((k) => k + 1); // remount the amount field with the new initial value
  }, [visible, tx]);

  const today = dateKey();
  const save = async () => {
    if (!(amount > 0)) return;
    // A card purchase is tracked against the credit-card plan instead of the daily cash bucket.
    const countsDaily = direction === 'out' && counts && !credit;
    if (tx) {
      const [y, m, d] = date.split('-').map(Number);
      const old = new Date(tx.ts);
      const ts = date === tx.date ? tx.ts : new Date(y, m - 1, d, old.getHours(), old.getMinutes()).getTime();
      await updateTx({ ...tx, amount, note: note.trim(), direction, date, ts, countsDaily, credit: credit || undefined });
    } else {
      await addTx({ amount, note: note.trim() || (direction === 'out' ? 'Chi tiêu' : 'Thu'), direction, date, source: 'manual', countsDaily, credit: credit || undefined });
    }
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={tx ? 'Sửa giao dịch' : 'Nhập chi tiêu'}
      footer={<Btn label="Lưu" icon="checkmark" onPress={save} disabled={!(amount > 0)} />}>
      <Segmented value={direction} onChange={setDirection} options={[{ value: 'out', label: 'Chi' }, { value: 'in', label: 'Thu' }]} />
      <AmountField key={key} label="Số tiền" value={amount} onChange={setAmount} autoFocus={!tx} />
      <Field label="Ghi chú" value={note} onChangeText={setNote} placeholder="Ăn trưa, xăng xe…" />
      <Row>
        <IconBtn name="chevron-back" onPress={() => setDate(shiftDate(date, -1))} label="Ngày trước" />
        <Txt v="heading">{dayLabel(date, today)}</Txt>
        <IconBtn name="chevron-forward" onPress={() => date < today && setDate(shiftDate(date, 1))} label="Ngày sau" />
      </Row>
      {direction === 'out' ? (
        <Toggle label="Quẹt thẻ tín dụng" hint="Tính vào kỳ sao kê tín dụng thay vì quỹ chi tiêu hằng ngày." value={credit} onChange={setCredit} />
      ) : null}
      {direction === 'out' && !credit ? (
        <Toggle label="Tính vào chi tiêu hằng ngày" hint="Tắt với khoản trả nợ, chuyển tiền để dành…" value={counts} onChange={setCounts} />
      ) : null}
      {tx ? (
        <Btn
          label="Xoá giao dịch"
          kind="danger"
          icon="trash-outline"
          onPress={() =>
            confirmDelete('giao dịch này', async () => {
              await deleteTx(tx.id);
              onClose();
            })
          }
        />
      ) : null}
    </Sheet>
  );
}

/** A period of a fixed item in words: "T11/2026 – T3/2027", "từ T4/2027", "đến T3/2027". */
export function periodLabel(p: Pick<FixedPeriod, 'from' | 'to'>): string {
  if (p.from && p.to) return p.from === p.to ? monthYear(p.from) : `${monthYear(p.from)} – ${monthYear(p.to)}`;
  if (p.from) return `từ ${monthYear(p.from)}`;
  if (p.to) return `đến ${monthYear(p.to)}`;
  return 'mọi tháng';
}

interface DraftRange {
  key: number;
  from: string | null;
  to: string | null;
  amount: number;
}

/**
 * Add or edit an income or expense that repeats every month: one amount for
 * all the time, or periods (from month to month) each with its own amount;
 * the cash-flow table then uses each month's period amount.
 */
export function FixedSheet({
  visible,
  onClose,
  direction,
  item,
  initialKind = 'expense',
}: {
  visible: boolean;
  onClose: () => void;
  direction: 'in' | 'out';
  item?: FixedItem | null;
  /** Kind preselected when adding a new expense. */
  initialKind?: 'expense' | 'debt' | 'credit';
}) {
  const { c } = useUi();
  const upsertFixed = useStore((s) => s.upsertFixed);
  const deleteFixed = useStore((s) => s.deleteFixed);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState(0);
  const [kind, setKind] = useState<'expense' | 'debt' | 'credit'>('expense');
  const [daily, setDaily] = useState(false);
  const [onCard, setOnCard] = useState(false);
  const [mode, setMode] = useState<'all' | 'periods'>('all');
  const [ranges, setRanges] = useState<DraftRange[]>([]);
  const [key, setKey] = useState(0);
  const nextKey = React.useRef(0);

  useEffect(() => {
    if (!visible) return;
    setName(item?.name ?? (initialKind === 'credit' ? 'Thẻ tín dụng' : ''));
    setAmount(item?.amount ?? 0);
    setKind(item?.kind ?? initialKind);
    setDaily(!!item?.daily);
    setOnCard(!!item?.onCard);
    // An item limited to a range of months (set by Finy) shows as one period.
    const given: FixedPeriod[] | null = item?.periods?.length
      ? item.periods
      : item && (item.fromMonth || item.toMonth)
        ? [{ from: item.fromMonth ?? null, to: item.toMonth ?? null, amount: item.amount }]
        : null;
    setMode(given ? 'periods' : 'all');
    setRanges((given ?? [{ from: null, to: null, amount: item?.amount ?? 0 }]).map((p) => ({ key: nextKey.current++, ...p })));
    setKey((k) => k + 1);
  }, [visible, item, initialKind]);

  const out = direction === 'out';
  const what = out ? 'chi cố định' : 'thu cố định';
  // Card plan items keep their months where the plan is edited.
  const credit = out && kind === 'credit';
  const byPeriod = mode === 'periods' && !credit;
  const valid = name.trim().length > 0 && (byPeriod ? ranges.length > 0 && ranges.every((r) => r.amount > 0) : amount > 0);

  const changeMode = (m: 'all' | 'periods') => {
    // The amount carries over to the other way of entering it.
    if (m === 'periods' && ranges.length === 1 && ranges[0].from === null && ranges[0].to === null) setRanges([{ ...ranges[0], amount }]);
    if (m === 'all' && !(amount > 0)) setAmount(fixedPeriodsAmountAt(ranges, monthKey()));
    setMode(m);
    setKey((k) => k + 1);
  };
  const updateRange = (k: number, patch: Partial<DraftRange>) => setRanges((cur) => cur.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  // Periods that followed each other keep doing so when one of them moves; one that would
  // overlap the moved period gives way.
  const setFrom = (i: number, m: string | null) =>
    setRanges((cur) => {
      const next = cur.map((r) => ({ ...r }));
      const row = next[i];
      const prev = next[i - 1];
      const joined = !!prev && prev.to !== null && row.from !== null && shiftMonth(prev.to, 1) === row.from;
      row.from = m;
      if (prev && m !== null && (joined || prev.to === null || prev.to >= m)) prev.to = shiftMonth(m, -1);
      return next;
    });
  const setTo = (i: number, m: string | null) =>
    setRanges((cur) => {
      const next = cur.map((r) => ({ ...r }));
      const row = next[i];
      const after = next[i + 1];
      const joined = !!after && row.to !== null && after.from !== null && shiftMonth(row.to, 1) === after.from;
      row.to = m;
      if (after && m !== null && (joined || after.from === null || after.from <= m)) {
        after.from = shiftMonth(m, 1);
        if (after.to !== null && after.to < after.from) after.to = after.from;
      }
      return next;
    });
  const addRange = () =>
    setRanges((cur) => {
      const last = cur[cur.length - 1];
      const now = monthKey();
      // A last period with no end gets one, a year on, to make room for the new one after it.
      const lastTo = last.to ?? shiftMonth(last.from !== null && last.from > now ? last.from : now, 11);
      return [...cur.slice(0, -1), { ...last, to: lastTo }, { key: nextKey.current++, from: shiftMonth(lastTo, 1), to: null, amount: last.amount }];
    });
  const removeRange = (i: number) =>
    setRanges((cur) => {
      const next = cur.filter((_, j) => j !== i).map((r) => ({ ...r }));
      const gone = cur[i];
      // Without the last period, the one that led straight into it runs on.
      const prev = next[i - 1];
      if (i === cur.length - 1 && prev && gone.to === null && prev.to !== null && gone.from !== null && shiftMonth(prev.to, 1) === gone.from) prev.to = null;
      return next;
    });

  const save = () => {
    const periods = byPeriod ? ranges.map(({ from, to, amount: a }) => ({ from, to, amount: a })) : undefined;
    upsertFixed({
      id: item?.id,
      name,
      amount: periods ? fixedPeriodsAmountAt(periods, monthKey()) : amount,
      direction,
      kind: out ? kind : undefined,
      daily: out && kind === 'expense' && daily && !onCard,
      onCard: out && kind === 'expense' && onCard,
      periods,
      fromMonth: credit ? item?.fromMonth : undefined,
      toMonth: credit ? item?.toMonth : undefined,
    });
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={item ? `Sửa khoản ${what}` : `Thêm khoản ${what}`}
      footer={<Btn label="Lưu" icon="checkmark" disabled={!valid} onPress={save} />}>
      <Field label="Tên" value={name} onChangeText={setName} placeholder={out ? 'Tiền nhà, điện nước, học phí…' : 'Lương, cho thuê nhà…'} autoFocus={!item} />
      {credit ? null : (
        <View style={{ gap: 8 }}>
          <Txt v="label">Số tiền áp dụng</Txt>
          <Segmented
            value={mode}
            onChange={changeMode}
            options={[
              { value: 'all', label: 'Toàn thời gian' },
              { value: 'periods', label: 'Theo giai đoạn' },
            ]}
          />
        </View>
      )}
      {byPeriod ? (
        <>
          {ranges.map((r, i) => {
            const prev = ranges[i - 1];
            const after = ranges[i + 1];
            return (
              <View key={r.key} style={{ gap: 10, backgroundColor: c.cardAlt, borderRadius: 12, padding: 12 }}>
                <Row>
                  <Txt v="heading">Giai đoạn {i + 1}</Txt>
                  {ranges.length > 1 ? (
                    <IconBtn name="trash-outline" size={18} color={c.negative} label={`Xoá giai đoạn ${i + 1}`} onPress={() => removeRange(i)} />
                  ) : null}
                </Row>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                  <MonthField
                    label="Từ tháng"
                    value={r.from}
                    // After the previous period starts (it keeps at least a month), not after this one ends.
                    min={prev?.from ? shiftMonth(prev.from, 1) : undefined}
                    max={r.to ?? undefined}
                    onChange={(m) => setFrom(i, m)}
                    none={i === 0 ? { label: 'Từ trước', onPick: () => setFrom(i, null) } : undefined}
                  />
                  <MonthField
                    label="Đến tháng"
                    value={r.to}
                    // Not before this period starts; the next one keeps at least a month.
                    min={r.from ?? undefined}
                    max={after?.to ? shiftMonth(after.to, -1) : undefined}
                    onChange={(m) => setTo(i, m)}
                    none={i === ranges.length - 1 ? { label: 'Không thời hạn', onPick: () => setTo(i, null) } : undefined}
                  />
                </View>
                <AmountField key={`r${key}-${r.key}`} label="Số tiền mỗi tháng" value={r.amount} onChange={(n) => updateRange(r.key, { amount: n })} />
              </View>
            );
          })}
          <Btn label="Thêm giai đoạn" icon="add" kind="ghost" onPress={addRange} />
          <Txt v="small">
            Mỗi giai đoạn có số tiền riêng, được tính vào đúng các tháng đó trong bảng thu chi. Ngoài các giai đoạn, khoản này không được tính.
          </Txt>
        </>
      ) : (
        <AmountField key={`a${key}`} label="Số tiền mỗi tháng" value={amount} onChange={setAmount} />
      )}
      {out ? (
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'expense', label: 'Chi tiêu' },
            { value: 'debt', label: 'Trả nợ vay' },
          ]}
        />
      ) : null}
      {out && kind === 'expense' ? (
        <Toggle
          label="Trả qua thẻ tín dụng"
          hint="Ví dụ trả góp qua thẻ: số này được cộng vào mỗi kỳ sao kê tín dụng (HSBC không gửi email cho khoản này)."
          value={onCard}
          onChange={setOnCard}
        />
      ) : null}
      {out && kind === 'expense' && !onCard ? (
        <Toggle label="Đây là quỹ chi tiêu hằng ngày" hint="Finy chia quỹ này theo ngày để theo dõi tiền tiêu vặt." value={daily} onChange={setDaily} />
      ) : null}
      {credit ? <Txt v="small">Một khoản dự chi tín dụng mỗi kỳ sao kê; tên là ghi chú của khoản. Nhiều khoản được cộng thành tổng dự chi.</Txt> : null}
      {item ? (
        <Btn
          label="Xoá khoản này"
          kind="danger"
          icon="trash-outline"
          onPress={() =>
            confirmDelete(`khoản "${item.name}"`, () => {
              deleteFixed(item.id);
              onClose();
            })
          }
        />
      ) : null}
    </Sheet>
  );
}

/**
 * Edit what a fixed item amounts to in one month. The amount can be saved for
 * that month only, or as the new usual amount (of every month, or of the
 * period the month is in when the item changes over time).
 */
export function MonthLineSheet({
  visible,
  onClose,
  month,
  item,
}: {
  visible: boolean;
  onClose: () => void;
  month: string;
  item: FixedItem | null;
}) {
  const upsertFixed = useStore((s) => s.upsertFixed);
  const setOverride = useStore((s) => s.setOverride);
  const current = useStore((s) => (item ? s.overrides[month]?.[item.id] : undefined));
  const money = useMoney();
  const [amount, setAmount] = useState(0);
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (!visible || !item) return;
    setAmount(current ?? fixedBase(item, month));
    setKey((k) => k + 1);
    // Only when the sheet opens: later store changes must not reset what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, item?.id, month]);

  if (!item) return null;
  const label = monthShort(month);
  const overridden = current !== undefined;
  const usual = fixedBase(item, month);
  const period = fixedPeriodAt(item, month);
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={item.name}
      footer={
        <Btn
          label={`Lưu riêng cho ${label}`}
          icon="checkmark"
          onPress={() => {
            setOverride(month, item.id, amount);
            onClose();
          }}
        />
      }>
      <AmountField key={key} label={`Số tiền trong ${label}`} value={amount} onChange={setAmount} autoFocus />
      <Txt v="small">
        {period ? `Mức của giai đoạn ${periodLabel(period)}` : 'Mức cố định hàng tháng'}: {money(usual)}.
        {overridden ? ` ${label} đang dùng mức riêng ${money(current)}.` : ''} Nhập 0 nếu tháng này không có khoản này.
      </Txt>
      <Btn
        label={period ? 'Áp dụng cho cả giai đoạn này' : 'Áp dụng cho mọi tháng'}
        kind="ghost"
        icon="repeat-outline"
        disabled={!(amount > 0)}
        onPress={() => {
          if (period) upsertFixed({ ...item, periods: (item.periods ?? []).map((p) => (p === period ? { ...p, amount } : p)) });
          else upsertFixed({ ...item, amount });
          setOverride(month, item.id, null);
          onClose();
        }}
      />
      {overridden ? (
        <Btn
          label={`Bỏ mức riêng, về ${money(usual)}`}
          kind="ghost"
          icon="arrow-undo-outline"
          onPress={() => {
            setOverride(month, item.id, null);
            onClose();
          }}
        />
      ) : null}
    </Sheet>
  );
}

/**
 * Add or edit an expected one-off income or expense.
 * Adding: pick one or several months and the same entry is created in each.
 * Editing: one entry, which can be moved to another month.
 */
export function OneOffSheet({
  visible,
  onClose,
  item,
  defaultMonth,
  defaultDirection = 'out',
}: {
  visible: boolean;
  onClose: () => void;
  item?: OneOff | null;
  defaultMonth: string;
  defaultDirection?: 'in' | 'out';
}) {
  const addOneOffs = useStore((s) => s.addOneOffs);
  const updateOneOff = useStore((s) => s.updateOneOff);
  const deleteOneOff = useStore((s) => s.deleteOneOff);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState(0);
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [months, setMonths] = useState<string[]>([]);
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setName(item?.name ?? '');
    setAmount(item?.amount ?? 0);
    setDirection(item?.direction ?? defaultDirection);
    setMonths([item?.month ?? defaultMonth]);
    setKey((k) => k + 1);
  }, [visible, item, defaultMonth, defaultDirection]);

  // The next 24 months, plus the entry's own month when it lies outside that range.
  const now = monthKey();
  const choices = Array.from({ length: 24 }, (_, i) => shiftMonth(now, i));
  for (const m of [item?.month, defaultMonth]) if (m && !choices.includes(m)) choices.unshift(m);
  choices.sort();

  const toggle = (m: string) => {
    if (item) setMonths([m]);
    else setMonths((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m].sort()));
  };

  const valid = name.trim() && amount > 0 && months.length > 0;
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={item ? 'Sửa khoản phát sinh' : 'Thêm khoản phát sinh'}
      footer={
        <Btn
          label={item || months.length <= 1 ? 'Lưu' : `Lưu cho ${months.length} tháng`}
          icon="checkmark"
          disabled={!valid}
          onPress={() => {
            if (item) updateOneOff({ ...item, name, amount, direction, month: months[0] });
            else addOneOffs(months, { name, amount, direction });
            onClose();
          }}
        />
      }>
      <Segmented
        value={direction}
        onChange={setDirection}
        options={[
          { value: 'out', label: 'Chi phát sinh' },
          { value: 'in', label: 'Thu phát sinh' },
        ]}
      />
      <Field label="Tên" value={name} onChangeText={setName} placeholder={direction === 'out' ? 'Học phí kỳ 2, sửa xe, du lịch…' : 'Thưởng Tết, tiền lãi…'} autoFocus={!item} />
      <AmountField key={key} label={months.length > 1 ? 'Số tiền mỗi tháng đã chọn' : 'Số tiền'} value={amount} onChange={setAmount} />
      <View style={{ gap: 8 }}>
        <Txt v="label">{item ? 'Tháng' : 'Tháng áp dụng (chọn được nhiều tháng)'}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {choices.map((m) => (
            <Chip key={m} label={monthShort(m)} active={months.includes(m)} onPress={() => toggle(m)} />
          ))}
        </View>
      </View>
      {item ? (
        <Btn
          label="Xoá khoản này"
          kind="danger"
          icon="trash-outline"
          onPress={() =>
            confirmDelete(`khoản "${item.name}"`, () => {
              deleteOneOff(item.id);
              onClose();
            })
          }
        />
      ) : null}
    </Sheet>
  );
}

export const ACCOUNT_KINDS: { value: AccountKind; label: string; icon: 'cash-outline' | 'card-outline' | 'wallet-outline' | 'trending-up-outline' | 'remove-circle-outline' }[] = [
  { value: 'cash', label: 'Tiền mặt', icon: 'cash-outline' },
  { value: 'bank', label: 'Ngân hàng', icon: 'card-outline' },
  { value: 'saving', label: 'Tiết kiệm', icon: 'wallet-outline' },
  { value: 'invest', label: 'Đầu tư', icon: 'trending-up-outline' },
  { value: 'debt', label: 'Khoản nợ', icon: 'remove-circle-outline' },
];

export function AccountSheet({ visible, onClose, account }: { visible: boolean; onClose: () => void; account?: Account | null }) {
  const upsertAccount = useStore((s) => s.upsertAccount);
  const deleteAccount = useStore((s) => s.deleteAccount);
  const [name, setName] = useState('');
  const [balance, setBalance] = useState(0);
  const [kind, setKind] = useState<AccountKind>('bank');
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setName(account?.name ?? '');
    setBalance(account?.balance ?? 0);
    setKind(account?.kind ?? 'bank');
    setKey((k) => k + 1);
  }, [visible, account]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={account ? 'Sửa tài khoản' : 'Thêm tài khoản'}
      footer={
        <Btn
          label="Lưu"
          icon="checkmark"
          disabled={!name.trim()}
          onPress={() => {
            upsertAccount({ id: account?.id, name, kind, balance });
            onClose();
          }}
        />
      }>
      <Field label="Tên" value={name} onChangeText={setName} placeholder="HSBC, sổ tiết kiệm, tiền mặt…" autoFocus={!account} />
      <AmountField key={key} label={kind === 'debt' ? 'Dư nợ hiện tại' : 'Số dư hiện tại'} value={balance} onChange={setBalance} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {ACCOUNT_KINDS.map((k) => (
          <Btn key={k.value} label={k.label} icon={k.icon} kind={kind === k.value ? 'primary' : 'ghost'} onPress={() => setKind(k.value)} style={{ minHeight: 42, paddingHorizontal: 12 }} />
        ))}
      </View>
      {account ? (
        <Btn
          label="Xoá tài khoản"
          kind="danger"
          icon="trash-outline"
          onPress={() =>
            confirmDelete(`tài khoản "${account.name}"`, () => {
              deleteAccount(account.id);
              onClose();
            })
          }
        />
      ) : null}
    </Sheet>
  );
}

/** Edit a single number (income, a plan assumption…). */
export function NumberSheet({
  visible,
  onClose,
  title,
  label,
  value,
  onSave,
  money = true,
  hint,
  allowAuto,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  label: string;
  value: number;
  onSave: (n: number | null) => void;
  money?: boolean;
  hint?: string;
  /** Shows a "follow the budget automatically" button that saves null. */
  allowAuto?: boolean;
}) {
  const [n, setN] = useState(value);
  const [text, setText] = useState(String(value));
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (!visible) return;
    setN(value);
    setText(String(value).replace('.', ','));
    setKey((k) => k + 1);
  }, [visible, value]);

  const parsed = money ? n : parseFloat(text.replace(',', '.'));
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      footer={
        <Btn
          label="Lưu"
          icon="checkmark"
          disabled={!Number.isFinite(parsed)}
          onPress={() => {
            onSave(parsed);
            onClose();
          }}
        />
      }>
      {money ? <AmountField key={key} label={label} value={value} onChange={setN} autoFocus /> : <Field label={label} value={text} onChangeText={setText} autoFocus />}
      {hint ? <Txt v="small">{hint}</Txt> : null}
      {allowAuto ? (
        <Btn
          label="Tự lấy theo ngân sách"
          kind="ghost"
          icon="sync-outline"
          onPress={() => {
            onSave(null);
            onClose();
          }}
        />
      ) : null}
    </Sheet>
  );
}

const MONTH_CHOICES = [3, 6, 9, 12, 18, 24, 36];

/**
 * Add or edit a purchase paid off on the credit card in equal monthly parts.
 * The first part can be in an earlier statement for a plan already under way.
 */
export function InstalmentSheet({
  visible,
  onClose,
  item,
  defaultStart,
}: {
  visible: boolean;
  onClose: () => void;
  item?: Instalment | null;
  /** Statement month preselected for a new plan. */
  defaultStart: string;
}) {
  const { c } = useUi();
  const money = useMoney();
  const upsert = useStore((s) => s.upsertInstalment);
  const remove = useStore((s) => s.deleteInstalment);
  const [name, setName] = useState('');
  const [total, setTotal] = useState(0);
  const [months, setMonths] = useState(12);
  const [monthsText, setMonthsText] = useState('12');
  const [start, setStart] = useState(defaultStart);
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setName(item?.name ?? '');
    setTotal(item?.total ?? 0);
    setMonths(item?.months ?? 12);
    setMonthsText(String(item?.months ?? 12));
    setStart(item?.startMonth ?? defaultStart);
    setKey((k) => k + 1);
  }, [visible, item, defaultStart]);

  // First part: from a year back (plans already running) to two years ahead.
  const now = monthKey();
  const starts = Array.from({ length: 37 }, (_, i) => shiftMonth(now, i - 12));
  if (!starts.includes(start)) starts.unshift(start);

  const plan: Instalment = { id: item?.id ?? '', name, total, months, startMonth: start };
  const valid = name.trim() && total > 0 && months >= 1;
  const first = valid ? instalmentAmount(plan, 1) : 0;
  const last = valid ? instalmentAmount(plan, months) : 0;
  const end = shiftMonth(start, months - 1);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={item ? 'Sửa khoản trả góp' : 'Thêm khoản trả góp'}
      footer={
        <Btn
          label="Lưu"
          icon="checkmark"
          disabled={!valid}
          onPress={() => {
            upsert({ id: item?.id, name, total, months, startMonth: start });
            onClose();
          }}
        />
      }>
      <Field label="Tên" value={name} onChangeText={setName} placeholder="Điện thoại, laptop, máy lạnh…" autoFocus={!item} />
      <AmountField key={key} label="Tổng số tiền trả góp" value={total} onChange={setTotal} />
      <View style={{ gap: 8 }}>
        <Txt v="label">Số tháng</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {MONTH_CHOICES.map((n) => (
            <Chip
              key={n}
              label={`${n} tháng`}
              active={months === n}
              onPress={() => {
                setMonths(n);
                setMonthsText(String(n));
              }}
            />
          ))}
        </View>
        <Field
          label="Hoặc nhập số tháng"
          value={monthsText}
          onChangeText={(t) => {
            const digits = t.replace(/\D/g, '').slice(0, 3);
            setMonthsText(digits);
            const n = parseInt(digits, 10);
            if (n >= 1 && n <= 120) setMonths(n);
          }}
        />
      </View>
      <View style={{ gap: 8 }}>
        <Txt v="label">Kỳ sao kê trả phần đầu tiên</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {starts.map((m) => (
            <Chip key={m} label={monthShort(m)} active={start === m} onPress={() => setStart(m)} />
          ))}
        </View>
      </View>
      {valid ? (
        <View style={{ backgroundColor: c.cardAlt, borderRadius: 12, padding: 12, gap: 4 }}>
          <Txt>
            Mỗi tháng {money(first)}
            {last !== first ? ` (kỳ cuối ${money(last)})` : ''}
          </Txt>
          <Txt v="small">
            {months} kỳ, từ {monthLabel(start).toLowerCase()} đến {monthLabel(end).toLowerCase()}. Được cộng vào chi tín dụng của từng kỳ.
          </Txt>
        </View>
      ) : null}
      {item ? (
        <Btn
          label="Xoá khoản trả góp"
          kind="danger"
          icon="trash-outline"
          onPress={() =>
            confirmDelete(`khoản trả góp "${item.name}"`, () => {
              remove(item.id);
              onClose();
            })
          }
        />
      ) : null}
    </Sheet>
  );
}

const LOAN_YEARS = [5, 10, 15, 20, 25, 30, 35];
const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const monthYear = (m: string) => `T${Number(m.slice(5, 7))}/${m.slice(0, 4)}`;

/**
 * Picks a month by tapping: shows the month, and opens a year switcher with
 * the twelve months underneath. Months outside [min, max] cannot be picked.
 * `none` adds a choice for no month at all (no start / no end limit), shown
 * as its label while chosen (value null). `readOnly` only shows the month.
 */
export function MonthField({
  label,
  value,
  onChange,
  min,
  max,
  none,
  readOnly,
}: {
  label: string;
  value: string | null;
  onChange?: (month: string) => void;
  min?: string;
  max?: string;
  none?: { label: string; onPick: () => void };
  readOnly?: boolean;
}) {
  const { c, r, fs } = useUi();
  const [open, setOpen] = useState(false);
  const yearOf = () => Number((value ?? min ?? max ?? monthKey()).slice(0, 4));
  const [year, setYear] = useState(yearOf);
  const shown = value ? monthYear(value) : (none?.label ?? '—');
  const box = {
    backgroundColor: c.card,
    borderRadius: Math.min(r, 12),
    borderWidth: 1,
    borderColor: open ? c.accent : c.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
  };
  if (readOnly) {
    return (
      <View style={{ flex: 1 }}>
        <View accessible accessibilityLabel={`${label}: ${shown}`} style={box}>
          <Txt v="small">{label}</Txt>
          <Row>
            <Text style={{ color: c.text, fontSize: fs(16), fontWeight: '700' }}>{shown}</Text>
            <Ionicons name="lock-closed-outline" size={14} color={c.muted} />
          </Row>
        </View>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <Pressable
        onPress={() => {
          setYear(yearOf());
          setOpen((o) => !o);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${shown}. Chạm để chọn tháng.`}
        style={({ pressed }) => ({ ...box, opacity: pressed ? 0.7 : 1 })}>
        <Txt v="small">{label}</Txt>
        <Row>
          <Text numberOfLines={1} style={{ flexShrink: 1, color: c.text, fontSize: fs(16), fontWeight: '700' }}>
            {shown}
          </Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={c.muted} />
        </Row>
      </Pressable>
      {open ? (
        <View style={{ backgroundColor: c.card, borderRadius: Math.min(r, 12), borderWidth: 1, borderColor: c.border, padding: 6, gap: 6 }}>
          <Row>
            <IconBtn name="chevron-back" size={18} onPress={() => setYear(year - 1)} label="Năm trước" />
            <Txt v="heading">{year}</Txt>
            <IconBtn name="chevron-forward" size={18} onPress={() => setYear(year + 1)} label="Năm sau" />
          </Row>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 6 }}>
            {Array.from({ length: 12 }, (_, i) => {
              const m = `${year}-${pad2(i + 1)}`;
              const disabled = (min !== undefined && m < min) || (max !== undefined && m > max);
              const active = m === value;
              return (
                <Pressable
                  key={m}
                  disabled={disabled}
                  onPress={() => {
                    onChange?.(m);
                    setOpen(false);
                  }}
                  accessibilityLabel={`Tháng ${i + 1} năm ${year}`}
                  style={{
                    width: '31%',
                    minHeight: 36,
                    borderRadius: 8,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: active ? c.accent : c.cardAlt,
                    opacity: disabled ? 0.3 : 1,
                  }}>
                  <Text style={{ color: active ? c.onAccent : c.text, fontSize: fs(13), fontWeight: '600' }}>T{i + 1}</Text>
                </Pressable>
              );
            })}
          </View>
          {none ? (
            <Pressable
              onPress={() => {
                none.onPick();
                setOpen(false);
              }}
              accessibilityLabel={none.label}
              style={{
                minHeight: 36,
                borderRadius: 8,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: value === null ? c.accent : c.cardAlt,
              }}>
              <Text style={{ color: value === null ? c.onAccent : c.text, fontSize: fs(13), fontWeight: '600' }}>{none.label}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

interface DraftPeriod {
  key: number;
  from: string;
  rateText: string;
  prepayment: number;
  override: number | null;
  useOverride: boolean;
  /** What the user transfers each month, when more than the bank's payment. */
  actual: number | null;
  useActual: boolean;
  /** Pays off everything still owed when the period starts. */
  payOff: boolean;
}

/**
 * Add or edit a bank loan. The loan is split into periods, each with its own
 * months (picked by tapping), rate and, after the first, a prepayment at its
 * start, or "pay it all", which settles the loan. The monthly payment of every
 * period is recalculated from the balance owed, the rate and the months left,
 * and follows every change; the bank's own figure can be entered per period
 * and is dropped when that period's terms change. What the user actually pays
 * each month can be entered per period too: it is the month's expense, and what
 * it pays beyond the bank's payment comes off the principal. The term is set
 * only at the top: the last period always runs to its end.
 */
export function LoanSheet({
  visible,
  onClose,
  item,
  familyItem,
}: {
  visible: boolean;
  onClose: () => void;
  /** A bank loan to edit. */
  item?: Loan | null;
  /** A loan from family to edit. Neither: a new loan of either kind. */
  familyItem?: FamilyLoan | null;
}) {
  const { c } = useUi();
  const money = useMoney();
  const upsert = useStore((s) => s.upsertLoan);
  const remove = useStore((s) => s.deleteLoan);
  const upsertFamily = useStore((s) => s.upsertFamilyLoan);
  const removeFamily = useStore((s) => s.deleteFamilyLoan);
  const cashMonth = useStore((s) => s.cash?.month) ?? monthKey();
  const [type, setType] = useState<'bank' | 'family'>('bank');
  // A loan from family: received in a month, paid back in one go after the term.
  const [famStart, setFamStart] = useState(monthKey());
  const [termText, setTermText] = useState('12');
  const [termUnit, setTermUnit] = useState<'month' | 'year'>('month');
  const [withInterest, setWithInterest] = useState(false);
  const [famRateText, setFamRateText] = useState('');
  const [receive, setReceive] = useState(false);
  const [name, setName] = useState('');
  const [principal, setPrincipal] = useState(0);
  const [months, setMonths] = useState(360);
  const [monthsText, setMonthsText] = useState('360');
  const [start, setStart] = useState(monthKey());
  const [periods, setPeriods] = useState<DraftPeriod[]>([]);
  const [key, setKey] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const nextKey = React.useRef(0);

  useEffect(() => {
    if (!visible) return;
    const l = item ? normalizeLoan(item) : null;
    const f = familyItem ? normalizeFamilyLoan(familyItem) : null;
    setType(f ? 'family' : 'bank');
    setName(f?.name ?? l?.name ?? '');
    setPrincipal(f?.principal ?? l?.principal ?? 0);
    setFamStart(f?.startMonth ?? monthKey());
    // A whole number of years shows in years.
    const fm = f?.months ?? 12;
    setTermUnit(fm % 12 === 0 ? 'year' : 'month');
    setTermText(String(fm % 12 === 0 ? fm / 12 : fm));
    setWithInterest(!!f && f.ratePct > 0);
    setFamRateText(f && f.ratePct > 0 ? String(f.ratePct).replace('.', ',') : '');
    setReceive(!!f?.receive);
    setMonths(l?.months ?? 360);
    setMonthsText(String(l?.months ?? 360));
    setStart(l?.startMonth ?? monthKey());
    setPeriods(
      (l?.periods ?? [{ from: monthKey(), ratePct: NaN, prepayment: 0, paymentOverride: null }]).map((p) => ({
        key: nextKey.current++,
        from: p.from,
        rateText: Number.isFinite(p.ratePct) ? String(p.ratePct).replace('.', ',') : '',
        prepayment: p.prepayment,
        override: p.paymentOverride,
        useOverride: p.paymentOverride !== null,
        actual: p.actualPayment ?? null,
        useActual: p.actualPayment !== undefined,
        payOff: !!p.payOff,
      })),
    );
    setNote(null);
    setKey((k) => k + 1);
  }, [visible, item, familyItem]);

  // ---- a loan from family ----
  const termN = parseInt(termText, 10) || 0;
  const famMonths = termUnit === 'year' ? termN * 12 : termN;
  const famRate = withInterest ? parseFloat(famRateText.replace(',', '.')) : 0;
  const famDraft: FamilyLoan = normalizeFamilyLoan({
    id: familyItem?.id ?? 'draft',
    name,
    principal,
    startMonth: famStart,
    months: famMonths,
    ratePct: Number.isFinite(famRate) ? famRate : 0,
    receive,
  });
  const famValid =
    name.trim().length > 0 && principal > 0 && famMonths >= 1 && famMonths <= 600 && (!withInterest || (Number.isFinite(famRate) && famRate > 0 && famRate <= 100));
  const famInterest = familyLoanInterest(famDraft);
  const famDue = familyLoanDueMonth(famDraft);
  const saveFamily = () => {
    upsertFamily({ ...famDraft, id: familyItem?.id });
    onClose();
  };
  // Money received after the money on hand was entered is not in it yet: count it as income then.
  const changeFamStart = (m: string) => {
    setFamStart(m);
    setReceive(m > cashMonth);
  };
  const editing = !!item || !!familyItem;

  const end = shiftMonth(start, months - 1);
  // Later periods that fall outside the term while it is being changed are kept aside
  // (they come back if the term grows again) and are not saved.
  const shown = periods.length
    ? [periods[0], ...periods.slice(1).filter((p) => p.from > start && p.from <= end).sort((a, b) => a.from.localeCompare(b.from))]
    : [];
  const rateOf = (p: DraftPeriod) => parseFloat(p.rateText.replace(',', '.'));
  const draft: Loan = normalizeLoan({
    id: item?.id ?? 'draft',
    name,
    principal,
    months,
    startMonth: start,
    periods: shown.map((p, i) => ({
      from: i === 0 ? start : p.from,
      ratePct: Number.isFinite(rateOf(p)) ? rateOf(p) : 0,
      prepayment: i === 0 ? 0 : p.prepayment,
      paymentOverride: p.useOverride && p.override ? p.override : null,
      ...(p.useActual && p.actual ? { actualPayment: p.actual } : {}),
      ...(i > 0 && p.payOff ? { payOff: true } : {}),
    })),
  });
  // A period that pays everything off has nothing left to charge interest on: no rate needed.
  const valid =
    name.trim().length > 0 &&
    principal > 0 &&
    months >= 1 &&
    shown.length > 0 &&
    shown.every((p, i) => (i > 0 && p.payOff) || (Number.isFinite(rateOf(p)) && rateOf(p) >= 0));
  const summary = valid ? loanPeriods(draft) : [];
  const now = monthKey();
  const paid = loanPaidBefore(draft, now);
  const final = valid ? loanFinalMonth(draft) : end;
  const settled = shown.length > 1 && shown[shown.length - 1].payOff;
  // Interest saved by paying more than the bank asks: against the same loan paid at the bank's figures.
  const atBankFigures = draft.periods.map((p) => ({ ...p, actualPayment: undefined }));
  const interestSaved = valid && draft.periods.some((p) => p.actualPayment) ? loanTotalInterest({ ...draft, periods: atBankFigures }) - loanTotalInterest(draft) : 0;

  // Changing what a period repays or its rate means a new calculation: the bank's
  // old figure for that period and every later one no longer applies.
  const termsChangedFrom = (index: number) => {
    // Decided from the periods as they are now; the update itself is applied by React later.
    const affected = new Set(shown.slice(index).filter((p) => p.useOverride).map((p) => p.key));
    if (!affected.size) return;
    setPeriods((cur) => cur.map((p) => (affected.has(p.key) ? { ...p, useOverride: false, override: null } : p)));
    setNote('Đã bỏ số trả theo ngân hàng của giai đoạn bị thay đổi.');
  };
  const update = (k: number, patch: Partial<DraftPeriod>) => setPeriods((cur) => cur.map((p) => (p.key === k ? { ...p, ...patch } : p)));

  // The term is changed only here (chips, number of months, first month), never by a period.
  const changeStart = (m: string) => {
    setStart(m);
    termsChangedFrom(0);
  };
  const changeMonths = (n: number) => {
    setMonths(n);
    setMonthsText(String(n));
    termsChangedFrom(0);
  };

  const addPeriod = () => {
    const last = shown[shown.length - 1];
    const lastFrom = shown.length === 1 ? start : last.from;
    // A year after the last period starts, but never before next month and never past the end.
    let from = shiftMonth(lastFrom, 12);
    if (from <= now) from = shiftMonth(now, 1);
    if (from <= lastFrom) from = shiftMonth(lastFrom, 1);
    if (from > end) return;
    // Periods kept aside outside the term are dropped: the new one takes their place.
    // The user usually keeps transferring the same amount: carried into the new period.
    setPeriods([
      ...shown,
      { key: nextKey.current++, from, rateText: last.rateText, prepayment: 0, override: null, useOverride: false, actual: last.actual, useActual: last.useActual, payOff: false },
    ]);
  };

  // "Pay it all" settles the loan when the period starts: later periods have nothing left to repay.
  const setPayOff = (index: number, on: boolean) => {
    const p = shown[index];
    if (on) {
      const later = new Set(shown.slice(index + 1).map((x) => x.key));
      setPeriods((cur) =>
        cur.filter((x) => !later.has(x.key)).map((x) => (x.key === p.key ? { ...x, payOff: true, useOverride: false, override: null, useActual: false } : x)),
      );
      setNote(later.size ? `Đã bỏ ${later.size} giai đoạn sau ${monthYear(p.from)}: khoản vay đã được trả hết.` : null);
    } else {
      update(p.key, { payOff: false, prepayment: 0 });
      setNote(null);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={familyItem ? 'Sửa khoản vay người thân' : item ? 'Sửa khoản vay ngân hàng' : 'Thêm khoản vay'}
      footer={
        <Btn
          label="Lưu"
          icon="checkmark"
          disabled={type === 'family' ? !famValid : !valid}
          onPress={() => {
            if (type === 'family') return saveFamily();
            // A payoff also records what it paid.
            const saved = draft.periods.map((p, i) => (p.payOff ? { ...p, prepayment: summary[i]?.prepayment ?? p.prepayment } : p));
            upsert({ id: item?.id, name, principal, months, startMonth: start, periods: saved });
            onClose();
          }}
        />
      }>
      {editing ? null : (
        <Segmented
          value={type}
          onChange={setType}
          options={[
            { value: 'bank', label: 'Vay ngân hàng' },
            { value: 'family', label: 'Vay người thân' },
          ]}
        />
      )}
      <Field
        label="Tên khoản vay"
        value={name}
        onChangeText={setName}
        placeholder={type === 'family' ? 'Vay bố mẹ, vay anh chị…' : 'Vay mua nhà, vay mua xe…'}
        autoFocus={!editing}
      />
      {type === 'family' ? (
        <>
          <AmountField key={`f${key}`} label="Số tiền vay" value={principal} onChange={setPrincipal} />
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <MonthField label="Tháng nhận tiền" value={famStart} onChange={changeFamStart} />
            {/* Follows the term: paid back the term after the money is received. */}
            <MonthField label="Tháng trả gốc + lãi" value={famDue} readOnly />
          </View>
          <View style={{ gap: 8 }}>
            <Txt v="label">Thời hạn vay</Txt>
            <Segmented
              value={termUnit}
              onChange={setTermUnit}
              options={[
                { value: 'month', label: 'Tính theo tháng' },
                { value: 'year', label: 'Tính theo năm' },
              ]}
            />
            <Field
              label={termUnit === 'year' ? 'Số năm' : 'Số tháng'}
              value={termText}
              keyboardType="number-pad"
              onChangeText={(t) => setTermText(t.replace(/\D/g, '').slice(0, 3))}
            />
            <Txt v="small">
              {famMonths >= 1 && famMonths <= 600 ? `${famMonths} tháng · trả một lần vào ${monthYear(famDue)}` : 'Thời hạn từ 1 tháng đến 50 năm.'}
            </Txt>
          </View>
          <View style={{ gap: 8 }}>
            <Txt v="label">Lãi</Txt>
            <Segmented
              value={withInterest ? 'yes' : 'no'}
              onChange={(v) => setWithInterest(v === 'yes')}
              options={[
                { value: 'no', label: 'Không lãi' },
                { value: 'yes', label: 'Có lãi' },
              ]}
            />
            {withInterest ? (
              <Field
                label="Lãi suất (%/năm, lãi đơn)"
                value={famRateText}
                placeholder="5"
                keyboardType="decimal-pad"
                onChangeText={(t) => setFamRateText(t.replace(/[^0-9.,]/g, ''))}
              />
            ) : null}
          </View>
          {famValid ? (
            <View style={{ backgroundColor: c.cardAlt, borderRadius: 12, padding: 12, gap: 6 }}>
              <Txt v="heading">Trả một lần vào {monthYear(famDue)}</Txt>
              <Row>
                <Txt v="small">Gốc</Txt>
                <Txt v="small">{money(principal)}</Txt>
              </Row>
              <Row style={{ gap: 12 }}>
                <Txt v="small" style={{ flex: 1 }}>
                  {withInterest ? `Lãi ${famRateText}%/năm × ${famMonths % 12 === 0 ? `${famMonths / 12} năm` : `${famMonths} tháng`}` : 'Lãi'}
                </Txt>
                <Txt v="small">{money(famInterest)}</Txt>
              </Row>
              <View style={{ height: 1, backgroundColor: c.border }} />
              <Row>
                <Txt v="label">Tổng phải trả</Txt>
                <Txt v="title">{money(principal + famInterest)}</Txt>
              </Row>
              <Txt v="small">Không trả hàng tháng: số này được tính vào chi của {monthYear(famDue)} trong bảng thu chi.</Txt>
            </View>
          ) : null}
          <Toggle
            label={`Tính tiền nhận được vào thu ${monthYear(famStart)}`}
            hint={`Bật nếu số tiền này chưa có trong Tiền đang có (nhập ${monthYear(cashMonth)}), ví dụ khoản sẽ vay sau này.`}
            value={receive}
            onChange={setReceive}
          />
        </>
      ) : (
        <>
      <View style={{ gap: 8 }}>
        <Txt v="label">Thời hạn vay</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {LOAN_YEARS.map((y) => (
            <Chip key={y} label={`${y} năm`} active={months === y * 12} onPress={() => changeMonths(y * 12)} />
          ))}
        </View>
        <Field
          label="Hoặc nhập số tháng"
          value={monthsText}
          onChangeText={(t) => {
            const digits = t.replace(/\D/g, '').slice(0, 3);
            setMonthsText(digits);
            const n = parseInt(digits, 10);
            if (n >= 1 && n <= 600) {
              setMonths(n);
              termsChangedFrom(0);
            }
          }}
        />
        <Txt v="small">
          Từ {monthYear(start)} đến {monthYear(end)} · {months} kỳ trả{final < end ? ` · tất toán ${monthYear(final)}` : ''}
        </Txt>
      </View>

      {shown.map((p, i) => {
        const last = i === shown.length - 1;
        const from = i === 0 ? start : p.from;
        const to = last ? end : shiftMonth(shown[i + 1].from, -1);
        const sum = summary[i];
        const nextFrom = shown[i + 2]?.from;
        const payOff = i > 0 && p.payOff;
        return (
          <View key={p.key} style={{ gap: 10, backgroundColor: c.cardAlt, borderRadius: 12, padding: 12 }}>
            <Row>
              <Txt v="heading">Giai đoạn {i + 1}</Txt>
              {i > 0 ? (
                <IconBtn
                  name="trash-outline"
                  size={18}
                  color={c.negative}
                  label={`Xoá giai đoạn ${i + 1}`}
                  onPress={() => {
                    setPeriods((cur) => cur.filter((x) => x.key !== p.key));
                    termsChangedFrom(i);
                  }}
                />
              ) : null}
            </Row>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <MonthField
                label={payOff ? 'Tháng trả hết' : 'Từ tháng'}
                value={from}
                // The first period starts with the first payment; later ones between their neighbours.
                min={i === 0 ? undefined : shiftMonth(i === 1 ? start : shown[i - 1].from, 1)}
                max={i === 0 ? undefined : last ? end : shiftMonth(shown[i + 1].from, -1)}
                onChange={(m) => {
                  if (i === 0) changeStart(m);
                  else {
                    // Moving where this period starts changes what it starts from.
                    update(p.key, { from: m });
                    termsChangedFrom(i);
                  }
                }}
              />
              {payOff ? null : last ? (
                // The last period runs to the end of the loan; the term is changed above.
                <MonthField label="Đến hết hạn vay" value={end} readOnly />
              ) : (
                <MonthField
                  label="Đến tháng"
                  value={to}
                  min={from}
                  // The next period moves with it and keeps at least one month.
                  max={shiftMonth(nextFrom ?? shiftMonth(end, 1), -2)}
                  onChange={(m) => {
                    update(shown[i + 1].key, { from: shiftMonth(m, 1) });
                    termsChangedFrom(i + 1);
                  }}
                />
              )}
            </View>
            {i === 0 ? (
              <AmountField
                key={`p${key}`}
                label="Số tiền vay"
                value={principal}
                onChange={(n) => {
                  setPrincipal(n);
                  termsChangedFrom(0);
                }}
              />
            ) : (
              <>
                {sum ? (
                  <Row>
                    <Txt v="small">Tiền nợ hiện tại (đầu giai đoạn)</Txt>
                    <Txt v="small">{money(sum.carried)}</Txt>
                  </Row>
                ) : null}
                <Toggle
                  label="Trả toàn bộ"
                  hint={`Tự nhập toàn bộ dư nợ vào ô trả trước: khoản vay được tất toán trong ${monthYear(from)}.`}
                  value={payOff}
                  onChange={(v) => setPayOff(i, v)}
                />
                <AmountField
                  sync
                  key={`pp${key}-${p.key}`}
                  label="Số tiền trả trước trong giai đoạn này"
                  value={payOff ? (sum?.carried ?? 0) : p.prepayment}
                  onChange={(n) => {
                    // An amount of their own replaces "pay it all".
                    update(p.key, { prepayment: Math.max(0, n), payOff: false });
                    termsChangedFrom(i);
                  }}
                />
                {sum && payOff ? (
                  <View style={{ backgroundColor: c.card, borderRadius: 10, padding: 10, gap: 4 }}>
                    <Row>
                      <Txt v="label">Dư nợ còn lại</Txt>
                      <Txt v="heading" color={c.positive}>
                        {money(0)}
                      </Txt>
                    </Row>
                    <Txt v="small">
                      Tất toán: {money(sum.prepayment)} được tính là tiền chi ra trong {monthYear(from)}; từ {monthYear(shiftMonth(from, 1))} không còn
                      trả hàng tháng.
                    </Txt>
                  </View>
                ) : sum ? (
                  <View style={{ backgroundColor: c.card, borderRadius: 10, padding: 10, gap: 4 }}>
                    <Row>
                      <Txt v="label">Dư nợ còn lại sau trả trước</Txt>
                      <Txt v="heading">{money(sum.principal)}</Txt>
                    </Row>
                    <Txt v="small">
                      = nợ hiện tại {money(sum.carried)} − trả trước {money(sum.prepayment)}
                      {p.prepayment > sum.carried ? ' (trả trước nhiều hơn số nợ: chỉ tính bằng số nợ)' : ''}
                    </Txt>
                    {sum.prepayment > 0 ? (
                      <Txt v="small" color={c.accent}>
                        Khoản trả trước được tính là tiền chi ra trong {monthYear(from)}.
                      </Txt>
                    ) : null}
                  </View>
                ) : null}
              </>
            )}
            {payOff ? null : (
              <>
                <Field
                  label="Lãi suất (%/năm)"
                  value={p.rateText}
                  placeholder={i === 0 ? '6' : 'Lãi thả nổi dự kiến'}
                  onChangeText={(t) => {
                    update(p.key, { rateText: t.replace(/[^0-9.,]/g, '') });
                    termsChangedFrom(i);
                  }}
                />
                {sum ? (
                  <View style={{ backgroundColor: c.card, borderRadius: 10, padding: 10, gap: 4 }}>
                    <Row>
                      <Txt v="label">Trả mỗi tháng</Txt>
                      <Txt v="title">{money(sum.payment)}</Txt>
                    </Row>
                    <Txt v="small">
                      {p.useOverride && p.override
                        ? `Theo ngân hàng. Tính theo trả góp đều: ${money(sum.calculated)}.`
                        : `Gốc + lãi chia đều trên ${monthsBetweenKeys(from, end) + 1} tháng còn lại.`}
                    </Txt>
                  </View>
                ) : null}
                <Toggle
                  label="Ngân hàng tính số trả khác"
                  hint="Bật nếu số trả thực tế của giai đoạn này khác số tính ở trên."
                  value={p.useOverride}
                  onChange={(v) => {
                    update(p.key, { useOverride: v, override: v ? p.override ?? sum?.calculated ?? null : p.override });
                    setNote(null);
                  }}
                />
                {p.useOverride ? (
                  <AmountField
                    key={`o${key}-${p.key}`}
                    label="Số trả mỗi tháng theo ngân hàng"
                    value={p.override ?? sum?.calculated ?? 0}
                    onChange={(n) => update(p.key, { override: n || null })}
                  />
                ) : null}
                <Toggle
                  label="Số tiền thực chi khác số ngân hàng thu"
                  hint="Bật nếu mỗi tháng bạn chuyển vào tài khoản trả vay nhiều hơn số ngân hàng thu. Số này được tính vào chi hàng tháng; phần chuyển thêm trừ vào nợ gốc."
                  value={p.useActual}
                  onChange={(v) => update(p.key, { useActual: v, actual: v ? (p.actual ?? sum?.payment ?? null) : p.actual })}
                />
                {p.useActual ? (
                  <>
                    <AmountField
                      key={`a${key}-${p.key}`}
                      label="Số tiền thực chi mỗi tháng"
                      value={p.actual ?? sum?.payment ?? 0}
                      onChange={(n) => update(p.key, { actual: n || null })}
                    />
                    {sum ? (
                      <View style={{ backgroundColor: c.card, borderRadius: 10, padding: 10, gap: 4 }}>
                        {(p.actual ?? 0) > sum.payment ? (
                          <>
                            <Row style={{ gap: 12 }}>
                              <Txt v="label" style={{ flex: 1 }}>Trả thêm vào gốc mỗi tháng</Txt>
                              <Txt v="heading" color={c.positive}>
                                {money((p.actual ?? 0) - sum.payment)}
                              </Txt>
                            </Row>
                            <Txt v="small">
                              Ngân hàng vẫn thu {money(sum.payment)}/tháng. Bảng thu chi tính {money(p.actual ?? 0)}/tháng; phần chuyển thêm trừ vào nợ gốc nên dư nợ giảm nhanh hơn.
                            </Txt>
                          </>
                        ) : (
                          <Txt v="small" color={c.warning}>
                            Chưa nhiều hơn số ngân hàng thu ({money(sum.payment)}): Finy vẫn tính theo số ngân hàng thu.
                          </Txt>
                        )}
                      </View>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
          </View>
        );
      })}

      {settled ? null : <Btn label="Thêm giai đoạn (đổi lãi suất, trả trước)" icon="add" kind="ghost" onPress={addPeriod} disabled={!valid} />}
      {note ? <Txt v="small" color={c.warning}>{note}</Txt> : null}

      {valid ? (
        <View style={{ backgroundColor: c.cardAlt, borderRadius: 12, padding: 12, gap: 6 }}>
          <Row>
            <Txt v="small">Tổng lãi cả khoản vay</Txt>
            <Txt v="small">{money(loanTotalInterest(draft))}</Txt>
          </Row>
          {interestSaved > 0 ? (
            <Row>
              <Txt v="small" color={c.positive}>Bớt lãi nhờ trả thêm</Txt>
              <Txt v="small" color={c.positive}>{money(interestSaved)}</Txt>
            </Row>
          ) : null}
          {paid > 0 && paid < months ? (
            <Row>
              <Txt v="small">
                Đã trả {paid}/{months} kỳ · dư nợ hiện tại
              </Txt>
              <Txt v="small">{money(loanBalance(draft, paid))}</Txt>
            </Row>
          ) : null}
          <Row>
            <Txt v="small">{final < end ? 'Tất toán' : 'Kỳ cuối'}</Txt>
            <Txt v="small">{monthYear(final)}</Txt>
          </Row>
        </View>
      ) : null}

        </>
      )}

      {item || familyItem ? (
        <Btn
          label="Xoá khoản vay"
          kind="danger"
          icon="trash-outline"
          onPress={() =>
            confirmDelete(`khoản vay "${(familyItem ?? item)!.name}"`, () => {
              if (familyItem) removeFamily(familyItem.id);
              else if (item) remove(item.id);
              onClose();
            })
          }
        />
      ) : null}
    </Sheet>
  );
}

const monthsBetweenKeys = (a: string, b: string) => {
  const [y1, m1] = a.split('-').map(Number);
  const [y2, m2] = b.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
};

type PlanScope = 'month' | 'range' | 'all';

interface PlanRow {
  id?: string;
  note: string;
  amount: number;
  key: number;
  /** One month only (the month the plan is looked at for), a range of months, or every month. */
  scope: PlanScope;
  from: string;
  to: string;
}

/**
 * The credit-card plan per statement cycle, as several items with a note each.
 * Every item applies to the month the plan is opened for only, to a range of
 * months, or to every month. Saved as fixed expenses of kind "credit" (the
 * note is the item's name; the range is fromMonth / toMonth).
 */
export function CreditPlanSheet({ visible, onClose, month }: { visible: boolean; onClose: () => void; month: string }) {
  const { c } = useUi();
  const money = useMoney();
  const fixed = useStore((s) => s.fixed);
  const statementDay = useStore((s) => s.settings.statementDay);
  const upsertFixed = useStore((s) => s.upsertFixed);
  const deleteFixed = useStore((s) => s.deleteFixed);
  const [rows, setRows] = useState<PlanRow[]>([]);
  const nextKey = React.useRef(0);

  const newRow = (): PlanRow => ({ note: '', amount: 0, key: nextKey.current++, scope: 'all', from: month, to: shiftMonth(month, 5) });
  // An item set for one other month belongs to that month alone: it is not shown here
  // (it shows when that month is opened) and saving here leaves it as it is.
  const otherMonthOnly = (f: FixedItem) => !!f.fromMonth && f.fromMonth === f.toMonth && f.fromMonth !== month;

  useEffect(() => {
    if (!visible) return;
    const items = fixed.filter((f) => f.direction === 'out' && f.kind === 'credit' && !otherMonthOnly(f));
    const loaded = items.map((f): PlanRow => {
      const scope: PlanScope = !f.fromMonth && !f.toMonth ? 'all' : f.fromMonth === month && f.toMonth === month ? 'month' : 'range';
      return {
        id: f.id,
        note: f.name,
        amount: f.amount,
        key: nextKey.current++,
        scope,
        from: f.fromMonth ?? month,
        to: f.toMonth ?? f.fromMonth ?? shiftMonth(month, 5),
      };
    });
    setRows(loaded.length ? loaded : [newRow()]);
    // Only when the sheet opens: edits in progress must not be reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, month]);

  const update = (key: number, patch: Partial<PlanRow>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const appliesHere = (r: PlanRow) => r.scope === 'all' || (r.scope === 'month' ? true : r.from <= month && month <= r.to);
  const counted = rows.filter((r) => r.amount > 0 && appliesHere(r));
  const totalAmount = counted.reduce((s, r) => s + r.amount, 0);
  const notes = counted.filter((r) => r.note.trim()).map((r) => r.note.trim()).join(', ');
  const valid = rows.every((r) => r.amount <= 0 || r.note.trim());
  const cycle = creditCycle(month, statementDay);
  const cycleText = `kỳ ${Number(cycle.start.slice(8, 10))}/${Number(cycle.start.slice(5, 7))} – ${Number(cycle.end.slice(8, 10))}/${Number(cycle.end.slice(5, 7))}`;

  const save = () => {
    const keep = new Set<string>();
    for (const r of rows) {
      if (!(r.amount > 0)) continue;
      const range =
        r.scope === 'all' ? { fromMonth: undefined, toMonth: undefined } : r.scope === 'month' ? { fromMonth: month, toMonth: month } : { fromMonth: r.from, toMonth: r.to };
      const saved = upsertFixed({ id: r.id, name: r.note.trim(), amount: r.amount, direction: 'out', kind: 'credit', ...range });
      keep.add(saved.id);
    }
    for (const f of fixed) if (f.direction === 'out' && f.kind === 'credit' && !keep.has(f.id) && !otherMonthOnly(f)) deleteFixed(f.id);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Dự chi tín dụng" footer={<Btn label="Lưu" icon="checkmark" disabled={!valid} onPress={save} />}>
      <Txt v="small">Số tiền dự định quẹt thẻ mỗi kỳ sao kê, chia theo khoản. Mỗi khoản chọn được áp dụng chỉ tháng này, một giai đoạn, hoặc toàn bộ thời gian.</Txt>
      {rows.map((r, i) => (
        <View key={r.key} style={{ gap: 8, backgroundColor: c.cardAlt, borderRadius: 12, padding: 12 }}>
          <Row>
            <Txt v="label">Khoản {i + 1}</Txt>
            <IconBtn name="trash-outline" size={18} color={c.negative} onPress={() => setRows((cur) => cur.filter((x) => x.key !== r.key))} label={`Xoá khoản ${i + 1}`} />
          </Row>
          <Field label="Ghi chú" value={r.note} onChangeText={(t) => update(r.key, { note: t })} placeholder="Ăn uống, xăng xe, mua sắm…" />
          <AmountField label="Số tiền mỗi kỳ" value={r.amount} onChange={(n) => update(r.key, { amount: n })} />
          {r.amount > 0 && !r.note.trim() ? <Txt v="small" color={c.warning}>Nhập ghi chú cho khoản này.</Txt> : null}
          <Txt v="label">Áp dụng</Txt>
          <Segmented
            value={r.scope}
            onChange={(scope) => update(r.key, { scope })}
            options={[
              { value: 'month', label: 'Chỉ tháng này' },
              { value: 'range', label: 'Từ – đến' },
              { value: 'all', label: 'Toàn bộ' },
            ]}
          />
          {r.scope === 'month' ? (
            <Txt v="small">
              Chỉ {monthLabel(month).toLowerCase()} ({cycleText}).
            </Txt>
          ) : r.scope === 'range' ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <MonthField label="Từ tháng" value={r.from} max={r.to} onChange={(m) => update(r.key, { from: m })} />
              <MonthField label="Đến tháng" value={r.to} min={r.from} onChange={(m) => update(r.key, { to: m })} />
            </View>
          ) : (
            <Txt v="small">Mọi tháng.</Txt>
          )}
        </View>
      ))}
      <Btn label="Thêm khoản dự chi" icon="add" kind="ghost" onPress={() => setRows((cur) => [...cur, newRow()])} />
      <View style={{ backgroundColor: c.cardAlt, borderRadius: 12, padding: 12, gap: 4 }}>
        <Row>
          <Txt v="label">Tổng dự chi {monthLabel(month).toLowerCase()}</Txt>
          <Txt v="title">{money(totalAmount)}</Txt>
        </Row>
        {notes ? <Txt v="small">{notes}</Txt> : null}
      </View>
    </Sheet>
  );
}
