// What Finy is doing in a voice exchange, at the top of the screen: asking,
// hearing the request, working, answering. Shown over the app and over the
// lock screen, so it uses the built-in palette like the lock screen does.
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DEFAULT_UI } from '../lib/theme';
import { cancelTalk, useVoice } from '../lib/voice';

const C = DEFAULT_UI.colors;

export function VoiceBanner() {
  const insets = useSafeAreaInsets();
  const status = useVoice((s) => s.status);
  const heard = useVoice((s) => s.heard);
  const reply = useVoice((s) => s.reply);
  if (status === 'off' || status === 'listening' || status === 'enrolling') return null;

  const line =
    status === 'asking'
      ? 'Dạ, Finy nghe. Bạn cần ghi gì?'
      : status === 'command'
        ? 'Đang nghe…'
        : status === 'working'
          ? `“${heard}” · đang làm…`
          : reply;

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12 }}>
      <View
        accessibilityLiveRegion="polite"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          backgroundColor: C.card,
          borderColor: C.accent,
          borderWidth: 1,
          borderRadius: 18,
          paddingVertical: 12,
          paddingLeft: 14,
          paddingRight: 6,
          shadowColor: '#000',
          shadowOpacity: 0.4,
          shadowRadius: 12,
          elevation: 8,
        }}>
        {status === 'working' ? (
          <ActivityIndicator color={C.accent} />
        ) : (
          <Ionicons name={status === 'speaking' ? 'chatbubble-ellipses' : 'mic'} size={22} color={C.accent} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.muted, fontSize: 12, fontWeight: '600' }}>Finy</Text>
          <Text style={{ color: C.text, fontSize: 15 }} numberOfLines={4}>
            {line}
          </Text>
        </View>
        <Pressable onPress={cancelTalk} accessibilityRole="button" accessibilityLabel="Dừng" hitSlop={8} style={{ padding: 8 }}>
          <Ionicons name="close" size={20} color={C.muted} />
        </Pressable>
      </View>
    </View>
  );
}
