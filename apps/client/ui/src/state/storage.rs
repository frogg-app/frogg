//! Persistent key/value storage: `localStorage` on every target (the Tauri WebView persists it).

use serde::{de::DeserializeOwned, Serialize};

fn local() -> Option<web_sys::Storage> {
    web_sys::window()?.local_storage().ok().flatten()
}

pub fn get(key: &str) -> Option<String> {
    local()?.get_item(key).ok().flatten()
}

pub fn set(key: &str, value: &str) {
    if let Some(s) = local() {
        // Storage full or blocked: the value just doesn't persist.
        let _ = s.set_item(key, value);
    }
}

pub fn remove(key: &str) {
    if let Some(s) = local() {
        let _ = s.remove_item(key);
    }
}

/// A JSON value; `None` when missing or corrupt.
pub fn get_json<T: DeserializeOwned>(key: &str) -> Option<T> {
    serde_json::from_str(&get(key)?).ok()
}

pub fn set_json<T: Serialize>(key: &str, value: &T) {
    if let Ok(text) = serde_json::to_string(value) {
        set(key, &text);
    }
}
