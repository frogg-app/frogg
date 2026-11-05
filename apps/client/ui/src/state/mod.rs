//! Reactive stores the whole app reads. `init()` builds them once in the root component; after
//! that `state::get()` (or `use_context::<AppState>()`) hands out the same `Copy` handle.

pub mod agents;
pub mod checkout;
pub mod ci;
pub mod connection;
pub mod files;
pub mod hosts;
pub mod kbd;
pub mod prefs;
pub mod scm;
pub mod storage;
pub mod tasks;
pub mod terminals;
pub mod ui;
pub mod usage;

use std::cell::Cell;

use leptos::prelude::*;

use crate::shell::toast::Toasts;
use crate::theme::layout::Viewport;
use crate::theme::ThemeStore;

pub use agents::{bucket_of, Agent, Agents, Bucket, Session};
pub use connection::{Conn, Connections, Link};
pub use hosts::{Host, Hosts};
pub use prefs::Prefs;
pub use ui::{Tool, Ui};

#[derive(Clone, Copy)]
pub struct AppState {
    pub theme: ThemeStore,
    pub viewport: Viewport,
    pub prefs: Prefs,
    pub ui: Ui,
    pub hosts: Hosts,
    pub agents: Agents,
    pub conn: Connections,
    pub toasts: Toasts,
}

thread_local! {
    static APP: Cell<Option<AppState>> = const { Cell::new(None) };
}

impl AppState {
    /// The active host id (reactive).
    pub fn active_host(&self) -> Option<String> {
        self.hosts.active_id.get()
    }

    /// The active host's sessions, newest first (reactive).
    pub fn sessions(&self) -> Vec<Session> {
        self.agents.list(self.active_host().as_deref())
    }

    /// The open session on the active host (reactive).
    pub fn selected_session(&self) -> Option<Session> {
        let host = self.active_host()?;
        let id = self.ui.selected.get()?;
        self.agents.get(&host, &id)
    }
}

/// Builds every store and provides it as context. Call once, inside the root component.
pub fn init() -> AppState {
    let ui = Ui::init();
    let hosts = Hosts::init();
    let agents = Agents::init();
    let app = AppState {
        theme: ThemeStore::init(),
        viewport: Viewport::init(),
        prefs: Prefs::init(),
        ui,
        hosts,
        agents,
        conn: Connections::init(hosts, agents, ui),
        toasts: Toasts::init(),
    };
    APP.with(|a| a.set(Some(app)));
    provide_context(app);
    app
}

/// The app's stores. Panics before `init()`.
pub fn get() -> AppState {
    APP.with(|a| a.get()).expect("state::init() runs first")
}
