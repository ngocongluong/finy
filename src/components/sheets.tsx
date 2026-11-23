// Add / edit forms, shared by several screens.
import React, { useEffect, useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { dateKey, dayLabel, fmtVND, monthKey, monthShort, shiftMonth } from '../lib/format';
import { useStore } from '../lib/store';
import type { Account, AccountKind, FixedItem, OneOff, Tx } from '../lib/types';
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
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setName(item?.name ?? (initialKind === 'credit' ? 'Thẻ tín dụng' : ''));
    setAmount(item?.amount ?? 0);
    setKind(item?.kind ?? initialKind);
    setDaily(!!item?.daily);
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
            upsertFixed({ id: item?.id, name, amount, direction, kind: out ? kind : undefined, daily: out && kind === 'expense' && daily });
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
            { value: 'credit', label: 'Tín dụng' },
          ]}
        />
      ) : null}
      {out && kind === 'expense' ? (
        <Toggle label="Đây là quỹ chi tiêu hằng ngày" hint="Finy chia quỹ này theo ngày để theo dõi tiền tiêu vặt." value={daily} onChange={setDaily} />
      ) : null}
      {out && kind === 'credit' ? (
        <Txt v="small">Số tiền dự định quẹt thẻ tín dụng mỗi kỳ sao kê. Finy so với số đã quẹt lấy từ email HSBC và báo khi vượt. Chỉ một khoản được là dự chi tín dụng.</Txt>
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
