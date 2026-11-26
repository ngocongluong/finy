import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { IconBtn, RichText, Screen, Txt, useKeyboardSpace, useUi } from '../../components/ui';
import { apiKey, sendToFiny } from '../../lib/claude';
import { useStore } from '../../lib/store';
import { maskMoney } from '../../lib/format';
import { talk } from '../../lib/voice';
import { alpha } from '../../lib/theme';

const SUGGESTIONS = [
  'Tháng này tôi chi tiêu thế nào?',
  'Lập kế hoạch tài chính 10 năm cho tôi',
  'Hôm nay tôi tiêu 150k ăn trưa',
  'Đổi giao diện sang tông xanh lá, bo góc ít hơn',
];

export default function Chat() {
  const { c, r, fs, pad } = useUi();
  const chat = useStore((s) => s.chat);
  const pending = useStore((s) => s.pendingPrompt);
  const canUndo = useStore((s) => s.uiHistory.length > 0);
  // Chat bubbles follow the eye in this screen's title row.
  const hide = useStore((s) => !s.revealed.includes('chat'));
  const focused = useIsFocused();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const kb = useKeyboardSpace('chat');

  const send = useCallback(
    async (message: string) => {
      const m = message.trim();
      if (!m || busy) return;
      setText('');
      setBusy(true);
      try {
        await sendToFiny(m);
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  // A question queued by another screen (e.g. "analyse my plan").
  useEffect(() => {
    if (focused && pending && !busy) {
      useStore.getState().setPendingPrompt(null);
      send(pending);
    }
  }, [focused, pending, busy, send]);

  const newChat = () => {
    if (!chat.length) return;
    Alert.alert('Cuộc trò chuyện mới?', 'Finy sẽ quên nội dung cuộc trò chuyện hiện tại. Dữ liệu tài chính không bị ảnh hưởng.', [
      { text: 'Không', style: 'cancel' },
      { text: 'Bắt đầu mới', onPress: () => useStore.getState().clearChat() },
    ]);
  };

  const hasKey = !!apiKey();

  return (
    <Screen
      title="Finy"
      eye="chat"
      scroll={false}
      right={
        <>
          {canUndo ? <IconBtn name="arrow-undo-outline" onPress={() => useStore.getState().undoUi()} label="Hoàn tác thay đổi giao diện" /> : null}
          <IconBtn name="create-outline" onPress={newChat} label="Cuộc trò chuyện mới" />
        </>
      }>
      {/* Keeps the input right above the keyboard. */}
      <Animated.View ref={kb.ref} onLayout={kb.onLayout} collapsable={false} style={[{ flex: 1 }, kb.style]}>
        <ScrollView
          ref={scroll}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: pad, paddingBottom: 12, gap: 10, flexGrow: 1 }}>
          {chat.length === 0 ? (
            <View style={{ flex: 1, justifyContent: 'center', gap: 14, paddingVertical: 24 }}>
              <View style={{ alignItems: 'center', gap: 8 }}>
                <Ionicons name="sparkles" size={36} color={c.accent} />
                <Txt v="heading">Hỏi Finy về tiền của bạn</Txt>
                <Txt v="label" style={{ textAlign: 'center' }}>
                  Finy thấy ngân sách, giao dịch và kế hoạch của bạn; có thể tư vấn, ghi chép giúp và tự chỉnh giao diện theo góp ý.
                </Txt>
              </View>
              {!hasKey ? <Txt color={c.negative} style={{ textAlign: 'center' }}>Chưa có API key của Claude. Nhập key trong Cài đặt.</Txt> : null}
              {SUGGESTIONS.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => send(s)}
                  style={({ pressed }) => ({ backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: r, padding: 14, opacity: pressed ? 0.7 : 1 })}>
                  <Txt>{s}</Txt>
                </Pressable>
              ))}
            </View>
          ) : null}

          {chat.map((m) =>
            m.role === 'user' ? (
              <View key={m.id} style={{ alignSelf: 'flex-end', maxWidth: '86%', backgroundColor: c.accent, borderRadius: r, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 10 }}>
                <Txt color={c.onAccent}>{hide ? maskMoney(m.text) : m.text}</Txt>
              </View>
            ) : (
              <View key={m.id} style={{ alignSelf: 'flex-start', maxWidth: '94%', gap: 6 }}>
                <View style={{ backgroundColor: c.card, borderColor: m.error ? c.negative : c.border, borderWidth: 1, borderRadius: r, borderBottomLeftRadius: 4, paddingHorizontal: 14, paddingVertical: 12 }}>
                  <RichText text={m.text} color={m.error ? c.negative : undefined} />
                </View>
                {m.actions?.map((a, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: alpha(c.accent, 0.14), borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 }}>
                    <Ionicons name="checkmark-circle" size={15} color={c.accent} />
                    <Txt v="small" color={c.text}>{hide ? maskMoney(a) : a}</Txt>
                  </View>
                ))}
              </View>
            ),
          )}

          {busy ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
              <ActivityIndicator color={c.accent} />
              <Txt v="label">Finy đang suy nghĩ…</Txt>
            </View>
          ) : null}
        </ScrollView>

        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: pad, paddingVertical: 10, borderTopWidth: 1, borderColor: c.border, backgroundColor: c.bg }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Nhắn cho Finy…"
            placeholderTextColor={alpha(c.muted, 0.7)}
            multiline
            onFocus={() => setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 300)}
            style={{ flex: 1, backgroundColor: c.card, color: c.text, borderRadius: Math.min(r, 22), paddingHorizontal: 16, paddingVertical: 12, fontSize: fs(16), maxHeight: 130, minHeight: 48, borderWidth: 1, borderColor: c.border }}
          />
          {/* Nothing typed: the button talks to Finy instead (it asks what you need and listens). */}
          <Pressable
            onPress={() => (text.trim() ? send(text) : talk())}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={text.trim() ? 'Gửi' : 'Nói với Finy'}
            style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.4 : 1 }}>
            <Ionicons name={text.trim() ? 'arrow-up' : 'mic'} size={22} color={c.onAccent} />
          </Pressable>
        </View>
      </Animated.View>
    </Screen>
  );
}
