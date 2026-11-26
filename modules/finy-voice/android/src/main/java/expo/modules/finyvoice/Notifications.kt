package expo.modules.finyvoice

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/** Finy's two notifications: the ongoing "listening" one, and its answers. */
internal object Notifications {
  const val LISTEN_ID = 4101
  const val PROMPT_ID = 4102
  private const val LISTEN_CHANNEL = "finy_listen"
  private const val PROMPT_CHANNEL = "finy_prompt"

  private fun channels(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
    nm.createNotificationChannel(
      NotificationChannel(LISTEN_CHANNEL, "Finy đang nghe", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Hiện khi Finy lắng nghe để bạn gọi tên"
        setShowBadge(false)
      },
    )
    nm.createNotificationChannel(
      // Heads-up, but silent: Finy speaks its answer itself.
      NotificationChannel(PROMPT_CHANNEL, "Finy trả lời", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "Khi bạn gọi Finy lúc app không mở"
        setSound(null, null)
        enableVibration(false)
        setShowBadge(false)
      },
    )
  }

  private fun allowed(ctx: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
      ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

  private fun openApp(ctx: Context): PendingIntent? {
    val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return null
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(ctx, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  fun listening(ctx: Context, title: String, text: String): Notification {
    channels(ctx)
    val stop = PendingIntent.getService(
      ctx,
      1,
      Intent(ctx, FinyListenService::class.java).setAction(FinyListenService.ACTION_STOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    return NotificationCompat.Builder(ctx, LISTEN_CHANNEL)
      .setSmallIcon(R.drawable.finy_notif_mic)
      .setContentTitle(title)
      .setContentText(text)
      .setOngoing(true)
      .setSilent(true)
      .setShowWhen(false)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(openApp(ctx))
      .addAction(0, "Tắt", stop)
      .build()
  }

  fun update(ctx: Context, title: String, text: String) {
    if (!allowed(ctx)) return
    NotificationManagerCompat.from(ctx).notify(LISTEN_ID, listening(ctx, title, text))
  }

  fun prompt(ctx: Context, title: String, text: String) {
    channels(ctx)
    if (!allowed(ctx)) return
    // On a locked phone only "Finy" shows; the words appear once it is unlocked.
    val public = NotificationCompat.Builder(ctx, PROMPT_CHANNEL)
      .setSmallIcon(R.drawable.finy_notif_mic)
      .setContentTitle("Finy")
      .build()
    val n = NotificationCompat.Builder(ctx, PROMPT_CHANNEL)
      .setSmallIcon(R.drawable.finy_notif_mic)
      .setContentTitle(title)
      .setContentText(text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(text))
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setOnlyAlertOnce(false)
      .setAutoCancel(true)
      .setTimeoutAfter(20_000)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPublicVersion(public)
      .setContentIntent(openApp(ctx))
      .build()
    NotificationManagerCompat.from(ctx).notify(PROMPT_ID, n)
  }
}
