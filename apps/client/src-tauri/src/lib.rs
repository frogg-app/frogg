//! The native shell. The UI and the daemon connection run in the WebView (apps/client/ui); this
//! side owns windows and, from phase 6, the native bridge (`desktop-bridge.ts` parity).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Frogg");
}
