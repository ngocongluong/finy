import type { ExpoConfig } from 'expo/config';
import fs from 'fs';
import path from 'path';

// Secrets and personal data are read at BUILD time from gitignored files and
// embedded in the app bundle. They never live in the repository.
//   .credentials        -> Anthropic API key (raw key on a single line)
//   secrets/seed.json   -> optional first-run data (see seed.example.json)
function readText(rel: string): string {
  try {
    return fs.readFileSync(path.join(__dirname, rel), 'utf8').trim();
  } catch {
    return '';
  }
}

function readJson(rel: string): unknown {
  const raw = readText(rel);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${rel} is not valid JSON`);
  }
}

const config: ExpoConfig = {
  name: 'Finy',
  slug: 'finy',
  version: '1.0.0',
  scheme: 'finy',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  backgroundColor: '#0B0D12',
  android: {
    package: 'com.finy.app',
    allowBackup: false,
    adaptiveIcon: {
      backgroundColor: '#0B0D12',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: ['USE_BIOMETRIC', 'USE_FINGERPRINT'],
  },
  plugins: [
    'expo-router',
    ['expo-sqlite', { useSQLCipher: true }],
    'expo-secure-store',
    'expo-font',
    'expo-local-authentication',
    './plugins/withFinyAndroid.js',
  ],
  extra: {
    anthropicKey: readText('.credentials'),
    seed: readJson('secrets/seed.json'),
    // Test builds only: lets adb take screenshots. Never set for the APK you install.
    allowScreenshots: process.env.FINY_ALLOW_SCREENSHOTS === '1',
  },
};

export default config;
