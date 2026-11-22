import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import * as ScreenCapture from 'expo-screen-capture';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import React, { useEffect } from 'react';
import { AppState, Modal, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LockScreen } from '../components/LockScreen';
import { autoLockSuspended } from '../lib/lockGuard';
import { useStore } from '../lib/store';

export default function RootLayout() {
  const phase = useStore((s) => s.phase);
  const bg = useStore((s) => s.ui.colors.bg);

  useEffect(() => {
    useStore.getState().boot();
    // FLAG_SECURE: no screenshots, no screen recording, blank preview in the app switcher.
    if (!Constants.expoConfig?.extra?.allowScreenshots) ScreenCapture.preventScreenCaptureAsync().catch(() => {});
  }, []);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(bg).catch(() => {});
  }, [bg]);

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
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: bg }, animation: 'slide_from_right' }} />
      </View>
      {/* A Modal so the lock also covers any sheet that was open when the app was left. */}
      <Modal visible={phase !== 'ready'} animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={() => {}}>
        {phase === 'boot' ? <View style={{ flex: 1, backgroundColor: '#0B0D12' }} /> : <LockScreen mode={phase === 'setup' ? 'setup' : 'unlock'} />}
      </Modal>
    </SafeAreaProvider>
  );
}
