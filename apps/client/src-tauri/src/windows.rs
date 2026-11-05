//! Windows: per-OS chrome, the saved shell theme, popped-out session windows.
//! Parity with `apps/ui-next/desktop/{main,window-chrome,window-theme,session-window}.cjs`.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Height of the app-drawn title bar strip (matches ui-next's TitleBar.tsx).
pub const TITLE_BAR_HEIGHT: f64 = 32.0;
/// The daemon a fresh install looks for: Frogg Next's own daemon on this machine.
pub const DEFAULT_DAEMON: &str = "127.0.0.1:9969";
const THEME_FILE: &str = "window-theme.json";

/// Shell colours for what paints before the UI: window background and the title strip.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WindowTheme {
    pub bg: String,
    pub faint: String,
    pub accent: String,
    pub symbols: String,
}

impl Default for WindowTheme {
    /// The default theme's (Material) colours, for a first launch.
    fn default() -> Self {
        Self {
            bg: "#16181b".into(),
            faint: "#6c757d".into(),
            accent: "#82aaff".into(),
            symbols: "#a3abb2".into(),
        }
    }
}

fn hex(value: &str) -> Option<(u8, u8, u8)> {
    let v = value.strip_prefix('#')?;
    if v.len() != 6 || !v.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let p = |i: usize| u8::from_str_radix(&v[i..i + 2], 16).ok();
    Some((p(0)?, p(2)?, p(4)?))
}

impl WindowTheme {
    /// Keeps valid `#rrggbb` values, falling back to the default per key.
    pub fn normalize(value: &serde_json::Value) -> Self {
        let d = Self::default();
        let pick = |key: &str, fallback: String| {
            value
                .get(key)
                .and_then(|v| v.as_str())
                .filter(|s| hex(s).is_some())
                .map(str::to_owned)
                .unwrap_or(fallback)
        };
        Self {
            bg: pick("bg", d.bg),
            faint: pick("faint", d.faint),
            accent: pick("accent", d.accent),
            symbols: pick("symbols", d.symbols),
        }
    }

    pub fn bg_color(&self) -> tauri::window::Color {
        let (r, g, b) = hex(&self.bg).unwrap_or((0x16, 0x18, 0x1b));
        tauri::window::Color(r, g, b, 255)
    }
}

/// Shared shell state.
#[derive(Default)]
pub struct Shell {
    pub theme: Mutex<Option<WindowTheme>>,
    /// A `frogg-next-rs://` link that arrived before the UI asked for it.
    pub pending_link: Mutex<Option<String>>,
}

fn theme_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(THEME_FILE))
}

pub fn window_theme<R: Runtime>(app: &AppHandle<R>) -> WindowTheme {
    let shell = app.state::<Shell>();
    let mut slot = shell.theme.lock().unwrap();
    slot.get_or_insert_with(|| {
        theme_path(app)
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .map(|v| WindowTheme::normalize(&v))
            .unwrap_or_default()
    })
    .clone()
}

/// Saves the theme's shell colours for the next launch and repaints open windows.
pub fn set_window_theme<R: Runtime>(app: &AppHandle<R>, value: &serde_json::Value) -> WindowTheme {
    let theme = WindowTheme::normalize(value);
    if let Some(path) = theme_path(app) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(path, serde_json::to_string(&theme).unwrap_or_default());
    }
    *app.state::<Shell>().theme.lock().unwrap() = Some(theme.clone());
    for window in app.webview_windows().values() {
        let _ = window.set_background_color(Some(theme.bg_color()));
    }
    theme
}

/// Which chrome the UI draws: "windows", "linux", "mac", or "none" (mobile: no title bar).
pub fn chrome_mode() -> &'static str {
    if cfg!(mobile) {
        "none"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "mac"
    } else {
        "linux"
    }
}

/// Agent and host ids are short opaque tokens; anything else is refused before it reaches a URL.
pub fn valid_id(id: &str) -> bool {
    (1..=200).contains(&id.len())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | ':' | '-'))
}

fn encode_query(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| {
            let enc: String = v
                .bytes()
                .map(|b| match b {
                    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                        (b as char).to_string()
                    }
                    _ => format!("%{b:02X}"),
                })
                .collect();
            format!("{k}={enc}")
        })
        .collect::<Vec<_>>()
        .join("&")
}

/// Opens a window on the app, routed by query (`chrome`, `daemon`, plus `route`).
pub fn create_window<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    route: &[(&str, &str)],
    popout: bool,
) -> tauri::Result<WebviewWindow<R>> {
    let mut query = vec![("daemon", DEFAULT_DAEMON), ("chrome", chrome_mode())];
    query.extend_from_slice(route);
    let url = WebviewUrl::App(format!("index.html?{}", encode_query(&query)).into());
    let builder = WebviewWindowBuilder::new(app, label, url)
        .title("Frogg Next RS")
        .background_color(window_theme(app).bg_color());
    let handle = app.clone();
    let builder = builder.on_navigation(move |url| {
        // The app's own origin stays in the window; anything else opens in the browser.
        let internal = matches!(url.scheme(), "tauri" | "asset")
            || url.host_str() == Some("tauri.localhost")
            || (cfg!(debug_assertions) && url.host_str() == Some("localhost"));
        if !internal {
            crate::open_external_url(&handle, url.as_str());
        }
        internal
    });
    #[cfg(desktop)]
    let builder = {
        let (w, h, min_w, min_h) = if popout {
            (900.0, 820.0, 480.0, 400.0)
        } else {
            (1440.0, 960.0, 800.0, 600.0)
        };
        let handle = app.clone();
        let builder = builder
            .on_new_window(move |url, _| {
                // `window.open` / target=_blank links go to the browser, never a new webview.
                crate::open_external_url(&handle, url.as_str());
                tauri::webview::NewWindowResponse::Deny
            })
            .inner_size(w, h)
            .min_inner_size(min_w, min_h)
            .visible(true);
        #[cfg(target_os = "macos")]
        let builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(12.0, 16.0));
        #[cfg(not(target_os = "macos"))]
        let builder = builder.decorations(false);
        builder
    };
    #[cfg(mobile)]
    let _ = popout;
    builder.build()
}

pub fn create_main_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<WebviewWindow<R>> {
    let pending = app.state::<Shell>().pending_link.lock().unwrap().take();
    match pending {
        Some(link) => create_window(app, "main", &[("pair", &link)], false),
        None => create_window(app, "main", &[], false),
    }
}

/// One window per host and session: popping the same one out again focuses it.
pub fn open_session_window<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    host_id: Option<&str>,
) -> bool {
    if !valid_id(session_id) || host_id.is_some_and(|h| !valid_id(h)) {
        return false;
    }
    let key = format!("{}/{}", host_id.unwrap_or(""), session_id);
    // Labels allow only [a-zA-Z0-9-/:_]; hex keeps every id distinct.
    let label: String = std::iter::once("session-".to_owned())
        .chain(key.bytes().map(|b| format!("{b:02x}")))
        .collect();
    if let Some(open) = app.get_webview_window(&label) {
        #[cfg(desktop)]
        let _ = open.unminimize();
        let _ = open.set_focus();
        return true;
    }
    let mut route = vec![("popout", session_id)];
    if let Some(h) = host_id {
        route.push(("host", h));
    }
    create_window(app, &label, &route, true).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn theme_keeps_valid_hex_only() {
        let t = WindowTheme::normalize(&serde_json::json!({"bg": "#000000", "faint": "red"}));
        assert_eq!(t.bg, "#000000");
        assert_eq!(t.faint, WindowTheme::default().faint);
    }

    #[test]
    fn ids_are_validated() {
        assert!(valid_id("agent_1.a:b-c"));
        assert!(!valid_id(""));
        assert!(!valid_id("a/b"));
        assert!(!valid_id("a b"));
    }

    #[test]
    fn query_is_encoded() {
        assert_eq!(
            encode_query(&[("pair", "frogg-next-rs://pair?x=1")]),
            "pair=frogg-next-rs%3A%2F%2Fpair%3Fx%3D1"
        );
    }
}
