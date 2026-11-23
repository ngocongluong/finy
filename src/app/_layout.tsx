import Constants from 'expo-constants';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as ScreenCapture from 'expo-screen-capture';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import React, { useEffect, useMemo } from 'react';
import { Alert, AppState, Modal, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LockScreen } from '../components/LockScreen';
import { fmtVND } from '../lib/format';
import { creditOverMessage, isSyncing, shouldAlertCreditOver, syncHsbc } from '../lib/hsbc';
import { autoLockSuspended } from '../lib/lockGuard';
import { useStore } from '../lib/store';

export default function RootLayout() {
  const phase = useStore((s) => s.phase);
  const colors = useStore((s) => s.ui.colors);
  const bg = colors.bg;
  // Navigation chrome (tab bar insets, screen transitions) follows the app theme too.
  const navTheme = useMemo(
    () => ({
      ...DarkTheme,
      colors: { ...DarkTheme.colors, background: colors.bg, card: colors.card, text: colors.text, border: colors.border, primary: colors.accent },
    }),
    [colors],
  );

  useEffect(() => {
    useStore.getState().boot();
    // FLAG_SECURE: no screenshots, no screen recording, blank preview in the app switcher.
    if (!Constants.expoConfig?.extra?.allowScreenshots) ScreenCapture.preventScreenCaptureAsync().catch(() => {});
  }, []);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(bg).catch(() => {});
  }, [bg]);

  // After each unlock, quietly pull new HSBC emails (at most every 30 minutes)
  // so card spending and the overspend warning are current without a manual sync.
  useEffect(() => {
    if (phase !== 'ready') return;
    const { settings } = useStore.getState();
    if (!settings.gmailEmail || isSyncing()) return;
    if (settings.lastSyncTs && Date.now() - settings.lastSyncTs < 30 * 60_000) return;
    syncHsbc()
      .then(async (r) => {
        if (r.creditOver && (await shouldAlertCreditOver(r.creditOver))) Alert.alert('Chi tín dụng vượt dự chi', creditOverMessage(r.creditOver, fmtVND));
      })
      .catch(() => {
        // Offline or the Google session expired: the Transactions tab shows the reason on a manual sync.
      });
  }, [phase]);

  // Lock when the app leaves the foreground.
  useEffect(() => {
    let leftAt = 0;
    const sub = AppState.addEventListener('change', (state) => {
      const { settings, lock } = useStore.getState();
      if (state === 'background') {
        if (autoLockSuspended()) return;
        leftAt = Date.now();
        if (settings.autoLockSec === 0) lock();
      } else if (state === 'active') {
        if (leftAt && Date.now() - leftAt >= settings.autoLockSec * 1000) lock();
        leftAt = 0;
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={{ flex: 1, backgroundColor: bg }}>
        <ThemeProvider value={navTheme}>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: bg }, animation: 'slide_from_right' }} />
        </ThemeProvider>
      </View>
      {/* A Modal so the lock also covers any sheet that was open when the app was left. */}
      <Modal visible={phase !== 'ready'} animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={() => {}}>
        {phase === 'boot' ? <View style={{ flex: 1, backgroundColor: '#0B0D12' }} /> : <LockScreen mode={phase === 'setup' ? 'setup' : 'unlock'} />}
      </Modal>
    </SafeAreaProvider>
  );
}
