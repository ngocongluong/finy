import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { LineChart } from '../../components/charts';
import { NumberSheet } from '../../components/sheets';
import { Amount, AmountField, Btn, Card, Chip, Field, Row, Screen, Segmented, Sheet, Txt, useMoney, useUi } from '../../components/ui';
import { fmtVND, monthKey, uid } from '../../lib/format';
import { useBudget } from '../../lib/hooks';
import { projectAll, resolvePlan, SCENARIOS, yearReaching } from '../../lib/plan';
import { useStore } from '../../lib/store';
import type { PlanDebt, PlanGoal, PlanParams } from '../../lib/types';

type NumKey = 'startNetWorth' | 'monthlyIncome' | 'monthlyExpense' | 'incomeGrowthPct' | 'inflationPct' | 'returnPct';

const FIELDS: { key: NumKey; label: string; money: boolean; auto: boolean; hint: string }[] = [
  { key: 'startNetWorth', label: 'Tài sản ròng hiện tại', money: true, auto: true, hint: 'Mặc định lấy từ “Tổng tiền hiện có”.' },
  { key: 'monthlyIncome', label: 'Thu nhập mỗi tháng', money: true, auto: true, hint: 'Mặc định lấy tổng thu cố định hàng tháng.' },
  { key: 'monthlyExpense', label: 'Chi tiêu mỗi tháng', money: true, auto: true, hint: 'Không gồm trả nợ vay. Mặc định lấy tổng chi cố định hàng tháng.' },
  { key: 'incomeGrowthPct', label: 'Thu nhập tăng mỗi năm (%)', money: false, auto: false, hint: 'Ví dụ 5 = tăng 5% mỗi năm.' },
  { key: 'inflationPct', label: 'Lạm phát (%/năm)', money: false, auto: false, hint: 'Chi tiêu tăng theo lạm phát mỗi năm.' },
  { key: 'returnPct', label: 'Lãi tiết kiệm / đầu tư (%/năm)', money: false, auto: false, hint: 'Lợi nhuận kỳ vọng trên số tiền để dành.' },
];

const pct = (n: number) => `${String(n).replace('.', ',')}%`;

function DebtSheet({ debt, onClose, onSave, onDelete }: { debt: PlanDebt | null | undefined; onClose: () => void; onSave: (d: PlanDebt) => void; onDelete: (id: string) => void }) {
  const [name, setName] = useState('');
  const [balance, setBalance] = useState(0);
  const [payment, setPayment] = useState(0);
  const [rate, setRate] = useState('0');
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (debt === undefined) return;
    setName(debt?.name ?? '');
    setBalance(debt?.balance ?? 0);
    setPayment(debt?.monthlyPayment ?? 0);
    setRate(String(debt?.ratePct ?? 0).replace('.', ','));
    setKey((k) => k + 1);
  }, [debt]);
  const ratePct = parseFloat(rate.replace(',', '.'));
  return (
    <Sheet
      visible={debt !== undefined}
      onClose={onClose}
      title={debt ? 'Sửa khoản vay' : 'Thêm khoản vay'}
      footer={
        <Btn
          label="Lưu"
          icon="checkmark"
          disabled={!name.trim() || !Number.isFinite(ratePct)}
          onPress={() => {
            onSave({ id: debt?.id ?? uid(), name: name.trim(), balance: balance > 0 ? balance : null, monthlyPayment: payment, ratePct });
            onClose();
          }}
        />
      }>
      <Field label="Tên khoản vay" value={name} onChangeText={setName} placeholder="Vay mua nhà…" />
      <AmountField key={`b${key}`} label="Dư nợ còn lại" value={balance} onChange={setBalance} />
      <Txt v="small">Để 0 nếu chưa rõ dư nợ: Finy sẽ coi đây là khoản trả kéo dài suốt kế hoạch.</Txt>
      <AmountField key={`p${key}`} label="Trả mỗi tháng" value={payment} onChange={setPayment} />
      <Field label="Lãi suất (%/năm)" value={rate} onChangeText={setRate} />
      {debt ? <Btn label="Xoá khoản vay" kind="danger" icon="trash-outline" onPress={() => { onDelete(debt.id); onClose(); }} /> : null}
    </Sheet>
  );
}

function GoalSheet({ goal, maxYear, onClose, onSave, onDelete }: { goal: PlanGoal | null | undefined; maxYear: number; onClose: () => void; onSave: (g: PlanGoal) => void; onDelete: (id: string) => void }) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState(0);
  const [year, setYear] = useState(1);
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (goal === undefined) return;
    setName(goal?.name ?? '');
    setAmount(goal?.amount ?? 0);
    setYear(Math.min(maxYear, goal?.year ?? 1));
    setKey((k) => k + 1);
  }, [goal, maxYear]);
  const thisYear = new Date().getFullYear();
  return (
    <Sheet
      visible={goal !== undefined}
      onClose={onClose}
      title={goal ? 'Sửa khoản chi lớn' : 'Thêm khoản chi lớn'}
      footer={
        <Btn
          label="Lưu"
          icon="checkmark"
          disabled={!name.trim() || !(amount > 0)}
          onPress={() => {
            onSave({ id: goal?.id ?? uid(), name: name.trim(), amount, year });
            onClose();
          }}
        />
      }>
      <Field label="Tên" value={name} onChangeText={setName} placeholder="Mua xe, sửa nhà, du học…" />
      <AmountField key={key} label="Số tiền" value={amount} onChange={setAmount} />
      <Txt v="label">Vào năm</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {Array.from({ length: maxYear }, (_, i) => i + 1).map((y) => (
          <Chip key={y} label={String(thisYear + y)} active={year === y} onPress={() => setYear(y)} />
        ))}
      </View>
      {goal ? <Btn label="Xoá" kind="danger" icon="trash-outline" onPress={() => { onDelete(goal.id); onClose(); }} /> : null}
    </Sheet>
  );
}

export default function Plan() {
  const { c, gap } = useUi();
  const money = useMoney();
  const plan = useStore((s) => s.plan);
  const { budget } = useBudget();
  const accounts = useStore((s) => s.accounts);
  const setPlan = useStore((s) => s.setPlan);
  const setPendingPrompt = useStore((s) => s.setPendingPrompt);

  const [real, setReal] = useState<'nominal' | 'real'>('nominal');
  const [field, setField] = useState<NumKey | null>(null);
  const [debt, setDebt] = useState<PlanDebt | null | undefined>(undefined);
  const [goal, setGoal] = useState<PlanGoal | null | undefined>(undefined);

  const cash = useStore((s) => s.cash);
  const inputs = useMemo(() => resolvePlan(plan, budget, accounts, monthKey(), cash), [plan, budget, accounts, cash]);
  const all = useMemo(() => projectAll(inputs), [inputs]);
  const base = all.base;
  const last = base.rows[base.rows.length - 1];
  const thisYear = new Date().getFullYear();
  const pick = (r: (typeof base.rows)[number]) => (real === 'real' ? r.realNetWorth : r.netWorth);

  const monthlySaving = inputs.monthlyIncome - inputs.monthlyExpense - inputs.debts.reduce((s, d) => s + d.monthlyPayment, 0);
  const targets = [1e9, 2e9, 5e9, 1e10, 2e10, 5e10, 1e11].filter((t) => t > inputs.startNetWorth).slice(0, 2);
  const editing = FIELDS.find((f) => f.key === field);

  // A loan's schedule is derived data: never stored with the plan's own list.
  const saveDebts = (next: PlanDebt[]) => setPlan({ debts: next.map(({ schedule: _schedule, ...d }) => d) });

  return (
    <Screen title="Kế hoạch dài hạn">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {[5, 6, 7, 8, 9, 10].map((y) => (
          <Chip key={y} label={`${y} năm`} active={inputs.years === y} onPress={() => setPlan({ years: y })} />
        ))}
      </View>

      <Card eye={'plan.chart'} style={{ gap }}>
        <View>
          <Txt v="label">Tài sản ròng năm {thisYear + last.year} (kịch bản cơ sở)</Txt>
          <Amount v="hero" value={pick(last)} color={pick(last) < 0 ? c.negative : c.text} />
        </View>
        <Segmented value={real} onChange={setReal} options={[{ value: 'nominal', label: 'Số danh nghĩa' }, { value: 'real', label: 'Theo giá hôm nay' }]} />
        <LineChart
          emphasis="base"
          xLabels={base.rows.map((r) => (r.year === 0 ? 'Nay' : `’${String(thisYear + r.year).slice(2)}`))}
          series={SCENARIOS.map((s) => ({ id: s.id, label: s.label, values: all[s.id].rows.map(pick) }))}
        />
        <Txt v="small">Thận trọng: lãi −2, thu nhập tăng −2, lạm phát +1 điểm %. Lạc quan: lãi +2, thu nhập tăng +2 điểm %.</Txt>
      </Card>

      <Card eye={'plan.notes'} style={{ gap: 10 }}>
        <Txt v="heading">Điểm đáng chú ý</Txt>
        <Row>
          <Txt v="label">Để dành được mỗi tháng (hiện tại)</Txt>
          <Amount value={monthlySaving} color={monthlySaving < 0 ? c.negative : c.positive} signed />
        </Row>
        {base.shortfallMonth !== null ? (
          <Txt color={c.negative}>
            Cảnh báo: với giả định này, tiền sẽ âm vào khoảng tháng {((new Date().getMonth() + base.shortfallMonth) % 12) + 1}/{thisYear + Math.floor((new Date().getMonth() + base.shortfallMonth) / 12)}.
          </Txt>
        ) : null}
        {base.debtFreeMonth !== null ? (
          <Row>
            <Txt v="label">Trả hết các khoản vay đã nhập dư nợ</Txt>
            <Txt v="num">sau {Math.ceil(base.debtFreeMonth / 12)} năm ({base.debtFreeMonth} tháng)</Txt>
          </Row>
        ) : null}
        {targets.map((t) => {
          const y = yearReaching(base, t);
          return (
            <Row key={t}>
              <Txt v="label">Đạt {fmtVND(t, 'compact')}</Txt>
              <Txt v="num">{y ? `năm ${thisYear + y}` : `chưa đạt trong ${inputs.years} năm`}</Txt>
            </Row>
          );
        })}
        <Btn
          label="Nhờ Finy phân tích kế hoạch này"
          icon="sparkles"
          onPress={() => {
            setPendingPrompt(
              `Hãy phân tích kế hoạch tài chính ${inputs.years} năm của tôi: tình hình sẽ thế nào, rủi ro lớn nhất ở đâu, và 3 việc tôi nên làm ngay để kết quả tốt hơn.`,
            );
            router.navigate('/chat');
          }}
        />
      </Card>

      <Card eye={'plan.assumptions'} style={{ gap: 2 }}>
        <Txt v="heading" style={{ marginBottom: 6 }}>Giả định</Txt>
        {FIELDS.map((f) => {
          const auto = f.auto && plan[f.key as keyof PlanParams] === null;
          return (
            <Pressable key={f.key} onPress={() => setField(f.key)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, minHeight: 50, justifyContent: 'center' })}>
              <Row>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Txt>{f.label}</Txt>
                  {auto ? <Txt v="small">tự lấy theo ngân sách</Txt> : null}
                </View>
                <Txt v="num">{f.money ? money(inputs[f.key]) : pct(inputs[f.key])}</Txt>
              </Row>
            </Pressable>
          );
        })}
      </Card>

      <Card eye={'plan.debts'} style={{ gap: 2 }}>
        <Row style={{ marginBottom: 6 }}>
          <Txt v="heading">Khoản vay</Txt>
          {plan.debts !== null ? (
            <Pressable onPress={() => setPlan({ debts: null })} hitSlop={8}>
              <Txt v="small" color={c.accent}>Lấy lại theo ngân sách</Txt>
            </Pressable>
          ) : (
            <Txt v="small">theo các khoản “Trả nợ vay” cố định</Txt>
          )}
        </Row>
        {inputs.debts.length === 0 ? <Txt v="label">Không có khoản vay nào.</Txt> : null}
        {inputs.debts.map((d) => (
          <Pressable key={d.id} onPress={() => setDebt(d)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, minHeight: 52, justifyContent: 'center' })}>
            <Row>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Txt numberOfLines={1}>{d.name}</Txt>
                <Txt v="small">{d.balance === null ? 'chưa nhập dư nợ — chạm để nhập' : `dư nợ ${money(d.balance)} · lãi ${pct(d.ratePct)}`}</Txt>
              </View>
              <Txt v="num">{money(d.monthlyPayment)}/tháng</Txt>
            </Row>
          </Pressable>
        ))}
        <Btn label="Thêm khoản vay" icon="add" kind="ghost" onPress={() => setDebt(null)} style={{ marginTop: 8 }} />
      </Card>

      <Card eye={'plan.goals'} style={{ gap: 2 }}>
        <Txt v="heading" style={{ marginBottom: 6 }}>Khoản chi lớn dự kiến</Txt>
        {plan.goals.length === 0 ? <Txt v="label">Chưa có. Thêm các khoản như mua xe, sửa nhà, học phí lớn để kế hoạch sát thực tế hơn.</Txt> : null}
        {plan.goals.map((g) => (
          <Pressable key={g.id} onPress={() => setGoal(g)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, minHeight: 50, justifyContent: 'center' })}>
            <Row>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Txt numberOfLines={1}>{g.name}</Txt>
                <Txt v="small">năm {thisYear + g.year}</Txt>
              </View>
              <Amount value={g.amount} />
            </Row>
          </Pressable>
        ))}
        <Btn label="Thêm khoản chi lớn" icon="add" kind="ghost" onPress={() => setGoal(null)} style={{ marginTop: 8 }} />
      </Card>

      <Card eye={'plan.table'} style={{ gap: 8 }}>
        <Txt v="heading">Từng năm (kịch bản cơ sở)</Txt>
        <Row>
          <Txt v="small" style={{ width: 48 }}>Năm</Txt>
          <Txt v="small" style={{ flex: 1, textAlign: 'right' }}>Để dành trong năm</Txt>
          <Txt v="small" style={{ flex: 1, textAlign: 'right' }}>Tài sản ròng</Txt>
        </Row>
        {base.rows.slice(1).map((r) => (
          <Row key={r.year}>
            <Txt v="label" style={{ width: 48 }}>{thisYear + r.year}</Txt>
            <Txt v="num" style={{ flex: 1, textAlign: 'right' }}>{money(r.savedThisYear, true)}</Txt>
            <Txt v="num" style={{ flex: 1, textAlign: 'right' }}>{money(pick(r), true)}</Txt>
          </Row>
        ))}
      </Card>

      {editing ? (
        <NumberSheet
          visible
          onClose={() => setField(null)}
          title={editing.label}
          label={editing.label}
          hint={editing.hint}
          money={editing.money}
          allowAuto={editing.auto}
          value={inputs[editing.key]}
          onSave={(n) => setPlan({ [editing.key]: n === null && !editing.auto ? 0 : n } as Partial<PlanParams>)}
        />
      ) : null}
      <DebtSheet
        debt={debt}
        onClose={() => setDebt(undefined)}
        onSave={(d) => saveDebts(inputs.debts.some((x) => x.id === d.id) ? inputs.debts.map((x) => (x.id === d.id ? d : x)) : [...inputs.debts, d])}
        onDelete={(id) => saveDebts(inputs.debts.filter((x) => x.id !== id))}
      />
      <GoalSheet
        goal={goal}
        maxYear={inputs.years}
        onClose={() => setGoal(undefined)}
        onSave={(g) => setPlan({ goals: plan.goals.some((x) => x.id === g.id) ? plan.goals.map((x) => (x.id === g.id ? g : x)) : [...plan.goals, g] })}
        onDelete={(id) => setPlan({ goals: plan.goals.filter((x) => x.id !== id) })}
      />
    </Screen>
  );
}
