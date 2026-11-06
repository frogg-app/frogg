//! The native shell. The UI and the daemon connection run in the WebView (apps/client/ui); this
//! side is the native bridge, parity with ui-next's Electron shell (`apps/ui-next/desktop/*.cjs`,
//! `src/desktop-bridge.ts`). The UI calls the commands below through
//! `frogg_ui::native` (apps/client/ui/src/native), which falls back to browser APIs on the web.
//!
//! Commands (all camelCase arguments on the JS side):
//! - `native_info` → `{ platform, chrome, version, mobile, titleBarHeight, defaultDaemon }`
//! - `window_minimize`, `window_toggle_maximize`, `window_close`, `window_start_drag`,
//!   `window_is_maximized` (the calling window)
//! - `set_window_theme { colors: { bg, faint, accent, symbols } }`
//! - `open_session_window { sessionId, hostId? }` → bool
//! - `open_external { url }` (http/https/mailto only)
//! - `notify { title, body?, sound? }`, `notify_permission` → bool (asks when undecided)
//! - `pick_files { multiple }` → `[{ name, mime, size, base64 }]`
//! - `save_text { name, text }` → false when the save dialog was cancelled
//! - `clipboard_write { text }`, `clipboard_read` → string
//! - `take_pending_link` → the `frogg-next-rs://` link that launched or reached the app, if any;
//!   later links arrive as the `frogg://open-url` event (payload: the url string)
//! - `update_check` → `UpdateState`, `update_state` → the last one, `update_download`,
//!   `update_install` (desktop only); changes arrive as the `frogg://update-state` event

use base64::Engine as _;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;
use tauri_plugin_notification::{NotificationExt, PermissionState};
use tauri_plugin_opener::OpenerExt;

#[cfg(target_os = "android")]
mod android_updates;
// Pure APK-update logic: built on Android and for host tests.
#[cfg(any(target_os = "android", test))]
mod apk;
#[cfg(desktop)]
mod updates;
mod windows;

use windows::Shell;

/// The pairing-link scheme this app registers (beside Frogg Next's `frogg-next`).
pub const SCHEME: &str = "frogg-next-rs";
/// Event carrying a deep link to the UI.
pub const OPEN_URL_EVENT: &str = "frogg://open-url";
/// Largest attachment `pick_files` reads into memory.
const MAX_ATTACHMENT: u64 = 25 * 1024 * 1024;

pub(crate) fn open_external_url<R: Runtime>(app: &AppHandle<R>, url: &str) {
    let lower = url.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")
    {
        let _ = app.opener().open_url(url, None::<&str>);
    }
}

/// Hands a pairing link to the main window (focusing it), or keeps it until the UI asks.
fn deliver_link<R: Runtime>(app: &AppHandle<R>, url: String) {
    if !url.starts_with(&format!("{SCHEME}:")) {
        return;
    }
    *app.state::<Shell>().pending_link.lock().unwrap() = Some(url.clone());
    if let Some(window) = app.get_webview_window("main") {
        #[cfg(desktop)]
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit(OPEN_URL_EVENT, url);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeInfo {
    platform: &'static str,
    chrome: &'static str,
    version: String,
    mobile: bool,
    title_bar_height: f64,
    default_daemon: &'static str,
}

#[tauri::command]
fn native_info<R: Runtime>(app: AppHandle<R>) -> NativeInfo {
    NativeInfo {
        platform: std::env::consts::OS,
        chrome: windows::chrome_mode(),
        version: app.package_info().version.to_string(),
        mobile: cfg!(mobile),
        title_bar_height: windows::TITLE_BAR_HEIGHT,
        default_daemon: windows::DEFAULT_DAEMON,
    }
}

#[tauri::command]
fn window_minimize<R: Runtime>(window: WebviewWindow<R>) -> Result<(), String> {
    #[cfg(desktop)]
    window.minimize().map_err(|e| e.to_string())?;
    #[cfg(mobile)]
    let _ = window;
    Ok(())
}

#[tauri::command]
fn window_toggle_maximize<R: Runtime>(window: WebviewWindow<R>) -> Result<bool, String> {
    let maximized = window.is_maximized().map_err(|e| e.to_string())?;
    #[cfg(desktop)]
    if maximized {
        window.unmaximize()
    } else {
        window.maximize()
    }
    .map_err(|e| e.to_string())?;
    #[cfg(mobile)]
    return Ok(maximized);
    #[cfg(desktop)]
    Ok(!maximized)
}

#[tauri::command]
fn window_is_maximized<R: Runtime>(window: WebviewWindow<R>) -> bool {
    window.is_maximized().unwrap_or(false)
}

#[tauri::command]
fn window_close<R: Runtime>(window: WebviewWindow<R>) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn window_start_drag<R: Runtime>(window: WebviewWindow<R>) -> Result<(), String> {
    #[cfg(desktop)]
    window.start_dragging().map_err(|e| e.to_string())?;
    #[cfg(mobile)]
    let _ = window;
    Ok(())
}

#[tauri::command]
fn set_window_theme<R: Runtime>(app: AppHandle<R>, colors: serde_json::Value) {
    windows::set_window_theme(&app, &colors);
}

#[tauri::command]
fn open_session_window<R: Runtime>(
    app: AppHandle<R>,
    session_id: String,
    host_id: Option<String>,
) -> bool {
    windows::open_session_window(&app, &session_id, host_id.as_deref())
}

#[tauri::command]
fn open_external<R: Runtime>(app: AppHandle<R>, url: String) {
    open_external_url(&app, &url);
}

#[tauri::command]
fn notify<R: Runtime>(
    app: AppHandle<R>,
    title: String,
    body: Option<String>,
    sound: Option<bool>,
) -> Result<(), String> {
    if !notify_permission(app.clone()) {
        return Err("notifications not permitted".into());
    }
    let mut b = app.notification().builder().title(title);
    if let Some(body) = body {
        b = b.body(body);
    }
    if sound == Some(true) {
        b = b.sound(DEFAULT_SOUND);
    }
    b.show().map_err(|e| e.to_string())
}

/// The platform's default notification sound, by the name the notification plugin expects.
#[cfg(target_os = "macos")]
const DEFAULT_SOUND: &str = "NSUserNotificationDefaultSoundName";
#[cfg(target_os = "windows")]
const DEFAULT_SOUND: &str = "Default";
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
const DEFAULT_SOUND: &str = "message-new-instant";

/// Whether notifications are allowed, asking the OS (the Android 13+ prompt) when undecided.
#[tauri::command]
fn notify_permission<R: Runtime>(app: AppHandle<R>) -> bool {
    let n = app.notification();
    n.permission_state().ok() == Some(PermissionState::Granted)
        || n.request_permission().ok() == Some(PermissionState::Granted)
}

#[derive(Serialize)]
struct PickedFile {
    name: String,
    mime: String,
    size: u64,
    base64: String,
}

fn mime_for(name: &str) -> &'static str {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "json" => "application/json",
        "txt" | "md" | "log" | "rs" | "ts" | "tsx" | "js" | "py" | "toml" | "yaml" | "yml" => {
            "text/plain"
        }
        _ => "application/octet-stream",
    }
}

/// Asks where to save `text` (suggesting `name`) and writes it. False when cancelled.
#[tauri::command]
async fn save_text<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    text: String,
) -> Result<bool, String> {
    use std::io::Write as _;
    let Some(path) = app
        .dialog()
        .file()
        .set_file_name(&name)
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let mut opts = tauri_plugin_fs::OpenOptions::new();
    opts.read(false).write(true).create(true).truncate(true);
    let mut file = app.fs().open(path, opts).map_err(|e| e.to_string())?;
    file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
async fn pick_files<R: Runtime>(
    app: AppHandle<R>,
    multiple: bool,
) -> Result<Vec<PickedFile>, String> {
    let dialog = app.dialog().file();
    let picked = if multiple {
        dialog.blocking_pick_files().unwrap_or_default()
    } else {
        dialog.blocking_pick_file().into_iter().collect()
    };
    let mut out = Vec::new();
    for path in picked {
        let name = path
            .as_path()
            .and_then(|p| p.file_name())
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| {
                let s = path.to_string();
                s.rsplit('/').next().unwrap_or("attachment").to_owned()
            });
        let bytes = app.fs().read(path).map_err(|e| e.to_string())?;
        let size = bytes.len() as u64;
        if size > MAX_ATTACHMENT {
            return Err(format!("{name} is larger than 25 MB"));
        }
        out.push(PickedFile {
            mime: mime_for(&name).into(),
            name,
            size,
            base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        });
    }
    Ok(out)
}

#[tauri::command]
fn clipboard_write<R: Runtime>(app: AppHandle<R>, text: String) -> Result<(), String> {
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
fn clipboard_read<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    app.clipboard().read_text().map_err(|e| e.to_string())
}

#[tauri::command]
fn take_pending_link<R: Runtime>(app: AppHandle<R>) -> Option<String> {
    app.state::<Shell>().pending_link.lock().unwrap().take()
}

#[cfg(desktop)]
#[tauri::command]
async fn update_check<R: Runtime>(app: AppHandle<R>) -> updates::UpdateState {
    updates::check(&app).await
}

#[cfg(desktop)]
#[tauri::command]
async fn update_install<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    updates::install(&app).await
}

#[cfg(desktop)]
#[tauri::command]
fn update_state<R: Runtime>(app: AppHandle<R>) -> updates::UpdateState {
    updates::current(&app)
}

/// `auto` mode: downloads in the background (progress on `frogg://update-state`).
/// `download` mode: opens the release page, where the user picks the package.
#[cfg(desktop)]
#[tauri::command]
async fn update_download<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let s = updates::current(&app);
    if s.mode == "download" {
        open_external_url(&app, &s.release_url);
        return Ok(());
    }
    updates::download(&app).await
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn update_check<R: Runtime>(app: AppHandle<R>) -> android_updates::UpdateState {
    android_updates::check(&app).await
}

#[cfg(target_os = "android")]
#[tauri::command]
fn update_state<R: Runtime>(app: AppHandle<R>) -> android_updates::UpdateState {
    android_updates::current(&app)
}

/// Downloads and verifies the APK (progress on `frogg://update-state`); ends `ready`.
#[cfg(target_os = "android")]
#[tauri::command]
async fn update_download<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    android_updates::download(&app).await
}

/// Opens the system installer on the verified APK.
#[cfg(target_os = "android")]
#[tauri::command]
async fn update_install<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    android_updates::install(&app).await
}

#[cfg(target_os = "ios")]
#[tauri::command]
fn update_check() -> serde_json::Value {
    serde_json::json!({ "status": "disabled" })
}

#[cfg(target_os = "ios")]
#[tauri::command]
fn update_state() -> serde_json::Value {
    serde_json::json!({ "status": "disabled" })
}

#[cfg(target_os = "ios")]
#[tauri::command]
fn update_download() -> Result<(), String> {
    Err("updates come from the store on this platform".into())
}

#[cfg(target_os = "ios")]
#[tauri::command]
fn update_install() -> Result<(), String> {
    Err("updates come from the store on this platform".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // Must be first: a second launch focuses the running window and passes on its link.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
                if let Some(link) = argv.iter().find(|a| a.starts_with(&format!("{SCHEME}:"))) {
                    deliver_link(app, link.clone());
                } else if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }))
            .plugin(tauri_plugin_window_state::Builder::default().build())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init())
            .manage(updates::Updates::default());
    }

    #[cfg(target_os = "android")]
    {
        builder = builder.plugin(android_updates::plugin());
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(Shell::default())
        .invoke_handler(tauri::generate_handler![
            native_info,
            window_minimize,
            window_toggle_maximize,
            window_is_maximized,
            window_close,
            window_start_drag,
            set_window_theme,
            open_session_window,
            open_external,
            notify,
            notify_permission,
            pick_files,
            save_text,
            clipboard_write,
            clipboard_read,
            take_pending_link,
            update_check,
            update_install,
            update_state,
            update_download,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            // The link that launched the app (argv on Windows/Linux, the intent on Android).
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                if let Some(url) = urls.into_iter().find(|u| u.scheme() == SCHEME) {
                    *handle.state::<Shell>().pending_link.lock().unwrap() = Some(url.to_string());
                }
            }
            // Dev and AppImage installs register the scheme at runtime; packaged ones at install.
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            let _ = app.deep_link().register_all();
            let link_handle = handle.clone();
            app.deep_link().on_open_url(move |event| {
                if let Some(url) = event.urls().into_iter().next() {
                    deliver_link(&link_handle, url.to_string());
                }
            });
            // The main window shows at once; index.html paints the splash before the wasm loads.
            // A launch link goes into its `?pair=` query (and is consumed there).
            windows::create_main_window(&handle)?;
            #[cfg(desktop)]
            updates::start(&handle);
            #[cfg(target_os = "android")]
            android_updates::start(&handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Frogg Next RS");
}
