// Finy's own Android module (see android/): the background listening service,
// answer notifications, and a delay that runs in the background too.
import { NativeModule, requireOptionalNativeModule } from 'expo';

type Events = {
  /** The user tapped "Tắt" on the listening notification; the service has stopped. */
  onStopRequested: () => void;
};

declare class FinyVoiceModule extends NativeModule<Events> {
  /** Starts the listening service (only allowed while the app is in the foreground); updates it when running. */
  startListening(title: string, text: string): void;
  updateListening(title: string, text: string): void;
  stopListening(): void;
  isListening(): boolean;
  /** Whether Finy is left out of battery optimization. */
  ignoresBatteryOptimizations(): boolean;
  /** Android's dialog to let Finy run in the background without limits. */
  requestIgnoreBatteryOptimizations(): void;
  /** Heads-up notification with Finy's question or answer. */
  showPrompt(title: string, text: string): void;
  hidePrompt(): void;
  /** Resolves after `ms`, also while the app is in the background (JS timers are paused then). */
  sleep(ms: number): Promise<void>;
  /**
   * Reads text aloud (reconnecting to the voice engine if Android stopped it); true when
   * spoken to the end. voice: a name from voices(), null for the default; pitch and rate: 1 = normal.
   */
  speak(text: string, lang: string, voice: string | null, pitch: number, rate: number): Promise<boolean>;
  /** The voice engine's voices for a language. */
  voices(lang: string): Promise<{ name: string; quality: number; network: boolean; installed: boolean }[]>;
  stopSpeaking(): void;
}

/** null outside Android builds that include the module (tests, other platforms). */
const FinyVoice = requireOptionalNativeModule<FinyVoiceModule>('FinyVoice');
export default FinyVoice;
