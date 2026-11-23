// Themed building blocks. Every colour, radius and size comes from the
// UiConfig in the store, so a change made by Finy restyles the whole app.
import { Ionicons } from '@expo/vector-icons';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useKeyboardHandler, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fmtInput, fmtVND, maskMoney, parseAmount } from '../lib/format';
import { useStore } from '../lib/store';
import { alpha } from '../lib/theme';

/**
 * Amounts are hidden per section. A HideScope names the section its children
 * belong to; each section has its own eye button. Amounts outside any section
 * (edit forms the user opened on purpose) are shown.
 */
const HideScopeCtx = createContext<string | null>(null);

export function HideScope({ id, children }: { id: string | null; children: React.ReactNode }) {
  return <HideScopeCtx.Provider value={id}>{children}</HideScopeCtx.Provider>;
}

/**
 * Money is formatted where data is prepared, often outside the section that
 * shows it. So formatted amounts are wrapped in invisible markers, and Txt
 * hides what is between them when its own section is hidden.
 */
const MARK = '\u2060';
const MARKED = /\u2060[^\u2060]*\u2060/g;

/** Marks a piece of text (an amount, a percentage) as hidden with its section. */
export const secret = (text: string) => `${MARK}${text}${MARK}`;

function reveal(text: string, hide: boolean): string {
  return hide ? text.replace(MARKED, '•••') : text.split(MARK).join('');
}

/** Whether amounts in the current section are hidden. */
export function useHidden(): boolean {
  const scope = useContext(HideScopeCtx);
  return useStore((s) => (scope === null ? false : !s.revealed.includes(scope)));
}

/** Show / hide the amounts of one section. */
export function EyeToggle({ id, size = 20 }: { id: string; size?: number }) {
  const { c } = useUi();
  const shown = useStore((s) => s.revealed.includes(id));
  const toggle = useStore((s) => s.toggleReveal);
  return (
    <IconBtn
      name={shown ? 'eye-outline' : 'eye-off-outline'}
      size={size}
      color={shown ? c.text : c.muted}
      onPress={() => toggle(id)}
      label={shown ? 'Ẩn số tiền của mục này' : 'Hiện số tiền của mục này'}
    />
  );
}

export function useUi() {
  const ui = useStore((s) => s.ui);
  return useMemo(() => {
    const compact = ui.density === 'compact';
    return {
      ui,
      c: ui.colors,
      r: ui.radius,
      fs: (n: number) => Math.round(n * ui.fontScale),
      gap: compact ? 10 : 14,
      pad: compact ? 12 : 16,
    };
  }, [ui]);
}

type TxtVariant = 'title' | 'heading' | 'body' | 'label' | 'small' | 'hero' | 'num';

export function Txt({
  v = 'body',
  color,
  style,
  children,
  ...rest
}: { v?: TxtVariant; color?: string; style?: StyleProp<TextStyle>; children: React.ReactNode } & React.ComponentProps<typeof Text>) {
  const { c, fs } = useUi();
  const hide = useHidden();
  const shown = React.Children.map(children, (ch) => (typeof ch === 'string' ? reveal(ch, hide) : ch));
  const base: Record<TxtVariant, TextStyle> = {
    title: { fontSize: fs(24), fontWeight: '700', color: c.text },
    heading: { fontSize: fs(16), fontWeight: '600', color: c.text },
    body: { fontSize: fs(15), color: c.text, lineHeight: fs(22) },
    label: { fontSize: fs(13), color: c.muted },
    small: { fontSize: fs(12), color: c.muted },
    hero: { fontSize: fs(34), fontWeight: '700', color: c.text },
    num: { fontSize: fs(15), fontWeight: '600', color: c.text },
  };
  return (
    <Text {...rest} style={[base[v], color ? { color } : null, style]}>
      {shown}
    </Text>
  );
}

export function Card({
  children,
  style,
  onPress,
  eye,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  /** Section id: the card gets its own show/hide-amounts button in the top-right corner. */
  eye?: string;
}) {
  const { c, r, pad } = useUi();
  const s: ViewStyle = { backgroundColor: c.card, borderRadius: r, padding: pad, borderWidth: 1, borderColor: c.border };
  // Room on the right for the eye, so it never sits on top of an amount.
  const withEye: ViewStyle | null = eye ? { paddingRight: pad + 30 } : null;
  const body = eye ? <HideScope id={eye}>{children}</HideScope> : children;
  const eyeBtn = eye ? (
    <View style={{ position: 'absolute', top: 4, right: 2 }}>
      <EyeToggle id={eye} />
    </View>
  ) : null;
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [s, withEye, pressed && { opacity: 0.85 }, style]}>
        {body}
        {eyeBtn}
      </Pressable>
    );
  }
  return (
    <View style={[s, withEye, style]}>
      {body}
      {eyeBtn}
    </View>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, style]}>{children}</View>;
}

/** Money. Hidden behind dots when the privacy toggle is on. */
export function Amount({
  value,
  v = 'num',
  color,
  signed,
  style,
}: {
  value: number;
  v?: TxtVariant;
  color?: string;
  signed?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const hide = useHidden();
  const mode = useStore((s) => s.ui.amountFormat);
  const text = hide ? '••••••' : `${signed && value > 0 ? '+' : ''}${fmtVND(value, mode)}`;
  return (
    <Txt v={v} color={color} style={style} numberOfLines={1} adjustsFontSizeToFit>
      {text}
    </Txt>
  );
}

export function useMoney() {
  const mode = useStore((s) => s.ui.amountFormat);
  // Marked, not masked: the Txt that shows it decides, from its own section.
  return (n: number, forceCompact = false) => secret(fmtVND(n, forceCompact ? 'compact' : mode));
}

export function Btn({
  label,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { c, r, fs } = useUi();
  const bg = kind === 'primary' ? c.accent : kind === 'danger' ? alpha(c.negative, 0.16) : c.cardAlt;
  const fg = kind === 'primary' ? c.onAccent : kind === 'danger' ? c.negative : c.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderRadius: Math.min(r, 16),
          minHeight: 48,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
        style,
      ]}>
      {icon ? <Ionicons name={icon} size={fs(18)} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: fs(15), fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function IconBtn({
  name,
  onPress,
  color,
  label,
  size = 22,
}: {
  name: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  color?: string;
  label: string;
  size?: number;
}) {
  const { c } = useUi();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
      <Ionicons name={name} size={size} color={color ?? c.text} />
    </Pressable>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  const { c, fs } = useUi();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 14,
        minHeight: 38,
        justifyContent: 'center',
        borderRadius: 19,
        backgroundColor: active ? c.accent : c.cardAlt,
        opacity: pressed ? 0.8 : 1,
      })}>
      <Text style={{ color: active ? c.onAccent : c.text, fontSize: fs(13), fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const { c, r, fs } = useUi();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: c.cardAlt, borderRadius: Math.min(r, 14), padding: 4, gap: 4 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={{ flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: Math.min(r, 11), backgroundColor: on ? c.accent : 'transparent' }}>
            <Text style={{ color: on ? c.onAccent : c.muted, fontSize: fs(13), fontWeight: '600' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A meter: how much of a limit is used. Colour is paired with the caller's text label, never used alone. */
export function Meter({ ratio, color }: { ratio: number; color?: string }) {
  const { c } = useUi();
  const pct = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: c.cardAlt, overflow: 'hidden' }}>
      <View style={{ width: `${pct * 100}%`, height: 8, borderRadius: 4, backgroundColor: color ?? c.accent }} />
    </View>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secure,
  multiline,
  autoFocus,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  secure?: boolean;
  multiline?: boolean;
  autoFocus?: boolean;
  keyboardType?: 'default' | 'number-pad' | 'decimal-pad';
}) {
  const { c, r, fs } = useUi();
  return (
    <View style={{ gap: 6 }}>
      <Txt v="label">{label}</Txt>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={alpha(c.muted, 0.6)}
        secureTextEntry={secure}
        multiline={multiline}
        autoFocus={autoFocus}
        keyboardType={keyboardType}
        autoCapitalize="sentences"
        style={{
          backgroundColor: c.cardAlt,
          color: c.text,
          borderRadius: Math.min(r, 14),
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontSize: fs(16),
          minHeight: 50,
        }}
      />
    </View>
  );
}

/** Amount input: digits are grouped as you type; "20tr", "500k", "1,2 tỷ" also work. */
export function AmountField({
  label,
  value,
  onChange,
  autoFocus,
  sync,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  autoFocus?: boolean;
  /**
   * Follow `value` when it is changed from outside (e.g. filled in by a
   * button). Otherwise `value` is only the starting amount.
   */
  sync?: boolean;
}) {
  const { c, r, fs } = useUi();
  const [text, setText] = useState(value ? fmtInput(String(value)) : '');
  useEffect(() => {
    if (!sync) return;
    // What was typed stays as typed ("20tr") as long as it means the same amount.
    setText((t) => (parseAmount(t) === value ? t : value ? fmtInput(String(value)) : ''));
  }, [sync, value]);
  const hasUnit = /[a-zA-Zỷỉệ]/.test(text);
  return (
    <View style={{ gap: 6 }}>
      <Txt v="label">{label}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.cardAlt, borderRadius: Math.min(r, 14), paddingHorizontal: 14 }}>
        <TextInput
          value={text}
          onChangeText={(t) => {
            const next = /[a-zA-Zỷỉệ,]/.test(t) ? t : fmtInput(t);
            setText(next);
            onChange(parseAmount(next));
          }}
          placeholder="0"
          placeholderTextColor={alpha(c.muted, 0.6)}
          keyboardType="number-pad"
          autoFocus={autoFocus}
          style={{ flex: 1, color: c.text, fontSize: fs(22), fontWeight: '700', paddingVertical: 12, minHeight: 56 }}
        />
        <Txt v="label">đ</Txt>
      </View>
      {hasUnit ? <Txt v="small">= {fmtVND(parseAmount(text))}</Txt> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {['000', '.000.000'].map((suffix) => (
          <Chip
            key={suffix}
            label={suffix === '000' ? '+000 (nghìn)' : '+000.000 (triệu)'}
            onPress={() => {
              const n = parseAmount(text) * (suffix === '000' ? 1000 : 1_000_000);
              if (!n) return;
              setText(fmtInput(String(n)));
              onChange(n);
            }}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * Keeps a container's content above the keyboard. The keyboard height comes
 * from the system's window insets (react-native-keyboard-controller), which
 * also works edge to edge on Android 15+. The container's own distance from
 * the bottom of the screen (tab bar, navigation bar) is measured and taken
 * off, so the content ends exactly at the keyboard's top edge.
 * Spread `props` onto an Animated.View with flex: 1.
 */
export function useKeyboardSpace(label = 'kb') {
  const ref = useRef<React.ComponentRef<typeof Animated.View>>(null);
  const below = useSharedValue(0);
  const { height } = useReanimatedKeyboardAnimation();
  const style = useAnimatedStyle(() => ({ paddingBottom: Math.max(0, -height.value - below.value) }));
  const log = (h: number) => console.log(`[finy] ${label} keyboard=${Math.round(h)} below=${Math.round(below.value)} screen=${Math.round(Dimensions.get('screen').height)}`);
  useKeyboardHandler({
    onEnd: (e) => {
      'worklet';
      if (e.height > 0) runOnJS(log)(e.height);
    },
  });
  const onLayout = () =>
    ref.current?.measureInWindow((_x: number, y: number, _w: number, h: number) => {
      below.value = Math.max(0, Dimensions.get('screen').height - (y + h));
    });
  return { ref, style, onLayout };
}

/** Bottom sheet used for every add / edit form. */
export function Sheet({
  visible,
  title,
  onClose,
  children,
  footer,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Primary action, pinned below the scrolling form so the keyboard never hides it. */
  footer?: React.ReactNode;
}) {
  const { c, r, pad } = useUi();
  const insets = useSafeAreaInsets();
  const kb = useKeyboardSpace('sheet');
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      {/* An edit form is opened on purpose: its amounts are always shown. */}
      <HideScope id={null}>
      <Animated.View ref={kb.ref} onLayout={kb.onLayout} collapsable={false} style={[{ flex: 1, justifyContent: 'flex-end' }, kb.style]}>
        <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000aa' }} onPress={onClose} accessibilityLabel="Đóng" />
        <View
          style={{
            backgroundColor: c.card,
            borderTopLeftRadius: Math.max(r, 16),
            borderTopRightRadius: Math.max(r, 16),
            paddingHorizontal: pad + 4,
            paddingTop: 10,
            paddingBottom: insets.bottom + 16,
            maxHeight: '88%',
            borderTopWidth: 1,
            borderColor: c.border,
          }}>
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.border, marginBottom: 8 }} />
          <Row style={{ marginBottom: 8 }}>
            <Txt v="heading">{title}</Txt>
            <IconBtn name="close" onPress={onClose} label="Đóng" />
          </Row>
          <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 4 }}>
            {children}
          </ScrollView>
          {footer ? <View style={{ paddingTop: 12 }}>{footer}</View> : null}
        </View>
      </Animated.View>
      </HideScope>
    </Modal>
  );
}

/** Page scaffold: safe area, title row (with the show/hide-amounts eye), scrolling body. */
export function Screen({
  title,
  right,
  children,
  scroll = true,
  footer,
  eye,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  scroll?: boolean;
  footer?: React.ReactNode;
  /** Section id for the whole screen (list screens): one show/hide-amounts button in the title row. Cards can still have their own. */
  eye?: string;
}) {
  const { c, pad, gap } = useUi();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <Row style={{ paddingHorizontal: pad, minHeight: 56 }}>
        <Txt v="title" numberOfLines={1} style={{ flexShrink: 1 }}>
          {title}
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {eye ? <EyeToggle id={eye} size={22} /> : null}
          {right}
        </View>
      </Row>
      <HideScope id={eye ?? null}>
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: pad, paddingBottom: 28, gap }}>
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{children}</View>
      )}
      </HideScope>
      {footer}
    </View>
  );
}

export function Empty({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const { c } = useUi();
  return (
    <View style={{ alignItems: 'center', gap: 10, paddingVertical: 28 }}>
      <Ionicons name={icon} size={34} color={c.muted} />
      <Txt v="label" style={{ textAlign: 'center' }}>
        {text}
      </Txt>
    </View>
  );
}

/** Renders the small subset of Markdown that Finy is asked to write: **bold**, bullets, numbered lists. */
export function RichText({ text: raw, color }: { text: string; color?: string }) {
  const { c, fs } = useUi();
  const hide = useHidden();
  const text = hide ? maskMoney(raw) : raw;
  const fg = color ?? c.text;
  const inline = (s: string, key: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <Text key={`${key}-${i}`} style={{ fontWeight: '700' }}>
          {part.slice(2, -2)}
        </Text>
      ) : (
        part
      ),
    );
  const lines = text.replace(/\r/g, '').split('\n');
  return (
    <View style={{ gap: 6 }}>
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <View key={i} style={{ height: 2 }} />;
        const bullet = line.match(/^\s*[-•*]\s+(.*)$/);
        const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
        const heading = line.match(/^#{1,4}\s+(.*)$/);
        const body: TextStyle = { color: fg, fontSize: fs(15), lineHeight: fs(22), flex: 1 };
        if (bullet || numbered) {
          return (
            <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
              <Text style={{ color: c.muted, fontSize: fs(15), lineHeight: fs(22), minWidth: 14 }}>{bullet ? '•' : `${numbered![1]}.`}</Text>
              <Text style={body}>{inline(bullet ? bullet[1] : numbered![2], `l${i}`)}</Text>
            </View>
          );
        }
        if (heading) {
          return (
            <Text key={i} style={[body, { fontWeight: '700', flex: 0 }]}>
              {inline(heading[1], `l${i}`)}
            </Text>
          );
        }
        return (
          <Text key={i} style={[body, { flex: 0 }]}>
            {inline(line, `l${i}`)}
          </Text>
        );
      })}
    </View>
  );
}
