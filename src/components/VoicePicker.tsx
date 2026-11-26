// Settings: how Finy sounds - which Vietnamese voice of the phone, its pitch
// and its speed. Every choice is played right away so it can be compared.
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';
import { DEFAULT_VOICE_STYLE, type VoiceStyle } from '../lib/security';
import { getFinyVoiceStyle, listVoices, previewVoice, saveFinyVoiceStyle, type FinyVoiceOption } from '../lib/voice';
import { Btn, Chip, IconBtn, Row, Txt, useUi } from './ui';

const PITCHES = [
  { label: 'Trầm', value: 0.9 },
  { label: 'Tự nhiên', value: 1 },
  { label: 'Trong trẻo', value: 1.15 },
  { label: 'Cao', value: 1.3 },
];
const RATES = [
  { label: 'Chậm', value: 0.85 },
  { label: 'Vừa', value: 1 },
  { label: 'Nhanh', value: 1.15 },
];

/** "vi-vn-x-gft-local" -> "gft": the part that tells Google's voices apart. */
const shortName = (name: string) => name.match(/-x-([a-z]+)-/)?.[1] ?? name;

export function VoicePicker() {
  const { c } = useUi();
  const [voices, setVoices] = useState<FinyVoiceOption[] | null>(null);
  const [style, setStyle] = useState<VoiceStyle>(DEFAULT_VOICE_STYLE);

  useEffect(() => {
    let alive = true;
    Promise.all([listVoices(), getFinyVoiceStyle()]).then(([v, s]) => {
      if (!alive) return;
      setVoices(v);
      setStyle(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Saved and played at once, so voices can be compared one after another.
  const choose = (patch: Partial<VoiceStyle>) => {
    const next = { ...style, ...patch };
    setStyle(next);
    saveFinyVoiceStyle(next).catch(() => undefined);
    previewVoice(next).catch(() => undefined);
  };

  const option = (name: string | null, title: string, sub: string, missing = false) => {
    const on = style.voice === name;
    return (
      <Pressable
        key={name ?? 'default'}
        onPress={() => choose({ voice: name })}
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, minHeight: 48, justifyContent: 'center' })}>
        <Row style={{ gap: 12 }}>
          <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? c.accent : c.muted} />
          <View style={{ flex: 1 }}>
            <Txt>{title}</Txt>
            <Txt v="small" color={missing ? c.warning : c.muted}>
              {sub}
            </Txt>
          </View>
          <IconBtn name="play-circle-outline" label={`Nghe thử ${title}`} onPress={() => previewVoice({ ...style, voice: name }).catch(() => undefined)} />
        </Row>
      </Pressable>
    );
  };

  return (
    <View style={{ gap: 10 }}>
      <Txt v="label">Giọng của Finy</Txt>
      {voices === null ? (
        <ActivityIndicator color={c.accent} />
      ) : (
        <View>
          {option(null, 'Mặc định của máy', 'Giọng tiếng Việt mặc định của Google')}
          {voices.map((v, i) =>
            option(v.name, `Giọng ${i + 1}`, `${shortName(v.name)}${v.missing ? ' · chưa tải, cần tải trong cài đặt giọng nói' : ''}`, v.missing),
          )}
        </View>
      )}
      <Txt v="label">Cao độ</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {PITCHES.map((p) => (
          <Chip key={p.label} label={p.label} active={Math.abs(style.pitch - p.value) < 0.01} onPress={() => choose({ pitch: p.value })} />
        ))}
      </View>
      <Txt v="label">Tốc độ đọc</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {RATES.map((r) => (
          <Chip key={r.label} label={r.label} active={Math.abs(style.rate - r.value) < 0.01} onPress={() => choose({ rate: r.value })} />
        ))}
      </View>
      <Txt v="small">
        Chạm một giọng để chọn và nghe thử. Muốn giọng nữ trong trẻo: thử lần lượt các giọng, rồi chọn cao độ “Trong trẻo”. Finy chỉ dùng giọng chạy ngay trên máy. Muốn thêm giọng, mở cài đặt giọng nói → Google → Cài đặt dữ liệu giọng nói → Tiếng Việt.
      </Txt>
      <Btn label="Mở cài đặt giọng nói" kind="ghost" icon="settings-outline" onPress={() => Linking.sendIntent('com.android.settings.TTS_SETTINGS').catch(() => Linking.openSettings())} />
    </View>
  );
}
