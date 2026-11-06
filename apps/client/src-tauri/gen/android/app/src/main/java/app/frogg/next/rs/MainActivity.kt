package app.frogg.next.rs

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  /**
   * Text shared from another app (ACTION_SEND text/plain) arrives as a
   * `frogg-next-rs://share?text=…` deep link, so the deep-link plugin hands it to the UI, which
   * opens a new session with it as the prompt.
   */
  private fun asShareLink(intent: Intent?): Intent? {
    if (intent?.action != Intent.ACTION_SEND || intent.type?.startsWith("text/") != true) return intent
    val text = listOfNotNull(
      intent.getStringExtra(Intent.EXTRA_SUBJECT),
      intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString(),
    ).filter { it.isNotBlank() }.distinct().joinToString("\n\n")
    if (text.isBlank()) return intent
    return Intent(Intent.ACTION_VIEW, Uri.parse("frogg-next-rs://share?text=" + Uri.encode(text)))
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(asShareLink(intent) ?: intent)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    asShareLink(intent)?.let { setIntent(it) }
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Edge-to-edge (enforced from targetSdk 35) ignores adjustResize, so the WebView would sit
    // under the keyboard. Pad the content by the system bars and the IME instead: the page's
    // viewport shrinks while the keyboard is up, so the composer stays above it.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
      WindowInsetsCompat.CONSUMED
    }
  }
}
