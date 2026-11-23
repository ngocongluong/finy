import Constants from 'expo-constants';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as ScreenCapture from 'expo-screen-capture';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import React, { useEffect, useMemo } from 'react';
import { Alert, AppState, Modal, View } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LockScreen } from '../components/LockScreen';
import { fmtVND } from '../lib/format';
import * as gmail from '../lib/gmail';
import { creditOverMessage, isSyncing, runSync, shouldAlertCreditOver } from '../lib/hsbc';
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
    // Screenshot test builds (emulator) must never read the real mailbox.
    if (Constants.expoConfig?.extra?.allowScreenshots) return;
    (async () => {
      let { settings } = useStore.getState();
      if (!settings.gmailEmail) {
        // Signed in with Google but the app never stored it (a sign-in whose answer got lost).
        const email = await gmail.existingAccount().catch(() => null);
        if (!email) return;
        useStore.getState().setSettings({ gmailEmail: email, lastSyncTs: null });
        settings = useStore.getState().settings;
      }
      if (isSyncing()) return;
      if (settings.lastSyncTs && Date.now() - settings.lastSyncTs < 30 * 60_000) return;
      // runSync records any failure; the Transactions tab shows it.
      const r = await runSync();
      if (r?.creditOver && (await shouldAlertCreditOver(r.creditOver))) Alert.alert('Chi tín dụng vượt dự chi', creditOverMessage(r.creditOver, fmtVND));
    })();
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
    <KeyboardProvider>
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
    </KeyboardProvider>
  );
}
