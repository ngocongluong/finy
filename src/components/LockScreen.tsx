// Full-screen lock: PIN pad + fingerprint. Also handles first-run PIN setup.
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { biometricAvailable, biometricPending, biometricUnlock, getBiometricPref, lockedForSeconds, PIN_LENGTH, setPin, verifyPin } from '../lib/security';
import { useStore } from '../lib/store';
import { DEFAULT_UI } from '../lib/theme';

// The lock screen always uses the built-in palette: it must stay usable no
// matter what the theme has been changed to, and it renders before the
// encrypted settings can be read.
const C = DEFAULT_UI.colors;

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'bio', '0', 'del'] as const;

export function LockScreen({ mode }: { mode: 'setup' | 'unlock' }) {
  const insets = useSafeAreaInsets();
  const unlock = useStore((s) => s.unlock);
  const loaded = useStore((s) => s.loaded);

  const [pin, setPinText] = useState('');
  const [first, setFirst] = useState<string | null>(null); // setup: the PIN entered the first time
  const [msg, setMsg] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [bioOk, setBioOk] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = busy;

  const tryBiometric = useCallback(async () => {
    if (busyRef.current) return;
    if (await biometricUnlock()) await unlock();
  }, [unlock]);

  // Offer the fingerprint by itself when the lock screen shows, and again whenever the app
  // comes back to the foreground. Never while the app is in the background (the lock
  // screen appears then when Finy locks on leaving): Android drops that request silently
  // and the fingerprint would stop answering.
  useEffect(() => {
    if (mode !== 'unlock') return;
    let alive = true;
    // One offer at a time: the lock screen appearing and the app coming back can happen together.
    let offering = false;
    const offer = async () => {
      if (offering) return;
      offering = true;
      try {
        const [avail, allowed, sec] = await Promise.all([biometricAvailable(), getBiometricPref(), lockedForSeconds()]);
        if (!alive) return;
        setBioOk(avail && allowed);
        setWait(sec);
        if (avail && allowed && sec === 0 && AppState.currentState === 'active' && !biometricPending()) await tryBiometric();
      } finally {
        offering = false;
      }
    };
    offer();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') offer();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, [mode, tryBiometric]);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearInterval(t);
  }, [wait]);

  const submit = async (code: string) => {
    setBusy(true);
    try {
      if (mode === 'setup') {
        if (first === null) {
          setFirst(code);
          setMsg(null);
        } else if (first === code) {
          await setPin(code);
          await unlock();
        } else {
          setFirst(null);
          setMsg('Hai mã PIN không khớp. Nhập lại từ đầu.');
        }
      } else {
        const res = await verifyPin(code);
        if (res.ok) {
          await unlock();
        } else {
          setWait(res.waitSec);
          setMsg(res.waitSec > 0 ? 'Sai mã PIN quá nhiều lần.' : `Sai mã PIN (${res.attempts}/5 lần trước khi tạm khoá).`);
        }
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Không mở được dữ liệu.');
    } finally {
      setPinText('');
      setBusy(false);
    }
  };

  const press = (k: (typeof KEYS)[number]) => {
    if (busy || wait > 0) return;
    if (k === 'bio') {
      if (mode === 'unlock' && bioOk) tryBiometric();
      return;
    }
    if (k === 'del') {
      setPinText((p) => p.slice(0, -1));
      return;
    }
    const next = (pin + k).slice(0, PIN_LENGTH);
    setPinText(next);
    if (next.length === PIN_LENGTH) submit(next);
  };

  const title =
    mode === 'setup' ? (first === null ? 'Tạo mã PIN 6 số' : 'Nhập lại mã PIN') : wait > 0 ? `Tạm khoá ${wait} giây` : 'Nhập mã PIN';
  const sub =
    msg ??
    (mode === 'setup'
      ? 'Mã PIN bảo vệ toàn bộ dữ liệu tài chính của bạn trên máy này.'
      : loaded
        ? 'Finy đã khoá khi bạn rời ứng dụng.'
        : 'Dữ liệu được mã hoá trên máy.');

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24, alignItems: 'center' }}>
      <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border }}>
        <Ionicons name="lock-closed" size={28} color={C.accent} />
      </View>
      <Text style={{ color: C.text, fontSize: 22, fontWeight: '700', marginTop: 20 }}>{title}</Text>
      <Text style={{ color: msg ? C.negative : C.muted, fontSize: 14, marginTop: 8, textAlign: 'center', paddingHorizontal: 40, minHeight: 40 }}>{sub}</Text>

      <View style={{ flexDirection: 'row', gap: 16, marginTop: 20 }} accessibilityLabel={`Đã nhập ${pin.length} trên ${PIN_LENGTH} số`}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <View key={i} style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: i < pin.length ? C.accent : 'transparent', borderWidth: 2, borderColor: i < pin.length ? C.accent : C.border }} />
        ))}
      </View>

      <View style={{ flex: 1 }} />

      <View style={{ width: 300, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 16, opacity: wait > 0 ? 0.35 : 1 }}>
        {KEYS.map((k) => {
          const isBio = k === 'bio';
          const hidden = isBio && !(mode === 'unlock' && bioOk);
          return (
            <Pressable
              key={k}
              onPress={() => press(k)}
              disabled={hidden}
              accessibilityRole="button"
              accessibilityLabel={isBio ? 'Mở khoá bằng vân tay' : k === 'del' ? 'Xoá số' : k}
              style={({ pressed }) => ({
                width: 84,
                height: 72,
                borderRadius: 24,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: isBio || k === 'del' ? 'transparent' : pressed ? C.cardAlt : C.card,
                opacity: hidden ? 0 : 1,
              })}>
              {isBio ? (
                <Ionicons name="finger-print" size={32} color={C.accent} />
              ) : k === 'del' ? (
                <Ionicons name="backspace-outline" size={28} color={C.text} />
              ) : (
                <Text style={{ color: C.text, fontSize: 28, fontWeight: '500' }}>{k}</Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
