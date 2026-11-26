// Talking to Finy. Finy's ears (modules/finy-voice, sherpa-onnx on the phone)
// listen for its name - all the time when "always listening" is on, also in
// the background behind a foreground service. When the owner's voice print is
// enrolled, only the owner's voice gets an answer: other voices calling Finy
// are ignored. Then Finy records the request, the phone's Vietnamese speech
// recognizer writes it down, Finy takes the entry down and confirms out loud.
// The mic button in the chat starts the same exchange without the name.
//
// Privacy: the microphone audio stays on the phone (the keyword spotter, the
// voice check and the speech recognizer all run on it; a recorded request is
// deleted as soon as it is written down). Only the words of the request go to
// Claude. By voice Finy only takes entries down (a cash note or a
// transaction) and never answers questions about money (see voiceEntry in
// claude.ts).
//
// Timing: React Native pauses JavaScript timers while the app is in the
// background, so every wait here goes through FinyVoice.sleep (native).
import type Anthropic from '@anthropic-ai/sdk';
import { AudioEncodingAndroid, ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { create } from 'zustand';
import FinyVoice, { type Utterance } from '../../modules/finy-voice';
import { voiceEntry } from './claude';
import { uid } from './format';
import {
  batteryAsked,
  DEFAULT_VOICE_STYLE,
  getVoicePref,
  getVoicePrintRaw,
  getVoiceStyle,
  hasPin,
  setBatteryAsked,
  setVoicePref,
  setVoicePrintRaw,
  setVoiceStyle,
  type VoiceStyle,
} from './security';
import { useStore } from './store';
import { buildPrint, parsePrint, SHORT_MS, verify, type Strictness, type VoicePrint } from './voicePrint';
import { asksBack, findWake, isRequest, speakable } from './voiceText';

export type VoiceStatus = 'off' | 'listening' | 'asking' | 'command' | 'working' | 'speaking' | 'enrolling';

interface VoiceState {
  status: VoiceStatus;
  /** Listening for "Finy" all the time (the setting is on and listening started). */
  always: boolean;
  /** The request being handled. */
  heard: string;
  /** Finy's last answer. */
  reply: string;
  /** Why listening could not start, or stopped. */
  error: string | null;
  /** The owner's voice is enrolled: only it gets an answer. */
  enrolled: boolean;
}

export const useVoice = create<VoiceState>(() => ({ status: 'off', always: false, heard: '', reply: '', error: null, enrolled: false }));
let statusSince = Date.now(); // when the status last changed (the watchdog reads it)
const setV = (p: Partial<VoiceState>) => {
  if (p.status && p.status !== useVoice.getState().status) {
    log(`status ${p.status}`);
    statusSince = Date.now();
  }
  useVoice.setState(p);
};
/** Steps, scores and error codes only, never what was said: enough to follow an exchange in logcat. */
const log = (msg: string) => console.log(`[finy] voice ${msg}`);

const LANG = 'vi-VN';
/** Google's on-device recognizer (Android System Intelligence). */
const ON_DEVICE = 'com.google.android.as';
const ASK = 'Dạ, Finy nghe. Bạn cần ghi gì?';
const NOT_HEARD = 'Mình chưa nghe rõ.';
const LISTEN_TITLE = 'Finy đang nghe';
const LISTEN_TEXT = 'Gọi “Finy” để nhờ ghi chép · chạm để mở Finy';
// Keyword spotter tuning, measured on test recordings: hears "Finy" said several ways, not
// everyday Vietnamese ("phim", "phí", "phải", "cà phê"…).
const KWS_SCORE = 2.0;
const KWS_THRESHOLD = 0.15;
const HINTS = ['Finy', 'tiền mặt', 'nghìn', 'triệu', 'chuyển khoản'];

const sleep = (ms: number): Promise<void> => (FinyVoice ? FinyVoice.sleep(ms) : new Promise((r) => setTimeout(r, ms)));
const background = () => AppState.currentState !== 'active';

type Params = Anthropic.Beta.BetaMessageParam;
let exchange = 0; // bumped when an exchange is cancelled: its pending steps give up
let busy = false; // an exchange (or an enrollment) is under way
// Finy asked something back: the next request continues the same exchange.
let conversation: { messages: Params[]; turns: number } | null = null;
let ready = false;
let earsFailures = 0;
// How Finy sounds (Settings); read once, then kept here.
let style: VoiceStyle | null = null;
const currentStyle = async (): Promise<VoiceStyle> => (style ??= await getVoiceStyle().catch(() => DEFAULT_VOICE_STYLE));
// The owner's voice print; undefined until read.
let print: VoicePrint | null | undefined;

/** Registers the event listeners, once. */
function init() {
  if (ready) return;
  ready = true;
  ExpoSpeechRecognitionModule.addListener('result', (e) => {
    const text = e.results[0]?.transcript?.trim();
    if (transcript && e.isFinal && text) transcript.parts.push(text);
  });
  ExpoSpeechRecognitionModule.addListener('error', (e) => log(`recognizer error ${e.error}`));
  ExpoSpeechRecognitionModule.addListener('end', () => transcript?.done(transcript.parts.join(' ')));
  FinyVoice?.addListener('onWake', () => {
    onWake().catch((e) => log(`wake failed: ${e instanceof Error ? e.name : 'error'}`));
  });
  FinyVoice?.addListener('onEarsError', (e) => {
    log(`ears stopped: ${e.message}`);
    if (useVoice.getState().always) retryEars();
  });
  // "Tắt" on the listening notification.
  FinyVoice?.addListener('onStopRequested', () => {
    turnOff().catch(() => undefined);
  });
}

// ---- the ears ----

async function startEars(): Promise<string | null> {
  if (!FinyVoice) return 'Bản Finy này chưa có phần nghe.';
  if (FinyVoice.earsRunning()) return null;
  try {
    await FinyVoice.earsStart(KWS_SCORE, KWS_THRESHOLD);
    earsFailures = 0;
    log('ears on');
    return null;
  } catch (e) {
    log(`ears failed: ${e instanceof Error ? e.message : 'error'}`);
    return 'Không mở được micro. Có thể app khác đang dùng micro.';
  }
}

/** Opens the microphone again after a failure, waiting longer each time (up to 30 s). */
async function retryEars() {
  const delay = Math.min(30_000, 1000 * 2 ** Math.min(earsFailures++, 5));
  await sleep(delay);
  if (useVoice.getState().always && !FinyVoice?.earsRunning() && !busy) await startEars();
}

const discard = (u: Utterance | null | undefined) => {
  if (u?.path) FinyVoice?.deleteFile(u.path);
};

/** Writes down a recorded utterance with the phone's Vietnamese recognizer (on the phone, no network). */
let transcript: { parts: string[]; done: (text: string) => void } | null = null;
function transcribe(path: string, speechMs: number): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (text: string) => {
      if (settled) return;
      settled = true;
      transcript = null;
      resolve(text.trim());
    };
    transcript = { parts: [], done };
    try {
      ExpoSpeechRecognitionModule.start({
        lang: LANG,
        interimResults: false,
        continuous: true,
        maxAlternatives: 1,
        requiresOnDeviceRecognition: true,
        contextualStrings: HINTS,
        audioSource: { uri: `file://${path}`, audioChannels: 1, audioEncoding: AudioEncodingAndroid.ENCODING_PCM_16BIT, sampleRate: 16000 },
      });
    } catch {
      done('');
      return;
    }
    // It normally ends by itself once the file is read; if not, stop it and keep what it wrote.
    sleep(Math.min(30_000, 5000 + speechMs * 2)).then(() => {
      if (settled) return;
      log('recognizer slow: stopped');
      ExpoSpeechRecognitionModule.stop();
      sleep(2000).then(() => {
        if (!settled && transcript) done(transcript.parts.join(' '));
      });
    });
  });
}

// ---- the owner's voice ----

async function loadPrint(): Promise<VoicePrint | null> {
  if (print === undefined) print = parsePrint(await getVoicePrintRaw());
  setV({ enrolled: !!print });
  return print;
}

/** Whether this voice may give Finy a request: anyone until a voice is enrolled, then only the owner. */
async function ownerSpeaking(u: Utterance, what: string): Promise<boolean> {
  const p = await loadPrint();
  if (!p) return true;
  if (!u.embedding) {
    log(`${what}: too short to check the voice`);
    return false;
  }
  const r = verify(p, u.embedding, u.speechMs);
  log(`${what}: ${r.ok ? 'owner' : 'not the owner'} (${r.score} vs ${r.threshold}, ${u.speechMs} ms)`);
  return r.ok;
}

// ---- the exchange ----

/**
 * Reads text aloud; resolves when done, or after a while if the voice engine
 * does not answer. The ears are muted meanwhile: Finy must not hear itself.
 */
async function say(text: string, styleOverride?: VoiceStyle): Promise<void> {
  FinyVoice?.earsMute(true);
  try {
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      if (FinyVoice) {
        const engine = FinyVoice;
        (styleOverride ? Promise.resolve(styleOverride) : currentStyle())
          .then((s) => engine.speak(text, LANG, s.voice, s.pitch, s.rate))
          .then(
            (ok) => {
              if (!ok) log('speak failed');
              finish();
            },
            () => {
              log('speak failed');
              finish();
            },
          );
      } else finish();
      // Only if the voice engine never answers.
      sleep(Math.min(60_000, 8000 + text.length * 150)).then(finish);
    });
    // The end of Finy's voice still in the room.
    await sleep(300);
  } finally {
    FinyVoice?.earsMute(false);
  }
}

async function tell(text: string) {
  setV({ status: 'speaking', reply: text });
  if (background()) FinyVoice?.showPrompt('Finy', text);
  await say(text);
}

/** "Finy" was heard. */
async function onWake() {
  if (busy || useVoice.getState().status !== 'listening' || !FinyVoice) return;
  busy = true;
  const ex = exchange;
  try {
    log('wake');
    // The call, and whatever follows it in the same breath (the name was said up to ~1.6 s ago).
    const u = await FinyVoice.earsRecord(12_000, 1500, 1800, 800);
    if (ex !== exchange || !u?.path) {
      discard(u);
      if (!u?.path) log('wake: nothing recorded');
      return;
    }
    // Another voice calling Finy gets no answer at all.
    if (!(await ownerSpeaking(u, 'call'))) {
      discard(u);
      return;
    }
    let request = '';
    if (u.speechMs >= SHORT_MS) {
      // Probably more than the name: "Finy ơi, ghi tiền mặt 50 nghìn".
      setV({ status: 'command', heard: '' });
      const text = await transcribe(u.path, u.speechMs);
      const w = findWake(text);
      request = w ? w.rest : text;
      if (!isRequest(request)) request = '';
    }
    discard(u);
    if (ex !== exchange) return;
    if (request) await handle(request);
    else await askAndHandle();
  } finally {
    busy = false;
    if (ex === exchange) resumeIdle();
  }
}

/** Asks what the user needs, then listens. */
async function askAndHandle() {
  const ex = exchange;
  setV({ status: 'asking', heard: '', reply: '' });
  if (background()) FinyVoice?.showPrompt('Finy', ASK);
  await say(ASK);
  if (ex !== exchange) return;
  await listenAndHandle();
}

/** Records the request, checks the voice, writes it down and does it. */
async function listenAndHandle() {
  if (!FinyVoice) return;
  const ex = exchange;
  setV({ status: 'command', heard: '' });
  const u = await FinyVoice.earsRecord(15_000, 8000, 0, 1000);
  if (ex !== exchange) return discard(u);
  if (!u?.path) return tell(NOT_HEARD);
  if (!(await ownerSpeaking(u, 'request'))) return discard(u);
  const text = await transcribe(u.path, u.speechMs);
  discard(u);
  if (ex !== exchange) return;
  if (!text) return tell(NOT_HEARD);
  await handle(text);
}

/** Does what was asked and answers. */
async function handle(text: string) {
  const ex = exchange;
  setV({ status: 'working', heard: text, reply: '' });
  if (background()) FinyVoice?.showPrompt('Finy', `“${text}” · đang làm…`);
  let reply: string;
  try {
    reply = await act(text);
  } catch (e) {
    log(`request failed: ${e instanceof Error ? e.name : 'error'}`);
    reply = 'Finy gặp lỗi khi làm việc này. Bạn thử lại sau nhé.';
  }
  if (ex !== exchange) return;
  setV({ status: 'speaking', reply });
  if (background()) FinyVoice?.showPrompt('Finy', reply);
  await say(speakable(reply));
  if (ex !== exchange) return;
  // Finy asked something back: listen for the answer (a few times at most).
  if (asksBack(reply) && conversation && conversation.turns < 3) await listenAndHandle();
}

/**
 * Runs one spoken request. By voice Finy only takes entries down (a cash note
 * or a transaction), whether it is locked or open, and never answers questions
 * about money: whoever is near the phone hears the answer.
 */
async function act(text: string): Promise<string> {
  if (!(await hasPin())) return 'Bạn mở Finy và tạo mã PIN trước nhé.';
  // Loads the encrypted data if Finy has not been unlocked since it started; the lock screen stays.
  await useStore.getState().ensureLoaded();
  const r = await voiceEntry(text, conversation?.messages ?? []);
  log(`request: ${r.actions.length} added`);
  conversation = { messages: r.messages, turns: (conversation?.turns ?? 0) + 1 };
  // Shown in the chat afterwards, so what was taken down by voice can be checked.
  const now = useStore.getState();
  now.setChat(
    [
      ...now.chat,
      { id: uid(), role: 'user', text: `🎙 ${text}` },
      { id: uid(), role: 'assistant', text: r.reply, actions: r.actions.length ? r.actions : undefined },
    ],
    now.apiHistory,
    now.apiHistoryKey ?? '',
  );
  return r.reply;
}

/** After an exchange: back to listening for the name, or the ears off. */
function resumeIdle() {
  conversation = null;
  if (useVoice.getState().always) {
    setV({ status: 'listening' });
    if (!FinyVoice?.earsRunning()) startEars();
  } else {
    setV({ status: 'off' });
    FinyVoice?.earsStop();
  }
}

// ---- turning it on and off ----

/** Whether Vietnamese can be recognized on the phone; otherwise why not (and the download is started). */
async function vietnameseReady(): Promise<string | null> {
  if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) return 'Máy chưa bật dịch vụ nhận dạng giọng nói của Google.';
  if (!ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) return 'Máy không nhận dạng giọng nói ngay trên máy được.';
  const { installedLocales } = await ExpoSpeechRecognitionModule.getSupportedLocales({ androidRecognitionServicePackage: ON_DEVICE }).catch(() => ({
    installedLocales: [] as string[],
  }));
  if (installedLocales.some((l) => l.toLowerCase().startsWith('vi'))) return null;
  const r = await ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({ locale: LANG }).catch(() => null);
  if (r?.status === 'download_success') return null;
  return 'Đang tải gói tiếng Việt để nhận dạng ngay trên máy (có thể cần Wi‑Fi). Tải xong thì bật lại.';
}

/** Microphone (and notifications, for the listening notification) permission. */
async function permissions(): Promise<string | null> {
  const mic = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  if (!mic.granted) return 'Finy cần quyền dùng micro.';
  if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
    await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS').catch(() => undefined);
  }
  return null;
}

/**
 * Every 30 seconds while "always listening" is on: the microphone is opened
 * again if it closed, and an exchange stuck for over 2 minutes is dropped.
 * Runs on the native delay, so also in the background.
 */
let watching = false;
async function watchdog() {
  if (watching) return;
  watching = true;
  try {
    while (useVoice.getState().always) {
      await sleep(30_000);
      const v = useVoice.getState();
      if (!v.always) break;
      if (v.status === 'listening') {
        if (!busy && !FinyVoice?.earsRunning()) {
          log('watchdog: opening the microphone again');
          await startEars();
        }
      } else if (v.status !== 'off' && v.status !== 'enrolling' && Date.now() - statusSince > 120_000) {
        log(`watchdog: dropped an exchange stuck in ${v.status}`);
        cancelTalk();
      }
    }
  } finally {
    watching = false;
  }
}

/** Whether Android may put Finy to sleep in the background (battery optimization). */
export function batteryLimited(): boolean {
  return !!FinyVoice && !FinyVoice.ignoresBatteryOptimizations();
}

/** Android's dialog to let Finy run in the background without limits. */
export function askUnlimitedBattery() {
  try {
    FinyVoice?.requestIgnoreBatteryOptimizations();
  } catch {
    // Some phones have no such dialog: the battery settings button still works.
  }
}

/** Starts the background service and the ears. Only while the app is on screen. */
async function startAlways(): Promise<string | null> {
  if (!FinyVoice) return 'Bản Finy này chưa có phần nghe khi chạy nền.';
  try {
    FinyVoice.startListening(LISTEN_TITLE, LISTEN_TEXT);
  } catch (e) {
    // Usually: Finy was not on screen yet (e.g. the fingerprint prompt covered it). It is
    // tried again each time Finy comes on screen.
    log(`service not started: ${e instanceof Error ? e.name : 'error'}`);
    return `Android chưa cho Finy nghe khi chạy nền: ${e instanceof Error ? e.message : String(e)}`;
  }
  setV({ always: true, error: null });
  if (useVoice.getState().status === 'off') setV({ status: 'listening' });
  await loadPrint();
  const err = busy ? null : await startEars();
  if (err) {
    setV({ error: err });
    retryEars();
  }
  watchdog();
  return err;
}

/** Turns "always listening" on (from Settings). Returns why it could not, or null. */
export async function turnOn(): Promise<string | null> {
  init();
  const err = (await permissions()) ?? (await vietnameseReady());
  if (err) {
    setV({ error: err });
    return err;
  }
  await setVoicePref(true);
  const started = await startAlways();
  if (started) setV({ error: started });
  // Without this Android puts Finy to sleep after a while with the screen off.
  else if (batteryLimited()) {
    await setBatteryAsked();
    askUnlimitedBattery();
  }
  return started;
}

/** Turns "always listening" off (Settings, the notification, or an error). */
export async function turnOff(error: string | null = null): Promise<void> {
  exchange++;
  conversation = null;
  FinyVoice?.stopSpeaking();
  if (useVoice.getState().status !== 'enrolling') FinyVoice?.earsStop();
  FinyVoice?.stopListening();
  setV({ always: false, status: useVoice.getState().status === 'enrolling' ? 'enrolling' : 'off', error });
  await setVoicePref(false);
}

/** When Finy comes on screen: starts listening again if it is on but not running (e.g. after Android closed Finy). */
export async function resumeVoice(): Promise<void> {
  init();
  await loadPrint();
  if (!(await getVoicePref())) return;
  if (useVoice.getState().always && FinyVoice?.isListening() && FinyVoice.earsRunning()) return;
  const mic = await ExpoSpeechRecognitionModule.getPermissionsAsync();
  if (!mic.granted) {
    await turnOff('Finy không còn quyền dùng micro.');
    return;
  }
  const err = await startAlways();
  if (err) setV({ error: err });
  // Listening was turned on before Finy asked about battery optimization: ask once.
  else if (batteryLimited() && !(await batteryAsked())) {
    await setBatteryAsked();
    askUnlimitedBattery();
  }
}

/** The mic button: Finy asks what you need right away (no need to say its name). */
export async function talk(): Promise<void> {
  init();
  const s = useVoice.getState().status;
  if (busy || (s !== 'off' && s !== 'listening')) return;
  const err = (await permissions()) ?? (await vietnameseReady()) ?? (await startEars());
  if (err) {
    setV({ error: err });
    return;
  }
  setV({ error: null });
  busy = true;
  const ex = exchange;
  try {
    await askAndHandle();
  } finally {
    busy = false;
    if (ex === exchange) resumeIdle();
  }
}

/** Stops the current exchange (the ✕ on the banner); listening for the name goes on. */
export function cancelTalk() {
  exchange++;
  conversation = null;
  if (transcript) ExpoSpeechRecognitionModule.abort();
  FinyVoice?.stopSpeaking();
  FinyVoice?.earsMute(false);
  FinyVoice?.hidePrompt();
  busy = false;
  resumeIdle();
}

// ---- enrolling the owner's voice (Settings) ----

export const ENROLL_STEPS: { kind: 'wake' | 'sentence'; say: string }[] = [
  { kind: 'wake', say: 'Finy ơi' },
  { kind: 'wake', say: 'Finy ơi' },
  { kind: 'wake', say: 'Finy ơi' },
  { kind: 'wake', say: 'Finy ơi' },
  { kind: 'wake', say: 'Finy ơi' },
  { kind: 'sentence', say: 'Finy ơi, ghi tiền mặt năm mươi nghìn ăn sáng' },
  { kind: 'sentence', say: 'Hôm nay tôi chi hai trăm nghìn tiền chợ' },
  { kind: 'sentence', say: 'Ghi giúp tôi một triệu tiền điện tháng này' },
];

/** Opens the ears for enrolling; calls to Finy are ignored until it ends. Returns why it could not. */
export async function beginEnrollment(): Promise<string | null> {
  init();
  if (busy) return 'Finy đang bận, thử lại sau chút nhé.';
  const err = (await permissions()) ?? (await startEars());
  if (err) return err;
  busy = true;
  setV({ status: 'enrolling', error: null });
  return null;
}

/** Records one enrollment sample: its speaker embedding, or what went wrong. */
export async function recordSample(kind: 'wake' | 'sentence'): Promise<{ embedding: number[] | null; problem: string | null }> {
  const u = await FinyVoice?.earsRecord(kind === 'wake' ? 4000 : 9000, 7000, 0, 900);
  discard(u);
  if (!u?.path) return { embedding: null, problem: 'Mình chưa nghe thấy gì. Nói lại gần máy hơn nhé.' };
  if (!u.embedding) return { embedding: null, problem: 'Câu hơi ngắn, nói lại nhé.' };
  return { embedding: u.embedding, problem: null };
}

/** Saves the print made from the samples; false when there are too few. Ends the enrollment. */
export async function finishEnrollment(wake: number[][], sentences: number[][]): Promise<boolean> {
  const p = buildPrint(wake, sentences, print?.strictness ?? 'normal');
  if (p) {
    await setVoicePrintRaw(p);
    print = p;
    log(`voice enrolled (thresholds ${p.wakeT} / ${p.voiceT})`);
  }
  endEnrollment();
  setV({ enrolled: !!print });
  return !!p;
}

/** Leaves enrolling (also when cancelled): Finy listens for its name again. */
export function endEnrollment() {
  if (useVoice.getState().status !== 'enrolling') return;
  busy = false;
  resumeIdle();
}

/** Forgets the enrolled voice: anyone can call Finy again. */
export async function forgetVoice(): Promise<void> {
  await setVoicePrintRaw(null);
  print = null;
  setV({ enrolled: false });
}

export async function getVoiceCheck(): Promise<{ enrolled: boolean; strictness: Strictness; at: number }> {
  const p = await loadPrint();
  return { enrolled: !!p, strictness: p?.strictness ?? 'normal', at: p?.at ?? 0 };
}

export async function setStrictness(s: Strictness): Promise<void> {
  const p = await loadPrint();
  if (!p) return;
  print = { ...p, strictness: s };
  await setVoicePrintRaw(print);
}

// ---- Finy's voice (Settings) ----

/** A Vietnamese voice of the phone's voice engine that works offline. */
export interface FinyVoiceOption {
  name: string;
  /** Higher sounds better (Android's 100-500 scale). */
  quality: number;
  /** Its voice data is not downloaded yet (Google speech settings). */
  missing: boolean;
}

/**
 * The Vietnamese voices Finy can speak with. Voices that need the network are
 * left out: they would send what Finy says to Google.
 */
export async function listVoices(): Promise<FinyVoiceOption[]> {
  if (!FinyVoice) return [];
  const all = await FinyVoice.voices(LANG).catch(() => []);
  log(`voices: ${all.map((v) => `${v.name}${v.network ? ' (network)' : ''}${v.installed ? '' : ' (not installed)'}`).join(', ')}`);
  return all.filter((v) => !v.network).map((v) => ({ name: v.name, quality: v.quality, missing: !v.installed }));
}

export const PREVIEW = ASK;

/** Plays a sample in a voice style without saving it. */
export async function previewVoice(s: VoiceStyle): Promise<void> {
  FinyVoice?.stopSpeaking();
  await say(PREVIEW, s);
}

export async function getFinyVoiceStyle(): Promise<VoiceStyle> {
  return currentStyle();
}

export async function saveFinyVoiceStyle(s: VoiceStyle): Promise<void> {
  style = s;
  await setVoiceStyle(s);
}
