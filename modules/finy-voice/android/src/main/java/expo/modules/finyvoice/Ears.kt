package expo.modules.finyvoice

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.KeywordSpotter
import com.k2fsa.sherpa.onnx.KeywordSpotterConfig
import com.k2fsa.sherpa.onnx.OnlineModelConfig
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig
import com.k2fsa.sherpa.onnx.SileroVadModelConfig
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractor
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractorConfig
import com.k2fsa.sherpa.onnx.Vad
import com.k2fsa.sherpa.onnx.VadModelConfig
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Finy's ears. One thread reads the microphone (16 kHz mono) and keeps the
 * last seconds in a ring; a keyword spotter listens for "Finy"; on request an
 * utterance is recorded until the speaker stops (Silero VAD tells speech from
 * silence and noise), written to the cache for the speech recognizer (the app
 * deletes it right after) and given a speaker embedding computed on the
 * speech alone, so the app can tell the owner's voice from others.
 * Everything runs on the phone (sherpa-onnx).
 */
internal class Ears(
  private val context: Context,
  private val onWake: () -> Unit,
  private val onError: (String) -> Unit,
) {
  /** A recorded utterance: no path when nobody spoke. */
  class Utterance(val path: String?, val speechMs: Int, val embedding: FloatArray?, val levelDb: Float)

  private class Request(
    val maxMs: Int,
    val startTimeoutMs: Int,
    val includeRecentMs: Int,
    val endSilenceMs: Int,
    val done: (Utterance) -> Unit,
  )

  @Volatile private var thread: Thread? = null

  @Volatile private var running = false

  /** While Finy speaks: the microphone stays open, but nothing is spotted or recorded. */
  @Volatile var muted = false

  @Volatile private var request: Request? = null

  // Loaded once and kept: loading takes about a second.
  private var spotter: KeywordSpotter? = null
  private var spotterTuning = Pair(0f, 0f)
  private var speaker: SpeakerEmbeddingExtractor? = null
  // null if it could not be loaded: loudness is used instead.
  private var vad: Vad? = null

  // The last RING_MS of audio: the start of an utterance that began before it was asked for.
  private val ring = ShortArray(RATE / 1000 * RING_MS)
  private var ringPos = 0
  private var ringCount = 0

  // Loudness of the room (dBFS), followed slowly: speech is what stands out of it.
  private var noiseDb = -60f

  fun isRunning() = running

  /** Opens the microphone and starts listening; `ready` says whether it could. */
  fun start(score: Float, threshold: Float, ready: (Boolean, String?) -> Unit) {
    if (running) {
      ready(true, null)
      return
    }
    // A previous thread may still be closing the microphone.
    thread?.let { if (it.isAlive) it.join(600) }
    running = true
    thread = Thread({ run(score, threshold, ready) }, "FinyEars").apply { start() }
  }

  fun stop() {
    running = false
  }

  /** Records the next utterance (see Request); `done` is called on the ears' thread. */
  fun record(maxMs: Int, startTimeoutMs: Int, includeRecentMs: Int, endSilenceMs: Int, done: (Utterance) -> Unit) {
    if (!running || request != null) {
      done(Utterance(null, 0, null, -100f))
      return
    }
    request = Request(maxMs, startTimeoutMs, includeRecentMs, endSilenceMs, done)
  }

  // ---- the listening thread ----

  private fun loadModels(score: Float, threshold: Float) {
    if (spotter == null || spotterTuning != Pair(score, threshold)) {
      spotter?.release()
      val config = KeywordSpotterConfig(
        featConfig = FeatureConfig(sampleRate = RATE, featureDim = 80),
        modelConfig = OnlineModelConfig(
          transducer = OnlineTransducerModelConfig(
            encoder = "$DIR/kws/encoder.int8.onnx",
            decoder = "$DIR/kws/decoder.onnx",
            joiner = "$DIR/kws/joiner.int8.onnx",
          ),
          tokens = "$DIR/kws/tokens.txt",
          numThreads = 1,
        ),
        maxActivePaths = 4,
        keywordsFile = "$DIR/kws/keywords.txt",
        keywordsScore = score,
        keywordsThreshold = threshold,
        numTrailingBlanks = 1,
      )
      spotter = KeywordSpotter(context.assets, config)
      spotterTuning = Pair(score, threshold)
    }
    if (speaker == null) {
      speaker = SpeakerEmbeddingExtractor(context.assets, SpeakerEmbeddingExtractorConfig(model = "$DIR/speaker.onnx", numThreads = 1))
    }
    if (vad == null) {
      vad = runCatching {
        Vad(
          context.assets,
          VadModelConfig(
            sileroVadModelConfig = SileroVadModelConfig(model = "$DIR/silero_vad.onnx", threshold = 0.5f, minSilenceDuration = 0.25f, minSpeechDuration = 0.1f, windowSize = WIN),
            sampleRate = RATE,
            numThreads = 1,
          ),
        )
      }.onFailure { Log.w(TAG, "No VAD, using loudness: ${it.message}") }.getOrNull()
    }
  }

  @SuppressLint("MissingPermission") // the app asks for the microphone before starting the ears
  private fun openMic(): AudioRecord {
    val minBuffer = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val rec = AudioRecord(
      MediaRecorder.AudioSource.VOICE_RECOGNITION,
      RATE,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
      // Two seconds of room, so computing an embedding never loses audio.
      max(minBuffer, RATE * 2 * 2),
    )
    if (rec.state != AudioRecord.STATE_INITIALIZED) {
      rec.release()
      throw IllegalStateException("microphone unavailable")
    }
    return rec
  }

  private fun run(score: Float, threshold: Float, ready: (Boolean, String?) -> Unit) {
    var rec: AudioRecord? = null
    var answered = false
    var capture: Capture? = null
    try {
      loadModels(score, threshold)
      val kws = spotter!!
      val stream = kws.createStream("")
      try {
        rec = openMic()
        rec.startRecording()
        if (rec.recordingState != AudioRecord.RECORDSTATE_RECORDING) throw IllegalStateException("microphone busy")
        ready(true, null)
        answered = true
        val chunk = ShortArray(CHUNK)
        val floats = FloatArray(CHUNK)
        var quietUntil = 0L // samples: no second "Finy" right after one
        var samples = 0L
        while (running) {
          val n = rec.read(chunk, 0, CHUNK)
          if (n < 0) throw IllegalStateException("microphone read failed ($n)")
          if (n == 0) continue
          samples += n
          pushRing(chunk, n)
          val req = request
          if (req != null) {
            val c = capture?.takeIf { it.req === req } ?: Capture(req, recent(req.includeRecentMs), speechThreshold()).also { capture = it }
            if (c.add(chunk, n)) {
              request = null
              capture = null
              req.done(c.finish())
              kws.reset(stream)
              quietUntil = samples + RATE
            }
            continue
          }
          followNoise(chunk, n)
          if (muted || samples < quietUntil) continue
          for (i in 0 until n) floats[i] = chunk[i] / 32768f
          stream.acceptWaveform(if (n == CHUNK) floats else floats.copyOf(n), RATE)
          while (kws.isReady(stream)) {
            kws.decode(stream)
            if (kws.getResult(stream).keyword.isNotEmpty()) {
              kws.reset(stream)
              quietUntil = samples + RATE * 3 / 2
              onWake()
            }
          }
        }
      } finally {
        stream.release()
      }
    } catch (e: Throwable) {
      Log.w(TAG, "Ears stopped: ${e.message}")
      if (!answered) ready(false, e.message) else onError(e.message ?: "error")
    } finally {
      running = false
      request?.let {
        request = null
        it.done(Utterance(null, 0, null, -100f))
      }
      runCatching { rec?.stop() }
      rec?.release()
    }
  }

  private fun pushRing(chunk: ShortArray, n: Int) {
    for (i in 0 until n) {
      ring[ringPos] = chunk[i]
      ringPos = (ringPos + 1) % ring.size
    }
    ringCount = min(ring.size, ringCount + n)
  }

  /** The last `ms` of audio, oldest first. */
  private fun recent(ms: Int): ShortArray {
    val n = min(ringCount, RATE / 1000 * ms)
    val out = ShortArray(n)
    val start = (ringPos - n + ring.size) % ring.size
    for (i in 0 until n) out[i] = ring[(start + i) % ring.size]
    return out
  }

  private fun followNoise(chunk: ShortArray, n: Int) {
    var i = 0
    while (i + FRAME <= n) {
      val db = frameDb(chunk, i, FRAME)
      // Falls quickly, rises slowly (half a dB a second): speech hardly moves it.
      noiseDb = if (db < noiseDb) 0.7f * noiseDb + 0.3f * db else noiseDb + 0.01f
      i += FRAME
    }
  }

  private fun speechThreshold(): Float = (noiseDb + 12f).coerceIn(-50f, -30f)

  // ---- recording one utterance ----

  /** Speech or not, one window of WIN samples at a time (Silero VAD, or loudness without it). */
  private inner class SpeechGate(private val thresholdDb: Float) {
    private var inSpeech = false
    private val floats = FloatArray(WIN)

    init {
      vad?.reset()
    }

    fun voiced(buf: ShortArray, offset: Int): Boolean {
      val v = vad ?: return frameDb(buf, offset, WIN) > thresholdDb
      for (i in 0 until WIN) floats[i] = buf[offset + i] / 32768f
      val p = runCatching { v.compute(floats) }.getOrDefault(0f)
      // Enters speech at 0.5, leaves it below 0.35: no flicker inside a word.
      inSpeech = if (inSpeech) p >= 0.35f else p >= 0.5f
      return inSpeech
    }
  }

  private inner class Capture(val req: Request, recent: ShortArray, thresholdDb: Float) {
    private val gate = SpeechGate(thresholdDb)
    private var audio = ShortArray(RATE * 4)
    private var length = 0
    // One flag per window: what the speaker embedding is computed on.
    private var voicedWindows = BooleanArray(256)
    private var windows = 0
    private var pending = ShortArray(0) // samples not yet making a whole window
    private var started = false
    private var firstVoiced = -1
    private var lastVoicedEnd = 0
    private var silentMs = 0
    private var elapsedMs = 0
    private var speechMs = 0
    private var voicedDbSum = 0.0

    init {
      // Whole windows only, the most recent ones.
      val usable = recent.size - recent.size % WIN
      feed(recent, recent.size - usable, usable, countTime = false)
      // What came before the request counts as speech only if it was still going on.
      if (started && silentMs >= req.endSilenceMs) {
        started = false
        firstVoiced = -1
        speechMs = 0
        voicedDbSum = 0.0
        voicedWindows.fill(false)
      }
    }

    /** Adds audio; true when the utterance is over. */
    fun add(chunk: ShortArray, n: Int): Boolean {
      val joined = if (pending.isEmpty()) chunk.copyOf(n) else pending + chunk.copyOf(n)
      val usable = joined.size - joined.size % WIN
      feed(joined, 0, usable, countTime = true)
      pending = joined.copyOfRange(usable, joined.size)
      return (started && silentMs >= req.endSilenceMs) || (!started && elapsedMs >= req.startTimeoutMs) || elapsedMs >= req.maxMs
    }

    private fun feed(src: ShortArray, from: Int, n: Int, countTime: Boolean) {
      if (length + n > audio.size) audio = audio.copyOf(max(audio.size * 2, length + n))
      System.arraycopy(src, from, audio, length, n)
      var i = 0
      while (i + WIN <= n) {
        if (windows >= voicedWindows.size) voicedWindows = voicedWindows.copyOf(voicedWindows.size * 2)
        val voiced = gate.voiced(src, from + i)
        voicedWindows[windows++] = voiced
        if (voiced) {
          if (firstVoiced < 0) firstVoiced = length + i
          started = true
          silentMs = 0
          speechMs += WIN_MS
          voicedDbSum += frameDb(src, from + i, WIN)
          lastVoicedEnd = length + i + WIN
        } else if (started) {
          silentMs += WIN_MS
        }
        if (countTime) elapsedMs += WIN_MS
        i += WIN
      }
      length += n
    }

    fun finish(): Utterance {
      val level = if (speechMs > 0) (voicedDbSum / (speechMs / WIN_MS)).toFloat() else -100f
      if (!started || speechMs < 200) return Utterance(null, speechMs, null, level)
      // For the recognizer: the speech with a little room around it.
      val from = max(0, firstVoiced - RATE / 4)
      val to = min(length, lastVoicedEnd + RATE * 3 / 10)
      val path = writeWav(audio.copyOfRange(from, to))
      // For the voice check: the speech alone (each run with one window of margin), no silence or noise.
      val keep = BooleanArray(windows) { w -> voicedWindows[w] || (w > 0 && voicedWindows[w - 1]) || (w + 1 < windows && voicedWindows[w + 1]) }
      val speech = ShortArray(keep.count { it } * WIN)
      var o = 0
      for (w in 0 until windows) {
        if (!keep[w]) continue
        System.arraycopy(audio, w * WIN, speech, o, WIN)
        o += WIN
      }
      val embedding = if (speechMs >= 300) embed(speech) else null
      return Utterance(path, speechMs, embedding, level)
    }
  }

  private fun embed(pcm: ShortArray): FloatArray? {
    val extractor = speaker ?: return null
    val stream = extractor.createStream()
    return try {
      stream.acceptWaveform(FloatArray(pcm.size) { pcm[it] / 32768f }, RATE)
      stream.inputFinished()
      if (extractor.isReady(stream)) extractor.compute(stream) else null
    } catch (e: Throwable) {
      Log.w(TAG, "No speaker embedding: ${e.message}")
      null
    } finally {
      stream.release()
    }
  }

  /** 16-bit mono WAV in the app's cache (deleted by the app once transcribed). */
  private fun writeWav(pcm: ShortArray): String {
    val dir = File(context.cacheDir, "finy-ears").apply { mkdirs() }
    val file = File(dir, "u-${UUID.randomUUID()}.wav")
    val data = ByteBuffer.allocate(pcm.size * 2).order(ByteOrder.LITTLE_ENDIAN)
    pcm.forEach { data.putShort(it) }
    val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
      put("RIFF".toByteArray()); putInt(36 + pcm.size * 2); put("WAVE".toByteArray())
      put("fmt ".toByteArray()); putInt(16); putShort(1); putShort(1); putInt(RATE); putInt(RATE * 2); putShort(2); putShort(16)
      put("data".toByteArray()); putInt(pcm.size * 2)
    }
    FileOutputStream(file).use {
      it.write(header.array())
      it.write(data.array())
    }
    return file.absolutePath
  }

  companion object {
    private const val TAG = "FinyEars"
    private const val DIR = "finy-ears"
    const val RATE = 16000
    private const val WIN = 512 // 32 ms: the VAD's window
    private const val WIN_MS = 32
    private const val CHUNK = WIN * 3 // 96 ms read at a time
    private const val FRAME = 320 // 20 ms, for following the room's loudness
    private const val RING_MS = 4000

    private fun frameDb(buf: ShortArray, offset: Int, n: Int): Float {
      var sum = 0.0
      for (i in offset until offset + n) sum += buf[i].toDouble() * buf[i]
      val rms = sqrt(sum / n) / 32768.0
      return (20 * log10(rms + 1e-9)).toFloat()
    }
  }
}
