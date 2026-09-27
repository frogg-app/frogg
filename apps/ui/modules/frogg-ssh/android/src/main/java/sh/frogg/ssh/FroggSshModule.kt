package sh.frogg.ssh

import android.content.Context
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.concurrent.ConcurrentHashMap

private const val OUTPUT_EVENT = "onOutput"
private const val HOST_KEYS = "frogg-ssh-host-keys"

internal class SshRunFailedException(message: String) :
  CodedException("ERR_FROGG_SSH", message, null)

class ExecOptions : Record {
  @Field val runId: String = ""
  @Field val host: String = ""
  @Field val port: Int = 22
  @Field val user: String = ""
  @Field val password: String? = null
  @Field val privateKey: String? = null
  @Field val passphrase: String? = null
  @Field val command: String = ""
  @Field val stdin: String = ""
  @Field val timeoutMs: Double = 45_000.0
}

/**
 * Runs deploy commands over SSH for the mobile app; see [SshRunner]. Each run
 * gets its own thread, since an install can take minutes, and streams its
 * output as `onOutput` events tagged with the caller's run id. Host keys are
 * trusted on first use and kept in the app's private preferences.
 */
class FroggSshModule : Module() {
  private val runs = ConcurrentHashMap<String, SshRunner>()

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("FroggSsh")

    Events(OUTPUT_EVENT)

    AsyncFunction("exec") { options: ExecOptions, promise: Promise -> exec(options, promise) }

    Function("cancel") { runId: String -> runs[runId]?.cancel() }

    OnDestroy { runs.values.forEach { it.cancel() } }
  }

  private fun exec(options: ExecOptions, promise: Promise) {
    val preferences = context.getSharedPreferences(HOST_KEYS, Context.MODE_PRIVATE)
    val store =
      object : SshRunner.HostKeyStore {
        override fun get(key: String): String? = preferences.getString(key, null)

        override fun put(key: String, fingerprint: String) {
          preferences.edit().putString(key, fingerprint).apply()
        }
      }
    val request =
      SshRunner.Request().apply {
        host = options.host
        port = options.port
        user = options.user
        password = options.password
        privateKey = options.privateKey
        passphrase = options.passphrase
        command = options.command
        stdin = options.stdin
        timeoutMs = options.timeoutMs.toLong()
      }
    val runner = SshRunner()
    runs[options.runId] = runner
    Thread(
        {
          try {
            val result =
              runner.run(request, store) { stream, text ->
                sendEvent(
                  OUTPUT_EVENT,
                  mapOf("runId" to options.runId, "stream" to stream, "text" to text),
                )
              }
            promise.resolve(
              mapOf("stdout" to result.stdout, "stderr" to result.stderr, "code" to result.code)
            )
          } catch (error: Throwable) {
            promise.reject(SshRunFailedException(error.message ?: error.toString()))
          } finally {
            runs.remove(options.runId)
          }
        },
        "frogg-ssh-run",
      )
      .start()
  }
}
