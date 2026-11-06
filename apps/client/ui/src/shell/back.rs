//! System back on phones and Android (the Android back button, a browser's back): the WebView's history
//! drives it. While anything sits above the root, one guard entry is kept on the history stack;
//! a back press pops it, closes the topmost thing (palette, sheet, popover, detail view, a tab
//! other than Sessions) and re-arms the guard. Sheets and popovers portalled into the body aren't
//! in app state, so a MutationObserver on the body arms the guard when one appears. When
//! everything has closed by other means the stale guard is dropped, so at the root the press
//! falls through to the WebView, which on Android leaves the app.

use std::cell::Cell;

use leptos::prelude::*;
use wasm_bindgen::JsValue;

use crate::state::{AppState, Tool};

thread_local! {
    /// Whether our guard entry is on top of the history stack.
    static GUARDED: Cell<bool> = const { Cell::new(false) };
}

fn history() -> Option<web_sys::History> {
    web_sys::window().and_then(|w| w.history().ok())
}

fn arm() {
    if GUARDED.with(Cell::get) {
        return;
    }
    if let Some(h) = history() {
        if h.push_state(&JsValue::from_str("frogg-back"), "").is_ok() {
            GUARDED.with(|g| g.set(true));
        }
    }
}

/// Drops a guard nothing needs any more, so the next back press isn't swallowed.
fn disarm() {
    if !GUARDED.with(Cell::get) {
        return;
    }
    GUARDED.with(|g| g.set(false));
    if let Some(h) = history() {
        let _ = h.back();
    }
}

/// Arms or drops the guard to match what is open.
fn sync(app: AppState) {
    if !active(app) {
        return;
    }
    if can_back(app) || overlay_open() {
        arm();
    } else {
        disarm();
    }
}

/// A sheet or popover portalled into the body (they close on Escape).
fn overlay_open() -> bool {
    super::modal_stack::modal_open()
        || web_sys::window()
            .and_then(|w| w.document())
            .and_then(|d| d.query_selector(".layer, .floating-catch").ok().flatten())
            .is_some()
}

fn send_escape() {
    let init = web_sys::KeyboardEventInit::new();
    init.set_key("Escape");
    init.set_bubbles(true);
    if let (Some(w), Ok(ev)) = (
        web_sys::window(),
        web_sys::KeyboardEvent::new_with_keyboard_event_init_dict("keydown", &init),
    ) {
        let _ = w.dispatch_event(&ev);
    }
}

/// Back handling runs on phone layouts and anywhere on Android (tablets, foldables, landscape),
/// where the hardware back button exists. A desktop browser's back button is left alone.
fn active(app: AppState) -> bool {
    app.viewport.phone() || crate::native::platform() == crate::native::Platform::Android
}

/// Whether a back press has something to close (reactive, overlays aside).
fn can_back(app: AppState) -> bool {
    let ui = app.ui;
    ui.palette_open.get()
        || ui.new_session_open.get()
        || ui.host_sheet_open.get()
        || super::modal_stack::depth() > 0
        || if app.viewport.phone() {
            super::layout::has_phone_detail(app)
        } else {
            ui.selected.get().is_some()
        }
        || ui.tool.get() != Tool::Sessions
}

/// Closes the topmost thing; false at the root.
fn go_back(app: AppState) -> bool {
    let ui = app.ui;
    // The newest sheet or popover first, as one Escape would.
    if super::modal_stack::close_top() {
        return true;
    }
    if ui.palette_open.get_untracked() {
        ui.palette_open.set(false);
        return true;
    }
    if ui.new_session_open.get_untracked() {
        ui.set_new_session(false, None);
        return true;
    }
    if ui.host_sheet_open.get_untracked() {
        ui.host_sheet_open.set(false);
        return true;
    }
    if overlay_open() {
        send_escape();
        return true;
    }
    if !app.viewport.phone() {
        // Wide layouts: back leaves the tool, then closes the open session.
        if ui.tool.get_untracked() != Tool::Sessions {
            ui.set_tool(Tool::Sessions);
            return true;
        }
        if ui.selected.get_untracked().is_some() {
            ui.select(None);
            return true;
        }
        return false;
    }
    if untrack(|| super::layout::has_phone_detail(app)) {
        // Same order as the phone detail's own back buttons (layout::main_detail).
        let tool = ui.tool.get_untracked();
        match tool {
            Tool::Scm if ui.diff_path.get_untracked().is_some() => ui.open_diff(None),
            Tool::Terminals if ui.terminal_id.get_untracked().is_some() => ui.open_terminal(None),
            _ if untrack(|| ui.sessions_terminal()).is_some() => ui.open_session_terminal(None),
            Tool::Prs if ui.open_run.get_untracked().is_some() => ui.open_run.set(None),
            Tool::Files if ui.file_path.get_untracked().is_some() => ui.open_file(None),
            Tool::Settings if ui.settings_page.get_untracked().is_some() => ui.open_settings(None),
            Tool::Inbox if ui.inbox_id.get_untracked().is_some() => ui.open_inbox(None),
            _ => ui.select(None),
        }
        return true;
    }
    if ui.tool.get_untracked() != Tool::Sessions {
        ui.set_tool(Tool::Sessions);
        return true;
    }
    false
}

/// Wires back handling for the life of the app; active on phone layouts only.
pub fn install() {
    let app = crate::state::get();
    Effect::new(move |_| {
        // Tracks the viewport and app-state overlays; the DOM check below is untracked.
        let _ = active(app) && can_back(app);
        untrack(|| sync(app));
    });
    observe_overlays(app);
    let handle = window_event_listener(leptos::ev::popstate, move |_| {
        if !GUARDED.with(Cell::get) {
            return;
        }
        GUARDED.with(|g| g.set(false));
        if !active(app) {
            return;
        }
        if go_back(app) && untrack(|| can_back(app)) {
            arm();
        }
    });
    std::mem::forget(handle);
}

/// Watches the body's children for sheets and popovers mounting or unmounting.
fn observe_overlays(app: AppState) {
    use wasm_bindgen::{closure::Closure, JsCast};
    let Some(body) = web_sys::window()
        .and_then(|w| w.document())
        .and_then(|d| d.body())
    else {
        return;
    };
    let cb = Closure::<dyn FnMut()>::new(move || untrack(|| sync(app)));
    let Ok(observer) = web_sys::MutationObserver::new(cb.as_ref().unchecked_ref()) else {
        return;
    };
    let init = web_sys::MutationObserverInit::new();
    init.set_child_list(true);
    if observer.observe_with_options(&body, &init).is_ok() {
        cb.forget();
        std::mem::forget(observer);
    }
}
