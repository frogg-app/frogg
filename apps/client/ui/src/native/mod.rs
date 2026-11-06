//! Native bridge: the Tauri shell's commands (apps/client/src-tauri/src/lib.rs) with web
//! fallbacks, so callers never branch on the target. ui-next equivalent: `src/desktop-bridge.ts`.
//!
//! Talks to Tauri through `window.__TAURI_INTERNALS__` (no npm `@tauri-apps/api`). Every call
//! works in a plain browser too: it uses the browser API when there is one, or does nothing.
//!
//! # Using it
//!
//! ```ignore
//! use crate::native;
//!
//! // Sync, cheap: target and launch parameters.
//! native::is_tauri();                     // inside the Tauri shell?
//! native::platform();                     // Platform::{Windows, Mac, Linux, Android, Web}
//! native::chrome();                       // Chrome::{Windows, Linux, Mac, None}: the title bar to draw
//! native::launch();                       // Launch { daemon, pair, popout, host } from the URL
//!
//! // Window controls (no-ops on the web). For the title bar, put `data-tauri-drag-region` on the
//! // strip, or call `start_drag()` on mousedown. Height: `native::TITLE_BAR_HEIGHT` px.
//! spawn_local(native::minimize());
//! spawn_local(async { let maximized = native::toggle_maximize().await; });
//! spawn_local(native::close_window());
//!
//! // Theme: call whenever the theme changes; repaints the window background natively and
//! // stores the colours the splash uses next launch.
//! native::set_window_theme(&native::WindowTheme { bg, faint, accent, symbols });
//!
//! native::open_external("https://…");          // system browser (http/https/mailto)
//! native::open_session_window(id, Some(host)); // pop-out window; web: a new tab
//! native::notify("Agent finished", Some("…")); // OS notification; web: Notification API
//! let files = native::pick_files(true).await;  // Vec<PickedFile { name, mime, size, bytes }>
//! native::clipboard_write("text").await;
//! let text = native::clipboard_read().await;
//!
//! // Pairing links (`frogg-next-rs://pair…`): the launch link is in `launch().pair`; links that
//! // arrive while running come through the subscription (also replays one still pending).
//! native::on_open_url(|url| { /* parse with frogg_client_core pairing */ });
//!
//! // Desktop updates (web/Android: status "disabled").
//! let state = native::update_check().await;    // UpdateState { status, latest_version, … }
//! native::update_install().await;              // downloads, installs, restarts
//! ```
//!
//! Async functions return `Result<_, String>` where failure matters; fire-and-forget ones spawn
//! their own task and swallow errors.

#![allow(dead_code)] // The API is for other streams; not all of it is called yet.

pub mod alerts;

use leptos::task::spawn_local;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;

/// Height of the app-drawn title bar on desktop (matches the shell and ui-next's TitleBar).
pub const TITLE_BAR_HEIGHT: f64 = 32.0;
/// The localStorage key ui-next's splash reads its colours from.
pub const CHROME_STORAGE_KEY: &str = "frogg.next.chrome";
/// Deep-link event name emitted by the shell.
const OPEN_URL_EVENT: &str = "frogg://open-url";

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = ["window", "__TAURI_INTERNALS__"], js_name = invoke, catch)]
    fn tauri_invoke(cmd: &str, args: &JsValue) -> Result<js_sys::Promise, JsValue>;

    #[wasm_bindgen(js_namespace = ["window", "__TAURI_INTERNALS__"], js_name = transformCallback)]
    fn tauri_transform_callback(callback: &js_sys::Function, once: bool) -> f64;
}

/// True inside the Tauri shell (desktop or Android).
pub fn is_tauri() -> bool {
    web_sys::window()
        .and_then(|w| js_sys::Reflect::get(&w, &JsValue::from_str("__TAURI_INTERNALS__")).ok())
        .is_some_and(|v| v.is_object())
}

/// Calls a shell command. `args` is any serde value with camelCase keys (or `()`).
/// Errors on the web; prefer the typed wrappers below.
pub async fn invoke<T: DeserializeOwned>(cmd: &str, args: impl Serialize) -> Result<T, String> {
    if !is_tauri() {
        return Err("not running in the Tauri shell".into());
    }
    let json = serde_json::to_string(&args).map_err(|e| e.to_string())?;
    let args = if json == "null" {
        JsValue::from(js_sys::Object::new())
    } else {
        js_sys::JSON::parse(&json).map_err(js_error)?
    };
    let value = JsFuture::from(tauri_invoke(cmd, &args).map_err(js_error)?)
        .await
        .map_err(js_error)?;
    let text = if value.is_undefined() {
        "null".to_owned()
    } else {
        js_sys::JSON::stringify(&value)
            .map_err(js_error)?
            .as_string()
            .unwrap_or_else(|| "null".into())
    };
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

fn js_error(value: JsValue) -> String {
    value
        .as_string()
        .or_else(|| {
            value
                .dyn_ref::<js_sys::Error>()
                .map(|e| String::from(e.message()))
        })
        .unwrap_or_else(|| format!("{value:?}"))
}

/// Runs a command for its side effect only.
fn fire(cmd: &'static str, args: serde_json::Value) {
    if is_tauri() {
        spawn_local(async move {
            let _ = invoke::<serde_json::Value>(cmd, args).await;
        });
    }
}

// ----- target and launch ----------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
    Windows,
    Mac,
    Linux,
    Android,
    Ios,
    /// A plain browser (the daemon-served web build or `trunk serve`).
    Web,
}

fn user_agent() -> String {
    web_sys::window()
        .and_then(|w| w.navigator().user_agent().ok())
        .unwrap_or_default()
}

/// The OS the shell runs on, or `Web` outside it.
pub fn platform() -> Platform {
    if !is_tauri() {
        return Platform::Web;
    }
    let ua = user_agent();
    if ua.contains("Android") {
        Platform::Android
    } else if ua.contains("iPhone") || ua.contains("iPad") {
        Platform::Ios
    } else if ua.contains("Windows") {
        Platform::Windows
    } else if ua.contains("Mac OS") {
        Platform::Mac
    } else {
        Platform::Linux
    }
}

/// The title bar the UI should draw.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Chrome {
    /// Frameless: draw the strip with a drag region and min/max/close on the right.
    Windows,
    /// Frameless: as Windows, Linux-styled controls.
    Linux,
    /// Overlay title bar: draw the strip, leave ~78px on the left for the traffic lights.
    Mac,
    /// Native or no chrome (web, Android): draw nothing.
    None,
}

fn query(key: &str) -> Option<String> {
    let search = web_sys::window()?.location().search().ok()?;
    web_sys::UrlSearchParams::new_with_str(&search)
        .ok()?
        .get(key)
        .filter(|v| !v.is_empty())
}

pub fn chrome() -> Chrome {
    match query("chrome").as_deref() {
        Some("windows") => Chrome::Windows,
        Some("linux") => Chrome::Linux,
        Some("mac") => Chrome::Mac,
        _ => Chrome::None,
    }
}

/// What the shell put in the window URL.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Launch {
    /// This machine's daemon (`127.0.0.1:9969`), a hint only: nothing connects without pairing.
    pub daemon: Option<String>,
    /// A `frogg-next-rs://pair…` link the app was launched with.
    pub pair: Option<String>,
    /// Set in a popped-out session window: the session to show.
    pub popout: Option<String>,
    /// The host of the popped-out session.
    pub host: Option<String>,
}

pub fn launch() -> Launch {
    Launch {
        daemon: query("daemon"),
        pair: query("pair"),
        popout: query("popout"),
        host: query("host"),
    }
}

/// Shell details (version etc.). Web: platform "web", chrome "none".
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub platform: String,
    pub chrome: String,
    pub version: String,
    pub mobile: bool,
    pub title_bar_height: f64,
    pub default_daemon: String,
}

pub async fn info() -> Info {
    match invoke::<Info>("native_info", ()).await {
        Ok(info) => info,
        Err(_) => Info {
            platform: "web".into(),
            chrome: "none".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            mobile: false,
            title_bar_height: 0.0,
            default_daemon: "127.0.0.1:9969".into(),
        },
    }
}

// ----- window ---------------------------------------------------------------------------------

pub async fn minimize() {
    let _ = invoke::<()>("window_minimize", ()).await;
}

/// Returns whether the window is maximised afterwards.
pub async fn toggle_maximize() -> bool {
    invoke("window_toggle_maximize", ()).await.unwrap_or(false)
}

pub async fn is_maximized() -> bool {
    invoke("window_is_maximized", ()).await.unwrap_or(false)
}

pub async fn close_window() {
    if is_tauri() {
        let _ = invoke::<()>("window_close", ()).await;
    } else if let Some(w) = web_sys::window() {
        let _ = w.close();
    }
}

/// Starts a window drag (call on primary-button mousedown in the title strip).
pub fn start_drag() {
    fire("window_start_drag", serde_json::Value::Null);
}

/// The theme's shell colours, `#rrggbb` each.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WindowTheme {
    pub bg: String,
    pub faint: String,
    pub accent: String,
    pub symbols: String,
}

/// Saves the colours for the next launch's window and splash, and repaints open windows.
pub fn set_window_theme(theme: &WindowTheme) {
    if let (Some(storage), Ok(json)) = (
        web_sys::window().and_then(|w| w.local_storage().ok().flatten()),
        serde_json::to_string(theme),
    ) {
        let _ = storage.set_item(CHROME_STORAGE_KEY, &json);
    }
    fire("set_window_theme", serde_json::json!({ "colors": theme }));
}

/// Pops a session out into its own window (focusing it if already open). Web: a new tab.
pub fn open_session_window(session_id: &str, host_id: Option<&str>) {
    if is_tauri() {
        fire(
            "open_session_window",
            serde_json::json!({ "sessionId": session_id, "hostId": host_id }),
        );
        return;
    }
    let Some(w) = web_sys::window() else { return };
    let mut q = format!("?popout={}", js_sys::encode_uri_component(session_id));
    if let Some(h) = host_id {
        q.push_str(&format!("&host={}", js_sys::encode_uri_component(h)));
    }
    let path = w.location().pathname().unwrap_or_else(|_| "/".into());
    let _ = w.open_with_url_and_target(&format!("{path}{q}"), "_blank");
}

/// Opens a link in the system browser (http, https, mailto only).
pub fn open_external(url: &str) {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:"))
    {
        return;
    }
    if is_tauri() {
        fire("open_external", serde_json::json!({ "url": url }));
    } else if let Some(w) = web_sys::window() {
        let _ = w.open_with_url_and_target_and_features(url, "_blank", "noopener,noreferrer");
    }
}

// ----- notifications --------------------------------------------------------------------------

/// Shows an OS notification (asks for permission the first time).
pub fn notify(title: &str, body: Option<&str>) {
    notify_with(title, body, false);
}

/// Asks for notification permission now (call from a user gesture, e.g. a settings toggle).
/// Returns whether notifications are allowed.
pub async fn notify_permission() -> bool {
    if is_tauri() {
        return invoke::<bool>("notify_permission", ())
            .await
            .unwrap_or(false);
    }
    use web_sys::{Notification, NotificationPermission};
    if Notification::permission() == NotificationPermission::Default {
        if let Ok(p) = Notification::request_permission() {
            let _ = JsFuture::from(p).await;
        }
    }
    Notification::permission() == NotificationPermission::Granted
}

/// As [`notify`], with the platform's default sound when `sound` (web: `silent` otherwise).
pub fn notify_with(title: &str, body: Option<&str>, sound: bool) {
    if is_tauri() {
        fire(
            "notify",
            serde_json::json!({ "title": title, "body": body, "sound": sound }),
        );
        return;
    }
    let (title, body) = (title.to_owned(), body.map(str::to_owned));
    spawn_local(async move {
        use web_sys::{Notification, NotificationOptions, NotificationPermission};
        if Notification::permission() == NotificationPermission::Default {
            if let Ok(p) = Notification::request_permission() {
                let _ = JsFuture::from(p).await;
            }
        }
        if Notification::permission() != NotificationPermission::Granted {
            return;
        }
        let options = NotificationOptions::new();
        if let Some(body) = body {
            options.set_body(&body);
        }
        options.set_silent(Some(!sound));
        let _ = Notification::new_with_options(&title, &options);
    });
}

// ----- files ----------------------------------------------------------------------------------

/// A file the user picked, read into memory (25 MB cap in the shell).
#[derive(Clone, Debug, PartialEq)]
pub struct PickedFile {
    pub name: String,
    pub mime: String,
    pub size: u64,
    pub bytes: Vec<u8>,
}

#[derive(Deserialize)]
struct WirePickedFile {
    name: String,
    mime: String,
    size: u64,
    base64: String,
}

fn decode_base64(data: &str) -> Vec<u8> {
    web_sys::window()
        .and_then(|w| w.atob(data).ok())
        .map(|s| s.chars().map(|c| c as u32 as u8).collect())
        .unwrap_or_default()
}

/// Opens the file picker. An empty list means cancelled.
pub async fn pick_files(multiple: bool) -> Result<Vec<PickedFile>, String> {
    if is_tauri() {
        let files: Vec<WirePickedFile> =
            invoke("pick_files", serde_json::json!({ "multiple": multiple })).await?;
        return Ok(files
            .into_iter()
            .map(|f| PickedFile {
                bytes: decode_base64(&f.base64),
                name: f.name,
                mime: f.mime,
                size: f.size,
            })
            .collect());
    }
    pick_files_web(multiple).await.map_err(js_error)
}

async fn pick_files_web(multiple: bool) -> Result<Vec<PickedFile>, JsValue> {
    let document = web_sys::window()
        .and_then(|w| w.document())
        .ok_or("no document")?;
    let input: web_sys::HtmlInputElement = document.create_element("input")?.dyn_into()?;
    input.set_type("file");
    input.set_multiple(multiple);
    let changed = js_sys::Promise::new(&mut |resolve, _| {
        let _ = input.add_event_listener_with_callback("change", &resolve);
        let _ = input.add_event_listener_with_callback("cancel", &resolve);
    });
    input.click();
    JsFuture::from(changed).await?;
    let mut out = Vec::new();
    let Some(list) = input.files() else {
        return Ok(out);
    };
    for i in 0..list.length() {
        let Some(file) = list.get(i) else { continue };
        let buffer = JsFuture::from(file.array_buffer()).await?;
        out.push(PickedFile {
            name: file.name(),
            mime: file.type_(),
            size: file.size() as u64,
            bytes: js_sys::Uint8Array::new(&buffer).to_vec(),
        });
    }
    Ok(out)
}

// ----- clipboard ------------------------------------------------------------------------------

pub async fn clipboard_write(text: &str) -> Result<(), String> {
    if is_tauri() {
        return invoke("clipboard_write", serde_json::json!({ "text": text })).await;
    }
    let clipboard = web_sys::window()
        .ok_or("no window")?
        .navigator()
        .clipboard();
    JsFuture::from(clipboard.write_text(text))
        .await
        .map(|_| ())
        .map_err(js_error)
}

pub async fn clipboard_read() -> Result<String, String> {
    if is_tauri() {
        return invoke("clipboard_read", ()).await;
    }
    let clipboard = web_sys::window()
        .ok_or("no window")?
        .navigator()
        .clipboard();
    JsFuture::from(clipboard.read_text())
        .await
        .map(|v| v.as_string().unwrap_or_default())
        .map_err(js_error)
}

// ----- deep links -----------------------------------------------------------------------------

/// Listens to a shell event for the app's lifetime; the callback gets the event payload.
pub fn listen(event: &'static str, callback: impl Fn(serde_json::Value) + 'static) {
    if !is_tauri() {
        return;
    }
    let closure = Closure::<dyn Fn(JsValue)>::new(move |message: JsValue| {
        let payload = js_sys::Reflect::get(&message, &JsValue::from_str("payload"))
            .ok()
            .and_then(|p| js_sys::JSON::stringify(&p).ok())
            .and_then(|s| s.as_string())
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(serde_json::Value::Null);
        callback(payload);
    });
    let handler = tauri_transform_callback(closure.as_ref().unchecked_ref(), false);
    closure.forget();
    fire(
        "plugin:event|listen",
        serde_json::json!({ "event": event, "target": { "kind": "Any" }, "handler": handler }),
    );
}

/// Calls `callback` with each `frogg-next-rs://` link the OS hands the running app, starting
/// with one still pending from before the UI loaded. The launch link is in [`launch`]`().pair`.
/// The text of a `frogg-next-rs://share?text=…` link: the Android shell turns a share
/// (ACTION_SEND) from another app into one. None for any other link.
pub fn share_text(url: &str) -> Option<String> {
    let rest = url
        .strip_prefix("frogg-next-rs://share")
        .or_else(|| url.strip_prefix("frogg-next-rs:share"))?;
    let query = rest.strip_prefix('/').unwrap_or(rest).strip_prefix('?')?;
    query
        .split('&')
        .find_map(|kv| kv.strip_prefix("text="))
        .map(percent_decode)
        .filter(|t| !t.trim().is_empty())
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
                match hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    Some(b) => {
                        out.push(b);
                        i += 3;
                        continue;
                    }
                    None => out.push(b'%'),
                }
            }
            b'+' => out.push(b' '),
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn on_open_url(callback: impl Fn(String) + 'static) {
    if !is_tauri() {
        return;
    }
    let callback = std::rc::Rc::new(callback);
    let live = callback.clone();
    listen(OPEN_URL_EVENT, move |payload| {
        if let Some(url) = payload.as_str() {
            // The shell also keeps it as pending (for a UI still loading); drop that copy so a
            // later reload doesn't offer the same link again.
            fire("take_pending_link", serde_json::Value::Null);
            live(url.to_owned());
        }
    });
    spawn_local(async move {
        if let Ok(Some(url)) = invoke::<Option<String>>("take_pending_link", ()).await {
            callback(url);
        }
    });
}

// ----- updates --------------------------------------------------------------------------------

/// Desktop update state (ui-next's `DesktopUpdateState` subset).
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateState {
    /// "disabled" | "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready"
    /// | "error"
    pub status: String,
    /// "auto" (the shell downloads and installs) | "download" (the user installs from the
    /// release page).
    pub mode: String,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub release_url: String,
    pub notes: Option<String>,
    pub progress: Option<UpdateProgress>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateProgress {
    pub percent: f64,
    pub transferred: u64,
    pub total: Option<u64>,
}

/// The shell's last update state, without checking.
pub async fn update_state() -> UpdateState {
    match invoke::<UpdateState>("update_state", ()).await {
        Ok(state) => state,
        Err(_) => UpdateState {
            status: "disabled".into(),
            current_version: env!("CARGO_PKG_VERSION").into(),
            ..Default::default()
        },
    }
}

/// Downloads the found update in the background (`auto` mode) or opens its release page
/// (`download` mode).
pub async fn update_download() -> Result<(), String> {
    invoke("update_download", ()).await
}

thread_local! {
    static UPDATES: std::cell::Cell<Option<leptos::prelude::RwSignal<Option<UpdateState>>>> =
        const { std::cell::Cell::new(None) };
}

/// The shell's update state, live (one listener for the app's lifetime). None until read.
pub fn updates() -> leptos::prelude::RwSignal<Option<UpdateState>> {
    use leptos::prelude::*;
    if let Some(s) = UPDATES.with(|u| u.get()) {
        return s;
    }
    // A root owner of its own: the first reader may be a page that unmounts.
    let owner = Owner::new_root(None);
    let s = owner.with(|| RwSignal::new(None::<UpdateState>));
    std::mem::forget(owner);
    UPDATES.with(|u| u.set(Some(s)));
    on_update_state(move |st| s.set(Some(st)));
    spawn_local(async move {
        let st = update_state().await;
        // An event may have landed first; keep the newer one.
        if s.get_untracked().is_none() {
            s.set(Some(st));
        }
    });
    s
}

/// Every update state change the shell publishes (checks, progress, ready).
pub fn on_update_state(callback: impl Fn(UpdateState) + 'static) {
    listen("frogg://update-state", move |payload| {
        if let Ok(s) = serde_json::from_value::<UpdateState>(payload) {
            callback(s);
        }
    });
}

pub async fn update_check() -> UpdateState {
    match invoke::<UpdateState>("update_check", ()).await {
        Ok(state) => state,
        Err(e) => UpdateState {
            status: "disabled".into(),
            current_version: env!("CARGO_PKG_VERSION").into(),
            error: is_tauri().then_some(e),
            ..Default::default()
        },
    }
}

/// Installs the update the last check found and restarts (desktop only).
pub async fn update_install() -> Result<(), String> {
    invoke("update_install", ()).await
}

#[cfg(test)]
mod share_tests {
    use super::share_text;

    #[test]
    fn reads_share_links() {
        assert_eq!(
            share_text("frogg-next-rs://share?text=fix%20the%20bug%E2%9C%93+now").as_deref(),
            Some("fix the bug\u{2713} now")
        );
        assert_eq!(
            share_text("frogg-next-rs://share/?a=1&text=hi").as_deref(),
            Some("hi")
        );
        assert_eq!(share_text("frogg-next-rs://share?text=").as_deref(), None);
        assert_eq!(share_text("frogg-next-rs://pair?x=1"), None);
        assert_eq!(
            share_text("frogg-next-rs://share?text=100%").as_deref(),
            Some("100%")
        );
    }
}
