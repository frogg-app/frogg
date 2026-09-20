package sh.frogg.installer

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.concurrent.atomic.AtomicBoolean

private const val INSTALL_STATUS_ACTION = "sh.frogg.installer.INSTALL_STATUS"

/** Subject of the publicly known Android/Expo debug certificate. */
private const val DEBUG_CERTIFICATE_SUBJECT = "CN=Android Debug"

internal class ApkNotFoundException(path: String) :
  CodedException("ERR_FROGG_APK_MISSING", "No downloaded package at $path", null)

internal class InstallFailedException(message: String) :
  CodedException("ERR_FROGG_INSTALL_FAILED", message, null)

/**
 * Installs a downloaded APK over this app through [PackageInstaller], which needs
 * neither a FileProvider nor a world-readable copy of the download: the session
 * streams the file straight out of the app's own cache directory. The system still
 * shows its own confirmation, and Android only accepts an APK signed with the key
 * the installed app was signed with, so `getInstallerInfo` reports the installed
 * signing flavour for the update check to pick a matching asset.
 */
class FroggAppInstallerModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("FroggAppInstaller")

    Function("getInstallerInfo") {
      val packageManager = context.packageManager
      mapOf(
        "supportedAbis" to Build.SUPPORTED_ABIS.toList(),
        "canRequestPackageInstalls" to packageManager.canRequestPackageInstalls(),
        "debugSigned" to isDebugSigned(packageManager),
        "packageName" to context.packageName,
      )
    }

    AsyncFunction("openInstallPermissionSettings") {
      val intent =
        Intent(
          Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
          Uri.parse("package:${context.packageName}"),
        )
      val activity = appContext.currentActivity
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    }

    AsyncFunction("installApk") { path: String, promise: Promise -> installApk(path, promise) }
  }

  private fun isDebugSigned(packageManager: PackageManager): Boolean {
    val signingInfo =
      packageManager
        .getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
        .signingInfo ?: return false
    val certificates = signingInfo.apkContentsSigners ?: return false
    val factory = CertificateFactory.getInstance("X.509")
    return certificates.any { signature ->
      val certificate =
        factory.generateCertificate(ByteArrayInputStream(signature.toByteArray()))
          as X509Certificate
      certificate.subjectX500Principal.name.contains(DEBUG_CERTIFICATE_SUBJECT, ignoreCase = true)
    }
  }

  private fun installApk(path: String, promise: Promise) {
    val apk = File(Uri.parse(path).path ?: path)
    if (!apk.isFile) {
      promise.reject(ApkNotFoundException(path))
      return
    }

    val settled = AtomicBoolean(false)
    val installer = context.packageManager.packageInstaller
    val receiver = InstallStatusReceiver(promise, settled) { unregisterQuietly(it) }
    registerInstallStatusReceiver(receiver)

    try {
      val params =
        PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
          setAppPackageName(context.packageName)
        }
      val sessionId = installer.createSession(params)
      installer.openSession(sessionId).use { session ->
        session.openWrite("frogg-update.apk", 0, apk.length()).use { output ->
          FileInputStream(apk).use { input -> input.copyTo(output) }
          session.fsync(output)
        }
        session.commit(statusPendingIntent(sessionId).intentSender)
      }
    } catch (error: Throwable) {
      unregisterQuietly(receiver)
      if (settled.compareAndSet(false, true)) {
        promise.reject(InstallFailedException(error.message ?: error.toString()))
      }
    }
  }

  private fun statusPendingIntent(sessionId: Int): PendingIntent {
    val intent = Intent(INSTALL_STATUS_ACTION).setPackage(context.packageName)
    var flags = PendingIntent.FLAG_UPDATE_CURRENT
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      flags = flags or PendingIntent.FLAG_MUTABLE
    }
    return PendingIntent.getBroadcast(context, sessionId, intent, flags)
  }

  private fun registerInstallStatusReceiver(receiver: BroadcastReceiver) {
    val filter = IntentFilter(INSTALL_STATUS_ACTION)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      context.registerReceiver(receiver, filter)
    }
  }

  private fun unregisterQuietly(receiver: BroadcastReceiver) {
    try {
      context.unregisterReceiver(receiver)
    } catch (_: IllegalArgumentException) {
      // Already unregistered; the install result only settles once either way.
    }
  }

  /**
   * The first broadcast asks for the system confirmation dialog; the promise stays
   * pending until the user answers it. A successful install stops this process, so
   * in practice only failure and cancellation resolve.
   */
  private inner class InstallStatusReceiver(
    private val promise: Promise,
    private val settled: AtomicBoolean,
    private val done: (BroadcastReceiver) -> Unit,
  ) : BroadcastReceiver() {
    override fun onReceive(receiverContext: Context, intent: Intent) {
      val status =
        intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
      val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)

      if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
        val confirmation =
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
          } else {
            @Suppress("DEPRECATION") intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
          }
        if (confirmation == null) {
          resolveOnce(mapOf("status" to "failure", "message" to "No install confirmation intent"))
          return
        }
        val activity = appContext.currentActivity
        if (activity != null) {
          activity.startActivity(confirmation)
        } else {
          receiverContext.startActivity(confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        return
      }

      val result =
        when (status) {
          PackageInstaller.STATUS_SUCCESS -> mapOf("status" to "success", "message" to message)
          PackageInstaller.STATUS_FAILURE_ABORTED ->
            mapOf("status" to "cancelled", "message" to message)
          else -> mapOf("status" to "failure", "message" to message)
        }
      resolveOnce(result)
    }

    private fun resolveOnce(result: Map<String, String?>) {
      done(this)
      if (settled.compareAndSet(false, true)) {
        promise.resolve(result)
      }
    }
  }
}
