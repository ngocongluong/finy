package expo.modules.finyvoice

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.ServiceCompat

/**
 * Keeps the microphone usable while Finy listens for its name in the
 * background. It does no audio work itself: the speech recognizer runs in the
 * app; Android only lets an app use the microphone from the background while
 * it shows a foreground service of type microphone, started from the foreground.
 */
class FinyListenService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  // While Finy listens the CPU must not sleep, or with the screen off everything between two
  // recognitions (a request to Claude, the spoken answer, a retry after an error) would stop
  // until the phone is woken. The microphone keeps the CPU awake anyway while it records, so
  // this costs little; it is released when listening stops.
  private var wakeLock: PowerManager.WakeLock? = null

  private fun holdCpu() {
    if (wakeLock?.isHeld == true) return
    val pm = getSystemService(POWER_SERVICE) as PowerManager
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Finy:listening").apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  private fun releaseCpu() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      running = false
      releaseCpu()
      FinyVoiceModule.current?.emitStopRequested()
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Finy đang nghe"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: ""
    try {
      val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
      ServiceCompat.startForeground(this, Notifications.LISTEN_ID, Notifications.listening(this, title, text), type)
      running = true
      holdCpu()
    } catch (e: Exception) {
      // Not allowed now (started from the background, or no microphone permission).
      Log.w(TAG, "Cannot listen in the background: ${e.message}")
      running = false
      stopSelf()
    }
    // If Android stops Finy, listening ends with it; opening Finy starts it again.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    running = false
    releaseCpu()
    super.onDestroy()
  }

  companion object {
    private const val TAG = "FinyVoice"
    const val ACTION_STOP = "expo.modules.finyvoice.STOP"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"

    @Volatile
    var running = false
  }
}
