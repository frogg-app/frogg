//! Key/value persistence behind a trait: `localStorage` in the WebView/browser (the Tauri
//! WebView persists it), memory elsewhere.

use std::cell::RefCell;
use std::collections::HashMap;

pub trait Storage {
    fn get(&self, key: &str) -> Option<String>;
    fn set(&self, key: &str, value: &str);
    fn remove(&self, key: &str);
}

#[derive(Default)]
pub struct MemoryStorage {
    map: RefCell<HashMap<String, String>>,
}

impl MemoryStorage {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Storage for MemoryStorage {
    fn get(&self, key: &str) -> Option<String> {
        self.map.borrow().get(key).cloned()
    }
    fn set(&self, key: &str, value: &str) {
        self.map.borrow_mut().insert(key.into(), value.into());
    }
    fn remove(&self, key: &str) {
        self.map.borrow_mut().remove(key);
    }
}

#[cfg(target_arch = "wasm32")]
pub struct LocalStorage;

#[cfg(target_arch = "wasm32")]
impl LocalStorage {
    fn store() -> Option<web_sys::Storage> {
        web_sys::window()?.local_storage().ok()?
    }
}

#[cfg(target_arch = "wasm32")]
impl Storage for LocalStorage {
    fn get(&self, key: &str) -> Option<String> {
        Self::store()?.get_item(key).ok()?
    }
    fn set(&self, key: &str, value: &str) {
        if let Some(s) = Self::store() {
            let _ = s.set_item(key, value);
        }
    }
    fn remove(&self, key: &str) {
        if let Some(s) = Self::store() {
            let _ = s.remove_item(key);
        }
    }
}
