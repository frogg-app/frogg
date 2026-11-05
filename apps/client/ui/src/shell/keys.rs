//! Global keyboard shortcuts (ui-next `Palette.tsx` `useGlobalKeys`): ⌘K / Ctrl+K palette,
//! ⌘N / Ctrl+N new session, bare j / k move through sessions in status order.
//! Bare a / Esc (answer the open session's permission) come with the chat stream.

use leptos::prelude::*;
use wasm_bindgen::JsCast;

use crate::state::{bucket_of, Tool};

fn is_typing(ev: &web_sys::KeyboardEvent) -> bool {
    let Some(el) = ev
        .target()
        .and_then(|t| t.dyn_into::<web_sys::HtmlElement>().ok())
    else {
        return false;
    };
    matches!(el.tag_name().as_str(), "INPUT" | "TEXTAREA") || el.is_content_editable()
}

/// Session ids in the order j / k walks: by status bucket, then most recently updated.
fn ordered_session_ids() -> Vec<String> {
    let app = crate::state::get();
    let mut list = app
        .agents
        .list(app.hosts.active_id.get_untracked().as_deref());
    list.sort_by(|a, b| {
        bucket_of(&a.agent)
            .rank()
            .cmp(&bucket_of(&b.agent).rank())
            .then_with(|| b.agent.updated_at.cmp(&a.agent.updated_at))
    });
    list.into_iter().map(|s| s.agent.id).collect()
}

fn move_selection(down: bool) {
    let app = crate::state::get();
    let order = ordered_session_ids();
    let at = app
        .ui
        .selected
        .get_untracked()
        .and_then(|s| order.iter().position(|x| *x == s));
    let next = match at {
        None => 0,
        Some(i) if down => (i + 1).min(order.len().saturating_sub(1)),
        Some(i) => i.saturating_sub(1),
    };
    if let Some(id) = order.get(next) {
        app.ui.set_tool(Tool::Sessions);
        app.ui.select(Some(id.clone()));
    }
}

/// Installs the document-level shortcut handler for the life of the app.
pub fn install() {
    let handle = window_event_listener(leptos::ev::keydown, move |ev| {
        let app = crate::state::get();
        let ui = app.ui;
        let key = ev.key().to_lowercase();
        let modal = ui.palette_open.get_untracked()
            || ui.new_session_open.get_untracked()
            || ui.host_sheet_open.get_untracked();
        if !is_typing(&ev) && !ev.meta_key() && !ev.ctrl_key() && !ev.alt_key() && !modal {
            if key == "j" || key == "k" {
                ev.prevent_default();
                move_selection(key == "j");
                return;
            }
        }
        let m = ev.meta_key() || ev.ctrl_key();
        if m && key == "n" && !ev.shift_key() {
            ev.prevent_default();
            ui.set_new_session(true, None);
        }
        if m && key == "k" {
            ev.prevent_default();
            ui.palette_open.update(|o| *o = !*o);
        }
    });
    std::mem::forget(handle);
}
