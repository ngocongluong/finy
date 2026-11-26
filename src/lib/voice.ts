// Talking to Finy. When "always listening" is on, Finy listens for its name -
// also in the background, behind a foreground service with an ongoing
// notification - asks what you need, takes the entry down, and confirms out
// loud. The mic button in the chat starts the same exchange without the name.
//
// Privacy: recognition runs on the phone only (no audio leaves it); only the
// words said after "Finy" are sent to Claude. By voice Finy only takes down
// entries (a cash note or a transaction), locked or not, and never answers
// questions about money: it gets none of the user's data to answer from (see
// voiceEntry in claude.ts). Anything else is done in the app.
//
// Timing: React Native pauses JavaScript timers while the app is in the
// background, so every wait here goes through FinyVoice.sleep (native).
import type Anthropic from '@anthropic-ai/sdk';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { create } from 'zustand';
import FinyVoice from '../../modules/finy-voice';
import { voiceEntry } from './claude';
import { uid } from './format';
import { getVoicePref, hasPin, setVoicePref } from './security';
import { useStore } from './store';
import { asksBack, findWake, isRequest, speakable } from './voiceText';

export type VoiceStatus = 'off' | 'listening' | 'asking' | 'command' | 'working' | 'speaking';

interface VoiceState {
  status: VoiceStatus;
  /** Listening for "Finy" all the time (the setting is on and listening started). */
  always: boolean;
  /** What was heard of the current request (live while it is being said). */
  heard: string;
  /** Finy's last answer. */
  reply: string;
  /** Why listening could not start, or stopped. */
  error: string | null;
}

export const useVoice = create<VoiceState>(() => ({ status: 'off', always: false, heard: '', reply: '', error: null }));
const setV = (p: Partial<VoiceState>) => {
  if (p.status && p.status !== useVoice.getState().status) log(`status ${p.status}`);
  useVoice.setState(p);
};
/** Steps and error codes only, never what was said: enough to follow an exchange in logcat. */
const log = (msg: string) => console.log(`[finy] voice ${msg}`);

const LANG = 'vi-VN';
/** Google's on-device recognizer (Android System Intelligence). */
const ON_DEVICE = 'com.google.android.as';
const ASK = 'Dạ, Finy nghe. Bạn cần ghi gì?';
const LISTEN_TITLE = 'Finy đang nghe';
const LISTEN_TEXT = 'Gọi “Finy” để nhờ ghi chép · chạm để mở Finy';

const sleep = (ms: number): Promise<void> => (FinyVoice ? FinyVoice.sleep(ms) : new Promise((r) => setTimeout(r, ms)));
const background = () => AppState.currentState !== 'active';

type Kind = 'wake' | 'command';
let session: Kind | null = null; // what the running recognition is for
let running = false; // between start() and its 'end' event
let next: Kind | null = null; // to start once the running recognition has ended
let failures = 0; // recognitions in a row that ended without hearing anything
let said = ''; // finished sentences of the request being said
let saying = ''; // the sentence being said right now
let tick = 0; // bumped by every result: a pending wait that sees a newer tick gives up
let wakeRest: string | null = null; // the name was heard in this sentence; what followed it so far
let exchange = 0; // bumped when an exchange is cancelled: its pending steps give up
type Params = Anthropic.Beta.BetaMessageParam;
// Finy asked something back: the next request continues the same exchange.
let conversation: { messages: Params[]; turns: number } | null = null;
let ready = false;

/** Registers the event listeners, once. */
function init() {
  if (ready) return;
  ready = true;
  ExpoSpeechRecognitionModule.addListener('result', (e) => onResult(e.results[0]?.transcript ?? '', e.isFinal));
  ExpoSpeechRecognitionModule.addListener('error', (e) => onError(e.error));
  ExpoSpeechRecognitionModule.addListener('end', onEnd);
  // "Tắt" on the listening notification.
  FinyVoice?.addListener('onStopRequested', () => {
    turnOff().catch(() => undefined);
  });
}

// ---- the recognizer: one recognition at a time ----

function listen(kind: Kind) {
  next = kind;
  if (running) ExpoSpeechRecognitionModule.abort(); // its 'end' starts `next`
  else begin();
}

function begin() {
  const kind = next;
  next = null;
  if (!kind || running) return;
  session = kind;
  running = true;
  said = '';
  saying = '';
  wakeRest = null;
  log(`listen ${kind}`);
  try {
    ExpoSpeechRecognitionModule.start({
      lang: LANG,
      interimResults: true,
      // Continuous: no start/stop beep, and the app records the microphone itself,
      // which the foreground service allows in the background.
      continuous: true,
      maxAlternatives: 1,
      requiresOnDeviceRecognition: true,
      contextualStrings: ['Finy', 'Finy ơi'],
    });
  } catch {
    running = false;
    session = null;
    failures++;
    if (kind === 'wake') retryWake();
  }
}

function halt() {
  next = null;
  if (running) ExpoSpeechRecognitionModule.abort();
}

/** Starts listening for the name again after a pause that grows while nothing works. */
function retryWake() {
  const delay = failures ? Math.min(30_000, 500 * 2 ** Math.min(failures, 6)) : 250;
  next = 'wake';
  sleep(delay).then(() => {
    if (next === 'wake' && !running && useVoice.getState().always && useVoice.getState().status === 'listening') begin();
  });
}

function onResult(text: string, final: boolean) {
  if (session === 'wake') {
    if (text) failures = 0;
    const w = text ? findWake(text) : null;
    if (w) wakeRest = w.rest;
    // The sentence ended. The recognizer often finishes a lone "Finy" with an empty
    // result, so what the earlier partial results heard counts.
    if (final && wakeRest !== null) {
      const rest = wakeRest;
      wakeRest = null;
      ++tick;
      log(`wake${isRequest(rest) ? ' with request' : ''}`);
      if (isRequest(rest)) handle(rest);
      else ask();
      return;
    }
    if (!w) return;
    // The name was heard: if the sentence never ends, ask anyway.
    const t = ++tick;
    sleep(2500).then(() => {
      if (t === tick && session === 'wake' && wakeRest !== null) {
        wakeRest = null;
        log('wake (no end of sentence)');
        ask();
      }
    });
    return;
  }
  if (!text) return;
  failures = 0;
  const t = ++tick;
  if (session === 'command') {
    if (final) {
      said = `${said} ${text}`.trim();
      saying = '';
    } else saying = text;
    setV({ heard: `${said} ${saying}`.trim() });
    // A finished sentence and then a moment of silence: the request is complete.
    if (final) {
      sleep(1300).then(() => {
        if (t === tick && session === 'command' && useVoice.getState().status === 'command') handle(said);
      });
    }
  }
}

function onError(code: string) {
  log(`error ${code}`);
  // Stopped on purpose (a new recognition, or an exchange): not a failure.
  if (code === 'aborted') return;
  if (code === 'not-allowed') turnOff('Finy chưa được phép dùng micro.').catch(() => undefined);
  else if (code === 'language-not-supported' || code === 'service-not-allowed') {
    turnOff('Máy chưa có gói nhận dạng tiếng Việt ngay trên máy. Bật lại để tải.').catch(() => undefined);
  } else failures++;
  // Everything else (silence, microphone busy, interrupted…) ends the recognition; 'end' takes over.
}

function onEnd() {
  const was = session;
  running = false;
  session = null;
  if (next) {
    sleep(150).then(begin);
    return;
  }
  const v = useVoice.getState();
  if (was === 'wake' && v.always && v.status === 'listening') retryWake();
  else if (was === 'command' && v.status === 'command') {
    // It stopped before the request was finished (a long silence, an error).
    const text = `${said} ${saying}`.trim();
    if (text) handle(text);
    else nothingHeard();
  }
}

// ---- the exchange ----

/**
 * Reads text aloud; resolves when done, or after a while if the voice engine
 * does not answer. Speech goes through Finy's own module, which reconnects to
 * the voice engine when Android stopped it in the background.
 */
function say(text: string): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    if (FinyVoice) {
      FinyVoice.speak(text, LANG).then(
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
    // Only if the voice engine never answers: it can take a few seconds to start, and
    // listening again over the answer would cut it off.
    sleep(Math.min(60_000, 8000 + text.length * 150)).then(finish);
  });
}

/** Asks what the user needs, then listens for the request. */
async function ask() {
  const ex = exchange;
  ++tick;
  halt();
  setV({ status: 'asking', heard: '', reply: '' });
  if (background()) FinyVoice?.showPrompt('Finy', ASK);
  await say(ASK);
  if (ex !== exchange) return;
  listenForRequest();
}

function listenForRequest() {
  setV({ status: 'command', heard: '' });
  listen('command');
  // Nothing said at all: give up after a while.
  const t = ++tick;
  sleep(12_000).then(() => {
    if (t === tick && useVoice.getState().status === 'command') nothingHeard();
  });
}

async function nothingHeard() {
  const ex = exchange;
  ++tick;
  halt();
  conversation = null;
  setV({ status: 'speaking', reply: 'Mình chưa nghe rõ.' });
  await say('Mình chưa nghe rõ.');
  if (ex === exchange) resume();
}

/** Does what was asked and answers. */
async function handle(text: string) {
  const ex = exchange;
  ++tick;
  halt();
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
  if (asksBack(reply) && conversation && conversation.turns < 3) listenForRequest();
  else {
    conversation = null;
    resume();
  }
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

/** After an exchange: back to listening for the name, or off. */
function resume() {
  if (useVoice.getState().always) {
    setV({ status: 'listening' });
    listen('wake');
  } else setV({ status: 'off' });
}

// ---- turning it on and off ----

/** Whether Vietnamese can be recognized on the phone; otherwise why not (and the download is started). */
async function vietnameseReady(): Promise<true | string> {
  if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) return 'Máy chưa bật dịch vụ nhận dạng giọng nói của Google.';
  if (!ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) return 'Máy không nhận dạng giọng nói ngay trên máy được.';
  const { installedLocales } = await ExpoSpeechRecognitionModule.getSupportedLocales({ androidRecognitionServicePackage: ON_DEVICE }).catch(() => ({
    installedLocales: [] as string[],
  }));
  if (installedLocales.some((l) => l.toLowerCase().startsWith('vi'))) return true;
  const r = await ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({ locale: LANG }).catch(() => null);
  if (r?.status === 'download_success') return true;
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

/** Starts the background service and listening for the name. Only while the app is on screen. */
function startAlways(): string | null {
  if (!FinyVoice) return 'Bản Finy này chưa có phần nghe khi chạy nền.';
  try {
    FinyVoice.startListening(LISTEN_TITLE, LISTEN_TEXT);
  } catch (e) {
    // Usually: Finy was not on screen yet (e.g. the fingerprint prompt covered it). It is
    // tried again each time Finy comes on screen.
    log(`service not started: ${e instanceof Error ? e.name : 'error'}`);
    return `Android chưa cho Finy nghe khi chạy nền: ${e instanceof Error ? e.message : String(e)}`;
  }
  // Already listening (the app came on screen twice in a row): keep the running recognition,
  // but start one now if it is only waiting to retry.
  const wasOn = useVoice.getState().always;
  setV({ always: true, error: null });
  if (!wasOn || (!running && useVoice.getState().status === 'listening')) {
    failures = 0;
    setV({ status: 'listening' });
    listen('wake');
  }
  return null;
}

/** Turns "always listening" on (from Settings). Returns why it could not, or null. */
export async function turnOn(): Promise<string | null> {
  init();
  const err = (await permissions()) ?? (await vietnameseReady().then((r) => (r === true ? null : r)));
  if (err) {
    setV({ error: err });
    return err;
  }
  await setVoicePref(true);
  const started = startAlways();
  if (started) setV({ error: started });
  return started;
}

/** Turns "always listening" off (Settings, the notification, or an error). */
export async function turnOff(error: string | null = null): Promise<void> {
  exchange++;
  ++tick;
  conversation = null;
  halt();
  FinyVoice?.stopSpeaking();
  FinyVoice?.stopListening();
  setV({ always: false, status: 'off', error });
  await setVoicePref(false);
}

/** When Finy comes on screen: starts listening again if it is on but not running (e.g. after Android closed Finy). */
export async function resumeVoice(): Promise<void> {
  if (!(await getVoicePref())) return;
  init();
  if (useVoice.getState().always && FinyVoice?.isListening()) return;
  const mic = await ExpoSpeechRecognitionModule.getPermissionsAsync();
  if (!mic.granted) {
    await turnOff('Finy không còn quyền dùng micro.');
    return;
  }
  const err = startAlways();
  if (err) setV({ error: err });
}

/** The mic button: Finy asks what you need right away (no need to say its name). */
export async function talk(): Promise<void> {
  init();
  const s = useVoice.getState().status;
  if (s !== 'off' && s !== 'listening') return;
  const err = (await permissions()) ?? (await vietnameseReady().then((r) => (r === true ? null : r)));
  if (err) {
    setV({ error: err });
    return;
  }
  setV({ error: null });
  ask();
}

/** Stops the current exchange (the ✕ on the banner); listening for the name goes on. */
export function cancelTalk() {
  exchange++;
  ++tick;
  conversation = null;
  halt();
  FinyVoice?.stopSpeaking();
  FinyVoice?.hidePrompt();
  resume();
}
