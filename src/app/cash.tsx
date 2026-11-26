// Cash: note down what is paid in cash, fast. Notes only - nothing here is
// counted in the cash-flow table, which already sets a fixed amount aside for
// cash. The month can be compared with that fixed amount.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { CashBudgetSheet, CashNoteSheet, shiftDate } from '../components/sheets';
import { Amount, AmountField, Btn, Card, Chip, Empty, Field, IconBtn, Meter, Row, Screen, Txt, useKeyboardSpace, useMoney, useUi } from '../components/ui';
import { cashMonth, fixedActive, fixedAmount, frequentNotes } from '../lib/finance';
import { dateKey, dayLabel, fmtTime, monthKey, monthLabel, shiftMonth } from '../lib/format';
import { useStore } from '../lib/store';
import type { CashNote } from '../lib/types';

/** What a note without words is shown as. */
const NO_NOTE = 'Chi tiền mặt';

export default function Cash() {
  const { c, pad, gap } = useUi();
  const money = useMoney();
  const kb = useKeyboardSpace('cash');
  const notes = useStore((s) => s.cashNotes);
  const addCashNote = useStore((s) => s.addCashNote);
  const fixed = useStore((s) => s.fixed);
  const overrides = useStore((s) => s.overrides);
  const budgetId = useStore((s) => s.settings.cashBudgetId ?? null);

  const today = dateKey();
  const thisMonth = monthKey();
  const [month, setMonth] = useState(thisMonth);
  // The entry form: cleared (and the amount focused again) after every save.
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(today);
  const [formKey, setFormKey] = useState(0);
  const [saved, setSaved] = useState<CashNote | null>(null);
  const [edit, setEdit] = useState<{ open: boolean; item: CashNote | null }>({ open: false, item: null });
  const [budgetOpen, setBudgetOpen] = useState(false);

  const data = useMemo(() => cashMonth(notes, month), [notes, month]);
  const suggestions = useMemo(() => frequentNotes(notes), [notes]);
  // The fixed expense set aside for cash, in the month shown.
  const item = fixed.find((f) => f.id === budgetId && f.direction === 'out');
  const allowance = item && fixedActive(item, month) ? fixedAmount({ overrides }, item, month) : null;
  const left = allowance !== null ? allowance - data.total : 0;

  const save = () => {
    if (!(amount > 0)) return;
    const n = addCashNote({ amount, note, date });
    setSaved(n);
    setAmount(0);
    setNote('');
    setFormKey((k) => k + 1);
    setMonth(n.date.slice(0, 7));
  };

  return (
    <Screen
      title="Tiền mặt"
      eye="cash.list"
      scroll={false}
      right={<IconBtn name="close" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} label="Đóng" />}>
      {/* The page ends at the keyboard, so the form can always be scrolled into view while typing. */}
      <Animated.View ref={kb.ref} onLayout={kb.onLayout} collapsable={false} style={[{ flex: 1 }, kb.style]}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: pad, paddingBottom: 28, gap }}>
          {/* ---- Ghi nhanh ---- */}
          <Card style={{ gap: 12 }}>
            <AmountField key={formKey} label="Số tiền chi" value={amount} onChange={setAmount} autoFocus />
            {suggestions.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {suggestions.map((s) => (
                  <Chip key={s} label={s} active={note === s} onPress={() => setNote(note === s ? '' : s)} />
                ))}
              </View>
            ) : null}
            <Field label="Ghi chú" value={note} onChangeText={setNote} placeholder="Ăn sáng, gửi xe, chợ…" />
            <Row style={{ gap: 8 }}>
              <IconBtn name="chevron-back" onPress={() => setDate(shiftDate(date, -1))} label="Ngày trước" />
              <Txt v="label" style={{ flex: 1, textAlign: 'center' }} numberOfLines={1}>
                {dayLabel(date, today)}
              </Txt>
              <IconBtn name="chevron-forward" onPress={() => date < today && setDate(shiftDate(date, 1))} label="Ngày sau" />
              <Btn label="Ghi lại" icon="checkmark" onPress={save} disabled={!(amount > 0)} style={{ flex: 1.4 }} />
            </Row>
            {saved ? (
              <Row style={{ gap: 8, justifyContent: 'flex-start' }}>
                <Ionicons name="checkmark-circle" size={18} color={c.positive} />
                <Txt v="small" color={c.positive} style={{ flex: 1 }} numberOfLines={1}>
                  Đã ghi {money(saved.amount)} · {saved.note || NO_NOTE}
                  {saved.date !== today ? ` · ${dayLabel(saved.date, today).toLowerCase()}` : ''}
                </Txt>
              </Row>
            ) : null}
          </Card>

          {/* ---- Tháng ---- */}
          <Card style={{ gap: 10 }}>
            <Row>
              <IconBtn name="chevron-back" onPress={() => setMonth(shiftMonth(month, -1))} label="Tháng trước" />
              <Txt v="heading">{monthLabel(month)}</Txt>
              <IconBtn name="chevron-forward" onPress={() => month < thisMonth && setMonth(shiftMonth(month, 1))} label="Tháng sau" />
            </Row>
            <Row style={{ gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Txt v="label">Đã chi tiền mặt</Txt>
                <Txt v="small">{data.count ? `${data.count} khoản` : 'chưa ghi khoản nào'}</Txt>
              </View>
              <Amount v="title" value={data.total} />
            </Row>
            {allowance !== null && item ? (
              <>
                <Row style={{ gap: 12 }}>
                  <Txt v="small" style={{ flex: 1 }} numberOfLines={1}>
                    Dự trù: {item.name}
                  </Txt>
                  <Amount value={allowance} color={c.muted} />
                </Row>
                <Meter ratio={allowance > 0 ? data.total / allowance : data.total > 0 ? 1 : 0} color={left < 0 ? c.negative : c.accent} />
                <Txt v="small" color={left < 0 ? c.negative : c.muted}>
                  {left < 0 ? `Vượt dự trù ${money(-left)}` : `Còn ${money(left)} trong dự trù`}
                </Txt>
              </>
            ) : item ? (
              <Txt v="small">{item.name} không áp dụng trong {monthLabel(month).toLowerCase()}.</Txt>
            ) : null}
            <Txt v="small">Chỉ để ghi chú: các khoản này không được tính vào bảng thu chi.</Txt>
            <Btn label={item ? 'Đổi khoản dự trù để so sánh' : 'So sánh với khoản dự trù tiền mặt'} icon="git-compare-outline" kind="ghost" onPress={() => setBudgetOpen(true)} />
          </Card>

          {data.days.length === 0 ? <Empty icon="cash-outline" text={`Chưa ghi khoản tiền mặt nào trong ${monthLabel(month).toLowerCase()}.`} /> : null}

          {data.days.map((d) => (
            <Card key={d.date} style={{ gap: 2 }}>
              <Row style={{ marginBottom: 6 }}>
                <Txt v="heading">{dayLabel(d.date, today)}</Txt>
                <Amount value={d.total} color={c.muted} />
              </Row>
              {d.notes.map((n) => (
                <Pressable
                  key={n.id}
                  onPress={() => setEdit({ open: true, item: n })}
                  accessibilityRole="button"
                  accessibilityHint="Sửa hoặc xoá"
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, minHeight: 48, justifyContent: 'center' })}>
                  <Row>
                    <View style={{ flex: 1, marginRight: 12 }}>
                      <Txt numberOfLines={1} color={n.note ? c.text : c.muted}>
                        {n.note || NO_NOTE}
                      </Txt>
                      <Txt v="small">{fmtTime(n.ts)}</Txt>
                    </View>
                    <Amount value={n.amount} />
                  </Row>
                </Pressable>
              ))}
            </Card>
          ))}
        </ScrollView>
      </Animated.View>
      <CashNoteSheet visible={edit.open} onClose={() => setEdit((v) => ({ ...v, open: false }))} item={edit.item} />
      <CashBudgetSheet visible={budgetOpen} onClose={() => setBudgetOpen(false)} month={month} />
    </Screen>
  );
}
