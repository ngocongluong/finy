// Charts drawn with react-native-svg. Series colours are a fixed, validated
// palette (lib/theme CHART); labels always use text colours, and every chart
// has a tap-to-read layer plus a legend when it shows more than one series.
import React, { useState } from 'react';
import { View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { fmtVND } from '../lib/format';
import { useStore } from '../lib/store';
import { CHART } from '../lib/theme';
import { Row, Txt, useUi } from './ui';

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

function useWidth() {
  const [w, setW] = useState(0);
  return { w, onLayout: (e: { nativeEvent: { layout: { width: number } } }) => setW(e.nativeEvent.layout.width) };
}

export interface LineSeries {
  id: string;
  label: string;
  values: number[];
}

/** Multi-series line chart over years. Tap or drag to read exact values. */
export function LineChart({
  series,
  xLabels,
  height = 220,
  emphasis,
}: {
  series: LineSeries[];
  xLabels: string[];
  height?: number;
  /** id of the series drawn on top and slightly thicker. */
  emphasis?: string;
}) {
  const { c, fs } = useUi();
  const hide = useStore((s) => s.hideAmounts);
  const { w, onLayout } = useWidth();
  const n = xLabels.length;
  const [sel, setSel] = useState(n - 1);
  const active = Math.min(sel, n - 1);

  const padL = 48;
  const padR = 12;
  const padT = 10;
  const padB = 24;
  const all = series.flatMap((s) => s.values);
  const lo = Math.min(0, ...all);
  const hi = niceMax(Math.max(1, ...all));
  const span = hi - lo || 1;
  const plotW = Math.max(1, w - padL - padR);
  const plotH = height - padT - padB;
  const x = (i: number) => padL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const y = (v: number) => padT + (1 - (v - lo) / span) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => lo + t * span);
  const money = (v: number) => (hide ? '•••' : fmtVND(v, 'compact'));

  const pick = (e: GestureResponderEvent) => {
    if (n < 2) return;
    const i = Math.round(((e.nativeEvent.locationX - padL) / plotW) * (n - 1));
    setSel(Math.min(n - 1, Math.max(0, i)));
  };

  const ordered = [...series].sort((a, b) => (a.id === emphasis ? 1 : 0) - (b.id === emphasis ? 1 : 0));
  const colorOf = (id: string) => CHART.series[series.findIndex((s) => s.id === id) % CHART.series.length];

  return (
    <View style={{ gap: 10 }}>
      <View onLayout={onLayout} style={{ height }} onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true} onResponderGrant={pick} onResponderMove={pick}>
        {w > 0 ? (
          <Svg width={w} height={height}>
            {ticks.map((t, i) => (
              <React.Fragment key={i}>
                <Line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke={i === 0 ? CHART.axis : CHART.grid} strokeWidth={1} />
                <SvgText x={padL - 6} y={y(t) + 4} fontSize={fs(10)} fill={c.muted} textAnchor="end">
                  {money(t)}
                </SvgText>
              </React.Fragment>
            ))}
            {xLabels.map((l, i) =>
              n <= 7 || i % 2 === 0 || i === n - 1 ? (
                <SvgText key={i} x={x(i)} y={height - 6} fontSize={fs(10)} fill={c.muted} textAnchor="middle">
                  {l}
                </SvgText>
              ) : null,
            )}
            <Line x1={x(active)} x2={x(active)} y1={padT} y2={padT + plotH} stroke={c.muted} strokeWidth={1} strokeDasharray="3 3" />
            {ordered.map((s) => (
              <Path
                key={s.id}
                d={s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
                stroke={colorOf(s.id)}
                strokeWidth={s.id === emphasis ? 3 : 2}
                strokeLinejoin="round"
                strokeLinecap="round"
                fill="none"
              />
            ))}
            {ordered.map((s) => (
              <Circle key={s.id} cx={x(active)} cy={y(s.values[active])} r={5} fill={colorOf(s.id)} stroke={c.card} strokeWidth={2} />
            ))}
          </Svg>
        ) : null}
      </View>
      {/* Legend doubling as the read-out for the selected year. */}
      <View style={{ gap: 6 }}>
        <Txt v="small">{xLabels[active]} — chạm vào biểu đồ để xem năm khác</Txt>
        {series.map((s) => (
          <Row key={s.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 14, height: 4, borderRadius: 2, backgroundColor: colorOf(s.id) }} />
              <Txt v="label" color={c.text}>
                {s.label}
              </Txt>
            </View>
            <Txt v="num">{hide ? '••••••' : fmtVND(s.values[active], 'compact')}</Txt>
          </Row>
        ))}
      </View>
    </View>
  );
}

/** Daily spending bars with the daily allowance as a reference line. */
export function SpendBars({
  data,
  allowance,
  height = 130,
}: {
  data: { date: string; spent: number }[];
  allowance: number;
  height?: number;
}) {
  const { c, fs } = useUi();
  const hide = useStore((s) => s.hideAmounts);
  const { w, onLayout } = useWidth();
  const [sel, setSel] = useState(data.length - 1);
  const active = Math.min(sel, data.length - 1);

  const padT = 8;
  const padB = 20;
  const plotH = height - padT - padB;
  const hi = niceMax(Math.max(allowance, ...data.map((d) => d.spent), 1));
  const slot = w / Math.max(1, data.length);
  const barW = Math.max(4, Math.min(22, slot - 2));
  const y = (v: number) => padT + (1 - v / hi) * plotH;
  const day = (date: string) => String(Number(date.slice(8, 10)));

  const pick = (e: GestureResponderEvent) => {
    const i = Math.floor(e.nativeEvent.locationX / slot);
    setSel(Math.min(data.length - 1, Math.max(0, i)));
  };

  const cur = data[active];
  return (
    <View style={{ gap: 8 }}>
      <View onLayout={onLayout} style={{ height }} onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true} onResponderGrant={pick} onResponderMove={pick}>
        {w > 0 ? (
          <Svg width={w} height={height}>
            <Line x1={0} x2={w} y1={y(0)} y2={y(0)} stroke={CHART.axis} strokeWidth={1} />
            {data.map((d, i) => {
              const h = d.spent > 0 ? Math.max(2, y(0) - y(d.spent)) : 0;
              const cx = i * slot + slot / 2;
              return (
                <React.Fragment key={d.date}>
                  {h > 0 ? (
                    <Rect x={cx - barW / 2} y={y(0) - h} width={barW} height={h} rx={Math.min(4, barW / 2)} fill={CHART.series[0]} opacity={i === active ? 1 : 0.55} />
                  ) : null}
                  {i === active || i === 0 || (data.length - 1 - i) % 7 === 0 ? (
                    <SvgText x={cx} y={height - 5} fontSize={fs(10)} fill={i === active ? c.text : c.muted} textAnchor="middle">
                      {day(d.date)}
                    </SvgText>
                  ) : null}
                </React.Fragment>
              );
            })}
            {allowance > 0 ? <Line x1={0} x2={w} y1={y(allowance)} y2={y(allowance)} stroke={c.muted} strokeWidth={1} strokeDasharray="4 4" /> : null}
          </Svg>
        ) : null}
      </View>
      <Row>
        <Txt v="small">
          Ngày {day(cur.date)}/{Number(cur.date.slice(5, 7))}: {hide ? '•••' : fmtVND(cur.spent, 'compact')}
        </Txt>
        {allowance > 0 ? <Txt v="small">- - hạn mức/ngày {hide ? '•••' : fmtVND(allowance, 'compact')}</Txt> : null}
      </Row>
    </View>
  );
}

/** Tiny single-series trend line (no axes): used inside summary cards. */
export function Sparkline({ values, height = 44 }: { values: number[]; height?: number }) {
  const { w, onLayout } = useWidth();
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (i: number) => 3 + (i / Math.max(1, values.length - 1)) * (w - 6);
  const y = (v: number) => 4 + (1 - (v - lo) / span) * (height - 8);
  return (
    <View onLayout={onLayout} style={{ height }}>
      {w > 0 && values.length > 1 ? (
        <Svg width={w} height={height}>
          <Path d={values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} stroke={CHART.series[0]} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={4} fill={CHART.series[0]} />
        </Svg>
      ) : null}
    </View>
  );
}
