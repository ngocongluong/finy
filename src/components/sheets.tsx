// Add / edit forms, shared by several screens.
import React, { useEffect, useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { dateKey, dayLabel } from '../lib/format';
import { useStore } from '../lib/store';
import type { Account, AccountKind, BudgetItem, BudgetKind, Tx } from '../lib/types';
import { AmountField, Btn, Field, IconBtn, Row, Segmented, Sheet, Txt, useUi } from './ui';

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
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setAmount(tx?.amount ?? 0);
    setNote(tx?.note ?? '');
    setDirection(tx?.direction ?? 'out');
    setDate(tx?.date ?? dateKey());
    setCounts(tx?.countsDaily ?? true);
    setKey((k) => k + 1); // remount the amount field with the new initial value
  }, [visible, tx]);

  const today = dateKey();
  const save = async () => {
    if (!(amount > 0)) return;
    const countsDaily = direction === 'out' && counts;
    if (tx) {
      const [y, m, d] = date.split('-').map(Number);
      const old = new Date(tx.ts);
      const ts = date === tx.date ? tx.ts : new Date(y, m - 1, d, old.getHours(), old.getMinutes()).getTime();
      await updateTx({ ...tx, amount, note: note.trim(), direction, date, ts, countsDaily });
    } else {
      await addTx({ amount, note: note.trim() || (direction === 'out' ? 'Chi tiêu' : 'Thu'), direction, date, source: 'manual', countsDaily });
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

const KIND_OPTIONS: { value: BudgetKind; label: string }[] = [
  { value: 'expense', label: 'Chi tiêu' },
  { value: 'debt', label: 'Trả nợ' },
  { value: 'saving', label: 'Để dành' },
];

export function ItemSheet({ visible, onClose, month, item }: { visible: boolean; onClose: () => void; month: string; item?: BudgetItem | null }) {
  const upsertItem = useStore((s) => s.upsertItem);
  const deleteItem = useStore((s) => s.deleteItem);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState(0);
  const [kind, setKind] = useState<BudgetKind>('expense');
  const [daily, setDaily] = useState(false);
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setName(item?.name ?? '');
    setAmount(item?.amount ?? 0);
    setKind(item?.kind ?? 'expense');
    setDaily(!!item?.daily);
    setKey((k) => k + 1);
  }, [visible, item]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={item ? 'Sửa mục' : 'Thêm mục'}
      footer={
        <Btn
          label="Lưu"
          icon="checkmark"
          disabled={!name.trim()}
          onPress={() => {
            upsertItem(month, { id: item?.id, name, amount, kind, daily: kind === 'expense' && daily });
            onClose();
          }}
        />
      }>
      <Field label="Tên mục" value={name} onChangeText={setName} placeholder="Điện nước, học phí…" autoFocus={!item} />
      <AmountField key={key} label="Số tiền mỗi tháng" value={amount} onChange={setAmount} />
      <Segmented value={kind} onChange={setKind} options={KIND_OPTIONS} />
      {kind === 'expense' ? (
        <Toggle label="Đây là quỹ chi tiêu hằng ngày" hint="Finy chia quỹ này theo ngày để theo dõi tiền tiêu vặt." value={daily} onChange={setDaily} />
      ) : null}
      {item ? (
        <Btn
          label="Xoá mục"
          kind="danger"
          icon="trash-outline"
          onPress={() =>
            confirmDelete(`mục "${item.name}"`, () => {
              deleteItem(month, item.id);
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
