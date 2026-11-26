package expo.modules.finyvoice

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale
import java.util.UUID
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * What Finy's voice needs from Android beyond speech recognition itself:
 * the foreground service that keeps the microphone usable while Finy is in
 * the background (with its ongoing notification), a heads-up notification for
 * Finy's answers, a delay that still runs when the app is in the
 * background (React Native pauses JavaScript timers then), and speech that
 * reconnects to the voice engine when Android has stopped it.
 */
class FinyVoiceModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  private val main = Handler(Looper.getMainLooper())

  // ---- speaking (main thread only) ----
  private var tts: TextToSpeech? = null
  private var ttsReady = false
  private val onTtsReady = mutableListOf<() -> Unit>()
  private val speaking = mutableMapOf<String, Promise>()

  private val progress = object : UtteranceProgressListener() {
    override fun onStart(utteranceId: String) {}

    override fun onDone(utteranceId: String) {
      main.post { speaking.remove(utteranceId)?.resolve(true) }
    }

    @Deprecated("Deprecated in Java")
    override fun onError(utteranceId: String) {
      main.post { speaking.remove(utteranceId)?.resolve(false) }
    }

    override fun onError(utteranceId: String, errorCode: Int) {
      main.post { speaking.remove(utteranceId)?.resolve(false) }
    }

    override fun onStop(utteranceId: String, interrupted: Boolean) {
      main.post { speaking.remove(utteranceId)?.resolve(false) }
    }
  }

  /** Runs `block` with a connected voice engine (null if none could be connected). */
  private fun withTts(block: (TextToSpeech?) -> Unit) {
    val current = tts
    if (current != null && ttsReady) {
      block(current)
      return
    }
    onTtsReady.add { block(if (ttsReady) tts else null) }
    if (current != null) return // still connecting
    tts = TextToSpeech(context.applicationContext) { status ->
      main.post {
        ttsReady = status == TextToSpeech.SUCCESS
        if (ttsReady) {
          tts?.setOnUtteranceProgressListener(progress)
        } else {
          Log.w(TAG, "Voice engine did not start ($status)")
          tts?.shutdown()
          tts = null
        }
        val waiting = onTtsReady.toList()
        onTtsReady.clear()
        waiting.forEach { it() }
      }
    }
  }

  private fun dropTts() {
    tts?.shutdown()
    tts = null
    ttsReady = false
    speaking.values.forEach { it.resolve(false) }
    speaking.clear()
  }

  /** How Finy sounds: a voice by name (null = the engine's default for the language), pitch and rate (1 = normal). */
  private data class Style(val lang: String, val voice: String?, val pitch: Float, val rate: Float)

  private fun speakNow(text: String, style: Style, promise: Promise, retry: Boolean) {
    withTts { engine ->
      if (engine == null) {
        promise.resolve(false)
        return@withTts
      }
      val chosen = style.voice?.let { name -> runCatching { engine.voices?.firstOrNull { it.name == name } }.getOrNull() }
      if (chosen != null) engine.voice = chosen else engine.setLanguage(Locale.forLanguageTag(style.lang))
      engine.setPitch(style.pitch.coerceIn(0.5f, 2f))
      engine.setSpeechRate(style.rate.coerceIn(0.5f, 2f))
      // Media volume (the volume keys): the separate "assistant" volume is often at 0.
      engine.setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build(),
      )
      val id = UUID.randomUUID().toString()
      speaking[id] = promise
      if (engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) != TextToSpeech.SUCCESS) {
        speaking.remove(id)
        // Android stopped the voice engine while Finy was in the background: connect again, once.
        Log.w(TAG, "Voice engine gone, reconnecting")
        dropTts()
        if (retry) speakNow(text, style, promise, false) else promise.resolve(false)
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("FinyVoice")

    // The user tapped "Tắt" on the listening notification.
    Events("onStopRequested")

    OnCreate { current = this@FinyVoiceModule }
    OnDestroy {
      if (current === this@FinyVoiceModule) current = null
      main.post { dropTts() }
    }

    // Reads `text` aloud; resolves true when it was spoken to the end, false otherwise.
    AsyncFunction("speak") { text: String, lang: String, voice: String?, pitch: Double, rate: Double, promise: Promise ->
      val style = Style(lang, voice, pitch.toFloat(), rate.toFloat())
      main.post { speakNow(text, style, promise, true) }
    }

    // The engine's voices for a language: name, quality (higher is better), whether it
    // needs the network (the text would go to Google) and whether its data is installed.
    AsyncFunction("voices") { lang: String, promise: Promise ->
      main.post {
        withTts { engine ->
          val want = Locale.forLanguageTag(lang).language
          val list = runCatching { engine?.voices }.getOrNull().orEmpty()
            .filter { it.locale.language == want }
            .sortedBy { it.name }
            .map { v ->
              mapOf(
                "name" to v.name,
                "quality" to v.quality,
                "network" to v.isNetworkConnectionRequired,
                "installed" to !v.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED),
              )
            }
          promise.resolve(list)
        }
      }
    }

    Function("stopSpeaking") {
      main.post { tts?.stop() }
    }

    // Starts the listening service, or updates its notification when it runs.
    // Android allows starting it only while the app is in the foreground.
    Function("startListening") { title: String, text: String ->
      val intent = Intent(context, FinyListenService::class.java)
        .putExtra(FinyListenService.EXTRA_TITLE, title)
        .putExtra(FinyListenService.EXTRA_TEXT, text)
      ContextCompat.startForegroundService(context, intent)
    }

    Function("updateListening") { title: String, text: String ->
      if (FinyListenService.running) Notifications.update(context, title, text)
    }

    Function("stopListening") {
      context.stopService(Intent(context, FinyListenService::class.java))
      FinyListenService.running = false
    }

    Function("isListening") { FinyListenService.running }

    // Whether Finy is left out of battery optimization (Android will not put it to sleep).
    Function("ignoresBatteryOptimizations") {
      (context.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(context.packageName)
    }

    // Shows Android's dialog asking to let Finy run in the background without limits.
    Function("requestIgnoreBatteryOptimizations") {
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    // A heads-up notification: how Finy "appears" when the app is not on screen.
    Function("showPrompt") { title: String, text: String -> Notifications.prompt(context, title, text) }

    Function("hidePrompt") { NotificationManagerCompat.from(context).cancel(Notifications.PROMPT_ID) }

    // Resolves after `ms` milliseconds, in the foreground and the background alike.
    AsyncFunction("sleep") { ms: Int, promise: Promise ->
      main.postDelayed({ promise.resolve(null) }, ms.coerceIn(0, 600_000).toLong())
    }
  }

  internal fun emitStopRequested() {
    sendEvent("onStopRequested", emptyMap<String, Any>())
  }

  companion object {
    private const val TAG = "FinyVoice"

    @Volatile
    internal var current: FinyVoiceModule? = null
  }
}
