package app.frogg.next.rs

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class InstallArgs {
  lateinit var path: String
}

/**
 * The installer half of the APK self-updater (src-tauri/src/android_updates.rs). Rust finds,
 * downloads and verifies the APK into the cache; this opens the system installer on it through the
 * app's FileProvider (res/xml/file_paths.xml covers the cache) and sends the user to
 * "Install unknown apps" when the app may not install packages yet.
 */
@TauriPlugin
class UpdaterPlugin(private val activity: Activity) : Plugin(activity) {
  private fun canInstall(): Boolean =
    activity.packageManager.canRequestPackageInstalls()

  @Command
  fun installerInfo(invoke: Invoke) {
    val ret = JSObject()
    ret.put("canRequestPackageInstalls", canInstall())
    ret.put("packageName", activity.packageName)
    ret.put("sdk", Build.VERSION.SDK_INT)
    invoke.resolve(ret)
  }

  @Command
  fun openInstallSettings(invoke: Invoke) {
    try {
      val intent = Intent(
        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        Uri.parse("package:" + activity.packageName),
      )
      activity.startActivity(intent)
      invoke.resolve()
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "Couldn't open the install permission setting")
    }
  }

  @Command
  fun install(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(InstallArgs::class.java)
      val file = File(args.path)
      if (!file.isFile) {
        invoke.reject("The downloaded update is missing")
        return
      }
      val uri = FileProvider.getUriForFile(
        activity,
        activity.packageName + ".fileprovider",
        file,
      )
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      activity.startActivity(intent)
      invoke.resolve()
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "Couldn't start the installer")
    }
  }
}
