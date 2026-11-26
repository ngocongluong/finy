// App lock: 6-digit PIN + fingerprint, wrong-PIN lockout, database key custody.
// Everything here is stored in expo-secure-store (Android Keystore backed).
import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const K_SALT = 'finy_pin_salt';
const K_HASH = 'finy_pin_hash';
const K_DBKEY = 'finy_db_key';
const K_FAILS = 'finy_pin_fails';
const K_BIO = 'finy_biometric';
const K_VOICE = 'finy_voice_always';
const K_VOICE_STYLE = 'finy_voice_style';
const K_BATTERY_ASKED = 'finy_battery_asked';
const K_VOICE_PRINT = 'finy_voice_print';

export const PIN_LENGTH = 6;
const HASH_ROUNDS = 400;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPin(pin: string, salt: string): Promise<string> {
  let h = `${salt}:${pin}`;
  for (let i = 0; i < HASH_ROUNDS; i++) {
    h = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${h}`);
  }
  return h;
}

export async function hasPin(): Promise<boolean> {
  return (await SecureStore.getItemAsync(K_HASH)) !== null;
}

export async function setPin(pin: string): Promise<void> {
  const salt = toHex(await Crypto.getRandomBytesAsync(16));
  await SecureStore.setItemAsync(K_SALT, salt);
  await SecureStore.setItemAsync(K_HASH, await hashPin(pin, salt));
  await SecureStore.deleteItemAsync(K_FAILS);
}

interface FailState {
  count: number;
  lockedUntil: number;
}

async function readFails(): Promise<FailState> {
  const raw = await SecureStore.getItemAsync(K_FAILS);
  if (!raw) return { count: 0, lockedUntil: 0 };
  try {
    return JSON.parse(raw) as FailState;
  } catch {
    return { count: 0, lockedUntil: 0 };
  }
}

/** Seconds the keypad stays disabled after `count` consecutive wrong PINs. */
function lockoutSeconds(count: number): number {
  if (count < 5) return 0;
  return Math.min(30 * Math.pow(2, count - 5), 3600);
}

export async function lockedForSeconds(): Promise<number> {
  const f = await readFails();
  return Math.max(0, Math.ceil((f.lockedUntil - Date.now()) / 1000));
}

export type PinResult = { ok: true } | { ok: false; waitSec: number; attempts: number };

export async function verifyPin(pin: string): Promise<PinResult> {
  const fails = await readFails();
  const wait = Math.ceil((fails.lockedUntil - Date.now()) / 1000);
  if (wait > 0) return { ok: false, waitSec: wait, attempts: fails.count };

  const salt = await SecureStore.getItemAsync(K_SALT);
  const stored = await SecureStore.getItemAsync(K_HASH);
  if (salt && stored && (await hashPin(pin, salt)) === stored) {
    await SecureStore.deleteItemAsync(K_FAILS);
    return { ok: true };
  }
  const count = fails.count + 1;
  const waitSec = lockoutSeconds(count);
  await SecureStore.setItemAsync(K_FAILS, JSON.stringify({ count, lockedUntil: Date.now() + waitSec * 1000 }));
  return { ok: false, waitSec, attempts: count };
}

export async function biometricAvailable(): Promise<boolean> {
  return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
}

/**
 * Whether the user allows fingerprint unlock. Kept outside the encrypted
 * database because the lock screen needs it before the database is opened.
 */
export async function getBiometricPref(): Promise<boolean> {
  return (await SecureStore.getItemAsync(K_BIO)) !== '0';
}

export async function setBiometricPref(on: boolean): Promise<void> {
  await SecureStore.setItemAsync(K_BIO, on ? '1' : '0');
}

/**
 * Whether Finy listens for its name all the time. Kept outside the encrypted
 * database, like the fingerprint setting, because listening starts before the
 * app is unlocked. Off unless turned on.
 */
export async function getVoicePref(): Promise<boolean> {
  return (await SecureStore.getItemAsync(K_VOICE)) === '1';
}

export async function setVoicePref(on: boolean): Promise<void> {
  await SecureStore.setItemAsync(K_VOICE, on ? '1' : '0');
}

/** How Finy sounds: a voice of the phone's voice engine (null = its default), pitch and rate (1 = normal). */
export interface VoiceStyle {
  voice: string | null;
  pitch: number;
  rate: number;
}

export const DEFAULT_VOICE_STYLE: VoiceStyle = { voice: null, pitch: 1, rate: 1 };

/** Kept with the other voice setting: Finy speaks before the app is unlocked too. */
export async function getVoiceStyle(): Promise<VoiceStyle> {
  try {
    const raw = JSON.parse((await SecureStore.getItemAsync(K_VOICE_STYLE)) ?? 'null') as Partial<VoiceStyle> | null;
    const num = (n: unknown, d: number) => (typeof n === 'number' && n >= 0.5 && n <= 2 ? n : d);
    return { voice: typeof raw?.voice === 'string' ? raw.voice : null, pitch: num(raw?.pitch, 1), rate: num(raw?.rate, 1) };
  } catch {
    return DEFAULT_VOICE_STYLE;
  }
}

/**
 * The owner's voice print (see voicePrint.ts): numbers describing the voice,
 * no recording. Kept in the Keystore-backed store like the PIN, because Finy
 * checks voices before it is unlocked.
 */
export async function getVoicePrintRaw(): Promise<unknown> {
  try {
    return JSON.parse((await SecureStore.getItemAsync(K_VOICE_PRINT)) ?? 'null');
  } catch {
    return null;
  }
}

export async function setVoicePrintRaw(print: unknown | null): Promise<void> {
  if (print === null) await SecureStore.deleteItemAsync(K_VOICE_PRINT);
  else await SecureStore.setItemAsync(K_VOICE_PRINT, JSON.stringify(print));
}

/** Finy asked once to run in the background without limits (it does not ask again by itself). */
export async function batteryAsked(): Promise<boolean> {
  return (await SecureStore.getItemAsync(K_BATTERY_ASKED)) === '1';
}

export async function setBatteryAsked(): Promise<void> {
  await SecureStore.setItemAsync(K_BATTERY_ASKED, '1');
}

export async function setVoiceStyle(style: VoiceStyle): Promise<void> {
  await SecureStore.setItemAsync(K_VOICE_STYLE, JSON.stringify(style));
}

// The fingerprint request waiting for an answer, if any. Android drops a request made while
// the app is in the background without answering it, and the native module then refuses
// every later request ("app_cancel") until that one is cancelled.
let asking: Promise<LocalAuthentication.LocalAuthenticationResult> | null = null;

// The unlock attempt in progress (checks, prompt, answer) and when it started.
let flight: { p: Promise<boolean>; at: number } | null = null;

/** An unlock attempt is waiting for an answer (the prompt is coming up or showing, or got stuck). */
export function biometricPending(): boolean {
  return flight !== null;
}

/** Clears a request that is stuck, then gives AndroidX time to take its old prompt down. */
async function resetBiometric(): Promise<void> {
  await LocalAuthentication.cancelAuthenticate().catch(() => undefined);
  await new Promise((r) => setTimeout(r, 400));
}

function askFingerprint(): Promise<LocalAuthentication.LocalAuthenticationResult> {
  const p = LocalAuthentication.authenticateAsync({
    promptMessage: 'Mở khoá Finy',
    cancelLabel: 'Dùng mã PIN',
    disableDeviceFallback: true,
  });
  asking = p;
  const done = () => {
    if (asking === p) asking = null;
  };
  p.then(done, done);
  return p;
}

/**
 * Asks for the fingerprint; true when it matched. Call it only while the app
 * is in the foreground. Asked again while a prompt is just coming up, it waits
 * for that same prompt (cancelling it would make the prompt blink and miss the
 * finger). An attempt older than that and still unanswered never showed (a
 * showing prompt covers the button): it is cleared and asked again, as is one
 * the native side refuses because it still waits for an earlier request.
 */
export function biometricUnlock(): Promise<boolean> {
  if (flight && Date.now() - flight.at < 1500) return flight.p;
  const stale = flight !== null;
  const p = (async () => {
    if (!(await getBiometricPref())) return false;
    if ((await lockedForSeconds()) > 0) return false;
    try {
      if (stale || asking) await resetBiometric();
      let res = await askFingerprint();
      if (!res.success && res.error === 'app_cancel') {
        await resetBiometric();
        res = await askFingerprint();
      }
      return res.success;
    } catch {
      // No prompt could be shown (no activity): the PIN still works.
      return false;
    }
  })();
  const entry = { p, at: Date.now() };
  flight = entry;
  const done = () => {
    if (flight === entry) flight = null;
  };
  p.then(done, done);
  return p;
}

/** Returns the database key, creating it on first run. */
export async function getDbKey(): Promise<string> {
  let key = await SecureStore.getItemAsync(K_DBKEY);
  if (!key) {
    key = toHex(await Crypto.getRandomBytesAsync(32));
    await SecureStore.setItemAsync(K_DBKEY, key);
  }
  return key;
}
