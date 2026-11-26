import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { useUi } from '../../components/ui';

const TABS: { name: string; title: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { name: 'index', title: 'Tổng quan', icon: 'home' },
  { name: 'budget', title: 'Ngân sách', icon: 'wallet' },
  { name: 'transactions', title: 'Giao dịch', icon: 'receipt' },
  { name: 'plan', title: 'Kế hoạch', icon: 'trending-up' },
  { name: 'chat', title: 'Finy', icon: 'sparkles' },
];

export default function TabsLayout() {
  const { c, fs } = useUi();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.card, borderTopColor: c.border },
        tabBarLabelStyle: { fontSize: fs(11), fontWeight: '600' },
        sceneStyle: { backgroundColor: c.bg },
      }}>
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{ title: t.title, tabBarIcon: ({ color, size }) => <Ionicons name={t.icon} size={size} color={typeof color === 'string' ? color : undefined} /> }}
        />
      ))}
    </Tabs>
  );
}
