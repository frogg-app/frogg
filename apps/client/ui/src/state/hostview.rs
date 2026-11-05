//! Which host the Hosts tool shows and which of its own dialogs is open (ui-next
//! `hosts/state.ts`). Adding a host and pairing this app live in the shell's host sheet.

use std::cell::Cell;

use leptos::prelude::*;

#[derive(Debug, Clone, PartialEq)]
pub enum HostDialog {
    Edit(String),
    Remove(String),
    /// Mint a pairing code on the active host for another device.
    PairDevice,
}

#[derive(Clone, Copy)]
pub struct HostView {
    /// The host in the detail pane; None means the active one.
    pub view_id: RwSignal<Option<String>>,
    /// Phone: the detail is pushed over the list.
    pub pushed: RwSignal<bool>,
    pub dialog: RwSignal<Option<HostDialog>>,
}

thread_local! {
    static STORE: Cell<Option<HostView>> = const { Cell::new(None) };
}

pub fn init() -> HostView {
    let v = HostView {
        view_id: RwSignal::new(None),
        pushed: RwSignal::new(false),
        dialog: RwSignal::new(None),
    };
    STORE.with(|s| s.set(Some(v)));
    v
}

pub fn get() -> HostView {
    STORE
        .with(|s| s.get())
        .expect("state::hostview::init() runs first")
}

impl HostView {
    pub fn view(&self, id: Option<String>, pushed: bool) {
        self.view_id.set(id);
        self.pushed.set(pushed);
    }

    pub fn open(&self, d: HostDialog) {
        self.dialog.set(Some(d));
    }

    pub fn close(&self) {
        self.dialog.set(None);
    }
}

/// Opens the shell's add-host sheet (address, pairing code or link). The sheet owns pairing;
/// `pair` asks for its pairing state when the sheet offers one.
pub fn open_add_host(pair: bool) {
    let app = super::get();
    // An empty link opens the host sheet on its pairing tab, ready for a code or link.
    if pair {
        app.ui.pair_link.set(Some(String::new()));
    }
    app.ui.host_sheet_open.set(true);
}
