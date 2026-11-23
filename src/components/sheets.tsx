// Add / edit forms, shared by several screens.
import React, { useEffect, useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { annuityPayment, instalmentAmount, loanBalance, loanPaidBefore, loanPayment, loanTotalInterest } from '../lib/finance';
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

/**
 * Add or edit a bank loan. The monthly payment is calculated from amount,
 * rate and term (equal payments of principal + interest) and follows every
 * change; the bank's own figure can be entered when it differs, and is
 * dropped as soon as amount, rate or term change.
 */
export function LoanSheet({ visible, onClose, item }: { visible: boolean; onClose: () => void; item?: Loan | null }) {
  const { c } = useUi();
  const money = useMoney();
  const upsert = useStore((s) => s.upsertLoan);
  const remove = useStore((s) => s.deleteLoan);
  const [name, setName] = useState('');
  const [principal, setPrincipal] = useState(0);
  const [rateText, setRateText] = useState('');
  const [months, setMonths] = useState(360);
  const [monthsText, setMonthsText] = useState('360');
  const [start, setStart] = useState(monthKey());
  const [override, setOverride] = useState<number | null>(null);
  const [useOverride, setUseOverride] = useState(false);
  const [key, setKey] = useState(0);
  const [overrideKey, setOverrideKey] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(item?.name ?? '');
    setPrincipal(item?.principal ?? 0);
    setRateText(item ? String(item.ratePct).replace('.', ',') : '');
    setMonths(item?.months ?? 360);
    setMonthsText(String(item?.months ?? 360));
    setStart(item?.startMonth ?? monthKey());
    setOverride(item?.paymentOverride ?? null);
    setUseOverride(item?.paymentOverride != null);
    setNote(null);
    setKey((k) => k + 1);
    setOverrideKey((k) => k + 1);
  }, [visible, item]);

  const ratePct = parseFloat(rateText.replace(',', '.'));
  // Changing amount, rate or term means a new calculation: the bank's old figure no longer applies.
  const termsChanged = () => {
    if (useOverride) {
      setUseOverride(false);
      setOverride(null);
      setNote('Đã bỏ số trả theo ngân hàng vì thông tin khoản vay thay đổi.');
    }
  };

  const valid = name.trim() && principal > 0 && Number.isFinite(ratePct) && ratePct >= 0 && months >= 1;
  const draft: Loan = {
    id: item?.id ?? '',
    name,
    principal,
    ratePct: Number.isFinite(ratePct) ? ratePct : 0,
    months,
    startMonth: start,
    paymentOverride: useOverride && override ? override : null,
  };
  const calculated = valid ? annuityPayment(principal, draft.ratePct, months) : 0;
  const payment = valid ? loanPayment(draft) : 0;
  const paid = loanPaidBefore(draft, monthKey());
  const end = shiftMonth(start, months - 1);

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
            upsert({ id: item?.id, name, principal, ratePct: draft.ratePct, months, startMonth: start, paymentOverride: draft.paymentOverride });
            onClose();
          }}
        />
      }>
      <Field label="Tên khoản vay" value={name} onChangeText={setName} placeholder="Vay mua nhà, vay mua xe…" autoFocus={!item} />
      <AmountField
        key={`p${key}`}
        label="Số tiền vay"
        value={principal}
        onChange={(n) => {
          setPrincipal(n);
          termsChanged();
        }}
      />
      <Field
        label="Lãi suất (%/năm)"
        value={rateText}
        placeholder="6"
        onChangeText={(t) => {
          setRateText(t.replace(/[^0-9.,]/g, ''));
          termsChanged();
        }}
      />
      <View style={{ gap: 8 }}>
        <Txt v="label">Thời hạn vay</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {LOAN_YEARS.map((y) => (
            <Chip
              key={y}
              label={`${y} năm`}
              active={months === y * 12}
              onPress={() => {
                setMonths(y * 12);
                setMonthsText(String(y * 12));
                termsChanged();
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
            if (n >= 1 && n <= 600) {
              setMonths(n);
              termsChanged();
            }
          }}
        />
      </View>
      <View style={{ gap: 6 }}>
        <Txt v="label">Tháng trả kỳ đầu tiên</Txt>
        <Row>
          <IconBtn name="play-back" onPress={() => setStart(shiftMonth(start, -12))} label="Lùi 1 năm" />
          <IconBtn name="chevron-back" onPress={() => setStart(shiftMonth(start, -1))} label="Lùi 1 tháng" />
          <Txt v="heading">{monthLabel(start)}</Txt>
          <IconBtn name="chevron-forward" onPress={() => setStart(shiftMonth(start, 1))} label="Tới 1 tháng" />
          <IconBtn name="play-forward" onPress={() => setStart(shiftMonth(start, 12))} label="Tới 1 năm" />
        </Row>
      </View>

      {valid ? (
        <View style={{ backgroundColor: c.cardAlt, borderRadius: 12, padding: 12, gap: 6 }}>
          <Row>
            <Txt v="label">Trả mỗi tháng</Txt>
            <Txt v="title">{money(payment)}</Txt>
          </Row>
          {useOverride && override ? <Txt v="small">Theo ngân hàng. Tính theo trả góp đều: {money(calculated)}.</Txt> : <Txt v="small">Gốc + lãi chia đều mỗi tháng.</Txt>}
          <Row>
            <Txt v="small">Tổng lãi cả khoản vay</Txt>
            <Txt v="small">{money(loanTotalInterest(draft))}</Txt>
          </Row>
          <Row>
            <Txt v="small">Kỳ cuối</Txt>
            <Txt v="small">{monthLabel(end)}</Txt>
          </Row>
          {paid > 0 ? (
            <Row>
              <Txt v="small">Đã trả {Math.min(paid, months)}/{months} kỳ · dư nợ còn</Txt>
              <Txt v="small">{money(loanBalance(draft, paid))}</Txt>
            </Row>
          ) : null}
        </View>
      ) : null}

      <Toggle
        label="Ngân hàng tính số trả khác"
        hint="Bật nếu số trả thực tế khác số tính ở trên (ngân hàng tính lãi theo ngày, có phí, bảo hiểm…)."
        value={useOverride}
        onChange={(v) => {
          setUseOverride(v);
          setNote(null);
          if (v && !override) {
            setOverride(calculated || null);
            setOverrideKey((k) => k + 1);
          }
        }}
      />
      {useOverride ? <AmountField key={`o${overrideKey}`} label="Số trả mỗi tháng theo ngân hàng" value={override ?? 0} onChange={(n) => setOverride(n || null)} /> : null}
      {note ? <Txt v="small" color={c.warning}>{note}</Txt> : null}

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
