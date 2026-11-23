// Add / edit forms, shared by several screens.
import React, { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Alert, Pressable, Switch, Text, View } from 'react-native';
import { instalmentAmount, loanBalance, loanPaidBefore, loanPeriods, loanTotalInterest, normalizeLoan } from '../lib/finance';
import { dateKey, dayLabel, fmtVND, monthKey, monthLabel, monthShort, shiftMonth } from '../lib/format';
import { useStore } from '../lib/store';
import type { Account, AccountKind, FixedItem, Instalment, Loan, OneOff, Tx } from '../lib/types';
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

/** Add or edit an income or expense that repeats every month. */
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
  const upsertFixed = useStore((s) => s.upsertFixed);
  const deleteFixed = useStore((s) => s.deleteFixed);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState(0);
  const [kind, setKind] = useState<'expense' | 'debt' | 'credit'>('expense');
  const [daily, setDaily] = useState(false);
  const [onCard, setOnCard] = useState(false);
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setName(item?.name ?? (initialKind === 'credit' ? 'Thẻ tín dụng' : ''));
    setAmount(item?.amount ?? 0);
    setKind(item?.kind ?? initialKind);
    setDaily(!!item?.daily);
    setOnCard(!!item?.onCard);
    setKey((k) => k + 1);
  }, [visible, item, initialKind]);

  const out = direction === 'out';
  const what = out ? 'chi cố định' : 'thu cố định';
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={item ? `Sửa khoản ${what}` : `Thêm khoản ${what}`}
      footer={
        <Btn
          label="Lưu"
          icon="checkmark"
          disabled={!name.trim() || !(amount > 0)}
          onPress={() => {
            upsertFixed({ id: item?.id, name, amount, direction, kind: out ? kind : undefined, daily: out && kind === 'expense' && daily && !onCard, onCard: out && kind === 'expense' && onCard });
            onClose();
          }}
        />
      }>
      <Field label="Tên" value={name} onChangeText={setName} placeholder={out ? 'Tiền nhà, điện nước, học phí…' : 'Lương, cho thuê nhà…'} autoFocus={!item} />
      <AmountField key={key} label="Số tiền mỗi tháng" value={amount} onChange={setAmount} />
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
      {out && kind === 'credit' ? (
        <Txt v="small">Một khoản dự chi tín dụng mỗi kỳ sao kê; tên là ghi chú của khoản. Nhiều khoản được cộng thành tổng dự chi.</Txt>
      ) : null}
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
 * Edit what a fixed item amounts to in one month.
 * The amount can be saved for that month only, or as the new usual amount.
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
    setAmount(current ?? item.amount);
    setKey((k) => k + 1);
    // Only when the sheet opens: later store changes must not reset what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, item?.id, month]);

  if (!item) return null;
  const label = monthShort(month);
  const overridden = current !== undefined;
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
        Mức cố định hàng tháng: {money(item.amount)}.{overridden ? ` ${label} đang dùng mức riêng ${money(current)}.` : ''} Nhập 0 nếu tháng này không có khoản này.
      </Txt>
      <Btn
        label="Áp dụng cho mọi tháng"
        kind="ghost"
        icon="repeat-outline"
        disabled={!(amount > 0)}
        onPress={() => {
          upsertFixed({ ...item, amount });
          setOverride(month, item.id, null);
          onClose();
        }}
      />
      {overridden ? (
        <Btn
          label={`Bỏ mức riêng, về ${money(item.amount)}`}
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
 */
export function MonthField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (month: string) => void;
  min?: string;
  max?: string;
}) {
  const { c, r, fs } = useUi();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(value.slice(0, 4)));
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <Pressable
        onPress={() => {
          setYear(Number(value.slice(0, 4)));
          setOpen((o) => !o);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${monthYear(value)}. Chạm để chọn tháng.`}
        style={({ pressed }) => ({
          backgroundColor: c.card,
          borderRadius: Math.min(r, 12),
          borderWidth: 1,
          borderColor: open ? c.accent : c.border,
          paddingHorizontal: 10,
          paddingVertical: 8,
          opacity: pressed ? 0.7 : 1,
        })}>
        <Txt v="small">{label}</Txt>
        <Row>
          <Text style={{ color: c.text, fontSize: fs(16), fontWeight: '700' }}>{monthYear(value)}</Text>
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
                    onChange(m);
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
}

/**
 * Add or edit a bank loan. The loan is split into periods, each with its own
 * months (picked by tapping), rate and, after the first, a prepayment at its
 * start, entered as the amount still borrowed for that period. The monthly
 * payment of every period is recalculated from the balance owed, the rate and
 * the months left, and follows every change; the bank's own figure can be
 * entered per period and is dropped when that period's terms change.
 */
export function LoanSheet({ visible, onClose, item }: { visible: boolean; onClose: () => void; item?: Loan | null }) {
  const { c } = useUi();
  const money = useMoney();
  const upsert = useStore((s) => s.upsertLoan);
  const remove = useStore((s) => s.deleteLoan);
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
    setName(l?.name ?? '');
    setPrincipal(l?.principal ?? 0);
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
      })),
    );
    setNote(null);
    setKey((k) => k + 1);
  }, [visible, item]);

  const end = shiftMonth(start, months - 1);
  const rateOf = (p: DraftPeriod) => parseFloat(p.rateText.replace(',', '.'));
  const draft: Loan = normalizeLoan({
    id: item?.id ?? 'draft',
    name,
    principal,
    months,
    startMonth: start,
    periods: periods.map((p, i) => ({
      from: i === 0 ? start : p.from,
      ratePct: Number.isFinite(rateOf(p)) ? rateOf(p) : 0,
      prepayment: i === 0 ? 0 : p.prepayment,
      paymentOverride: p.useOverride && p.override ? p.override : null,
    })),
  });
  const valid = name.trim().length > 0 && principal > 0 && months >= 1 && periods.length > 0 && periods.every((p) => Number.isFinite(rateOf(p)) && rateOf(p) >= 0);
  const summary = valid ? loanPeriods(draft) : [];
  const now = monthKey();
  const paid = loanPaidBefore(draft, now);

  // Changing what a period repays or its rate means a new calculation: the bank's
  // old figure for that period and every later one no longer applies.
  const termsChangedFrom = (index: number) => {
    // Decided from the periods as they are now; the update itself is applied by React later.
    if (!periods.some((p, i) => i >= index && p.useOverride)) return;
    setPeriods((cur) => cur.map((p, i) => (i < index || !p.useOverride ? p : { ...p, useOverride: false, override: null })));
    setNote('Đã bỏ số trả theo ngân hàng của giai đoạn bị thay đổi.');
  };
  const update = (k: number, patch: Partial<DraftPeriod>) => setPeriods((cur) => cur.map((p) => (p.key === k ? { ...p, ...patch } : p)));

  // Keeps every later period inside the term after the start or the term changed.
  const clamp = (list: DraftPeriod[], s0: string, e0: string) => {
    const out = list.filter((p, i) => i === 0 || (p.from > s0 && p.from <= e0));
    return out.length ? out : list.slice(0, 1);
  };
  const changeStart = (m: string) => {
    setStart(m);
    setPeriods((cur) => clamp(cur, m, shiftMonth(m, months - 1)));
    termsChangedFrom(0);
  };
  const changeMonths = (n: number) => {
    setMonths(n);
    setMonthsText(String(n));
    setPeriods((cur) => clamp(cur, start, shiftMonth(start, n - 1)));
    termsChangedFrom(0);
  };
  const monthsBetweenKeys = (a: string, b: string) => {
    const [y1, m1] = a.split('-').map(Number);
    const [y2, m2] = b.split('-').map(Number);
    return (y2 - y1) * 12 + (m2 - m1);
  };

  const addPeriod = () => {
    const last = periods[periods.length - 1];
    const lastFrom = periods.length === 1 ? start : last.from;
    // A year after the last period starts, but never before next month and never past the end.
    let from = shiftMonth(lastFrom, 12);
    if (from <= now) from = shiftMonth(now, 1);
    if (from <= lastFrom) from = shiftMonth(lastFrom, 1);
    if (from > end) return;
    setPeriods((cur) => [...cur, { key: nextKey.current++, from, rateText: last.rateText, prepayment: 0, override: null, useOverride: false }]);
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={item ? 'Sửa khoản vay' : 'Thêm khoản vay ngân hàng'}
      footer={
        <Btn
          label="Lưu"
          icon="checkmark"
          disabled={!valid}
          onPress={() => {
            upsert({ id: item?.id, name, principal, months, startMonth: start, periods: draft.periods });
            onClose();
          }}
        />
      }>
      <Field label="Tên khoản vay" value={name} onChangeText={setName} placeholder="Vay mua nhà, vay mua xe…" autoFocus={!item} />
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
            if (n >= 1 && n <= 600) changeMonths(n);
          }}
        />
        <Txt v="small">
          Từ {monthYear(start)} đến {monthYear(end)} · {months} kỳ trả
        </Txt>
      </View>

      {periods.map((p, i) => {
        const last = i === periods.length - 1;
        const from = i === 0 ? start : p.from;
        const to = last ? end : shiftMonth(periods[i + 1].from, -1);
        const sum = summary[i];
        const nextFrom = periods[i + 2]?.from;
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
                label="Từ tháng"
                value={from}
                // The first period starts with the first payment; later ones between their neighbours.
                min={i === 0 ? undefined : shiftMonth(i === 1 ? start : periods[i - 1].from, 1)}
                max={i === 0 ? undefined : last ? end : shiftMonth(periods[i + 1].from, -1)}
                onChange={(m) => {
                  if (i === 0) changeStart(m);
                  else {
                    // Moving where this period starts changes what it starts from.
                    update(p.key, { from: m });
                    termsChangedFrom(i);
                  }
                }}
              />
              <MonthField
                label="Đến tháng"
                value={to}
                min={from}
                // The last period's end is the end of the loan; otherwise the next period moves with it.
                max={last ? shiftMonth(start, 599) : shiftMonth(nextFrom ?? shiftMonth(end, 1), -2)}
                onChange={(m) => {
                  if (last) changeMonths(monthsBetweenKeys(start, m) + 1);
                  else {
                    // The next period starts the month after; what it starts from changes.
                    update(periods[i + 1].key, { from: shiftMonth(m, 1) });
                    termsChangedFrom(i + 1);
                  }
                }}
              />
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
                <AmountField
                  key={`pp${key}-${p.key}`}
                  label="Số tiền trả trước trong giai đoạn này"
                  value={p.prepayment}
                  onChange={(n) => {
                    update(p.key, { prepayment: Math.max(0, n) });
                    termsChangedFrom(i);
                  }}
                />
                {sum ? (
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
          </View>
        );
      })}

      <Btn label="Thêm giai đoạn (đổi lãi suất, trả trước)" icon="add" kind="ghost" onPress={addPeriod} disabled={!valid} />
      {note ? <Txt v="small" color={c.warning}>{note}</Txt> : null}

      {valid ? (
        <View style={{ backgroundColor: c.cardAlt, borderRadius: 12, padding: 12, gap: 6 }}>
          <Row>
            <Txt v="small">Tổng lãi cả khoản vay</Txt>
            <Txt v="small">{money(loanTotalInterest(draft))}</Txt>
          </Row>
          {paid > 0 && paid < months ? (
            <Row>
              <Txt v="small">
                Đã trả {paid}/{months} kỳ · dư nợ hiện tại
              </Txt>
              <Txt v="small">{money(loanBalance(draft, paid))}</Txt>
            </Row>
          ) : null}
          <Row>
            <Txt v="small">Kỳ cuối</Txt>
            <Txt v="small">{monthYear(end)}</Txt>
          </Row>
        </View>
      ) : null}

      {item ? (
        <Btn
          label="Xoá khoản vay"
          kind="danger"
          icon="trash-outline"
          onPress={() =>
            confirmDelete(`khoản vay "${item.name}"`, () => {
              remove(item.id);
              onClose();
            })
          }
        />
      ) : null}
    </Sheet>
  );
}

interface PlanRow {
  id?: string;
  note: string;
  amount: number;
  key: number;
}

/**
 * The credit-card plan per statement cycle, as several items with a note each.
 * Saved as fixed expenses of kind "credit" (the note is the item's name).
 */
export function CreditPlanSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c } = useUi();
  const money = useMoney();
  const fixed = useStore((s) => s.fixed);
  const upsertFixed = useStore((s) => s.upsertFixed);
  const deleteFixed = useStore((s) => s.deleteFixed);
  const [rows, setRows] = useState<PlanRow[]>([]);
  const nextKey = React.useRef(0);

  useEffect(() => {
    if (!visible) return;
    const items = fixed.filter((f) => f.direction === 'out' && f.kind === 'credit');
    const loaded = items.map((f) => ({ id: f.id, note: f.name, amount: f.amount, key: nextKey.current++ }));
    setRows(loaded.length ? loaded : [{ note: '', amount: 0, key: nextKey.current++ }]);
    // Only when the sheet opens: edits in progress must not be reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const update = (key: number, patch: Partial<PlanRow>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const totalAmount = rows.reduce((s, r) => s + (r.amount > 0 ? r.amount : 0), 0);
  const notes = rows.filter((r) => r.amount > 0 && r.note.trim()).map((r) => r.note.trim()).join(', ');
  const valid = rows.every((r) => r.amount <= 0 || r.note.trim());

  const save = () => {
    const keep = new Set<string>();
    for (const r of rows) {
      if (!(r.amount > 0)) continue;
      const saved = upsertFixed({ id: r.id, name: r.note.trim(), amount: r.amount, direction: 'out', kind: 'credit' });
      keep.add(saved.id);
    }
    for (const f of fixed) if (f.direction === 'out' && f.kind === 'credit' && !keep.has(f.id)) deleteFixed(f.id);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Dự chi tín dụng mỗi kỳ" footer={<Btn label="Lưu" icon="checkmark" disabled={!valid} onPress={save} />}>
      <Txt v="small">Số tiền dự định quẹt thẻ mỗi kỳ sao kê, chia theo khoản. Finy so tổng dự chi với số thực xài và báo khi vượt.</Txt>
      {rows.map((r, i) => (
        <View key={r.key} style={{ gap: 8, backgroundColor: c.cardAlt, borderRadius: 12, padding: 12 }}>
          <Row>
            <Txt v="label">Khoản {i + 1}</Txt>
            <IconBtn name="trash-outline" size={18} color={c.negative} onPress={() => setRows((cur) => cur.filter((x) => x.key !== r.key))} label={`Xoá khoản ${i + 1}`} />
          </Row>
          <Field label="Ghi chú" value={r.note} onChangeText={(t) => update(r.key, { note: t })} placeholder="Ăn uống, xăng xe, mua sắm…" />
          <AmountField label="Số tiền mỗi kỳ" value={r.amount} onChange={(n) => update(r.key, { amount: n })} />
          {r.amount > 0 && !r.note.trim() ? <Txt v="small" color={c.warning}>Nhập ghi chú cho khoản này.</Txt> : null}
        </View>
      ))}
      <Btn label="Thêm khoản dự chi" icon="add" kind="ghost" onPress={() => setRows((cur) => [...cur, { note: '', amount: 0, key: nextKey.current++ }])} />
      <View style={{ backgroundColor: c.cardAlt, borderRadius: 12, padding: 12, gap: 4 }}>
        <Row>
          <Txt v="label">Tổng dự chi mỗi kỳ</Txt>
          <Txt v="title">{money(totalAmount)}</Txt>
        </Row>
        {notes ? <Txt v="small">{notes}</Txt> : null}
      </View>
    </Sheet>
  );
}
