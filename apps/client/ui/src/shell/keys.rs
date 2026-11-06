//! Global keyboard shortcuts (ui-next `Palette.tsx` `useGlobalKeys`): ⌘K / Ctrl+K palette,
//! ⌘N / Ctrl+N new session, bare j / k move through sessions in status order, bare a / Esc
//! approve or deny the selected session's first pending permission, ⌃` opens a terminal in the
//! active checkout. "/" (filter sessions) lives with the sessions list.

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

/// Whether a sheet or popover is up (they portal `.layer` / `.floating-catch` into the body); its
/// own Escape handler closes it, so bare keys must not also act.
fn overlay_open() -> bool {
    super::modal_stack::modal_open()
        || web_sys::window()
            .and_then(|w| w.document())
            .and_then(|d| d.query_selector(".layer, .floating-catch").ok().flatten())
            .is_some()
}

/// A / Esc answer the selected session's first pending permission; true when handled. A question
/// is answered on its card, never approved bare.
fn answer_selected(allow: bool) -> bool {
    let app = crate::state::get();
    let Some(session) = app.selected_session() else {
        return false;
    };
    let Some(perm) = session.agent.pending_permissions.first() else {
        return false;
    };
    if perm.get("kind").and_then(|k| k.as_str()) == Some("question") {
        return false;
    }
    let Some(id) = perm.get("id").and_then(|i| i.as_str()) else {
        return false;
    };
    if let Err(e) = crate::state::projects::answer_permission(&session.agent.id, id, allow) {
        crate::views::sessions::menus::toast_err(e);
    }
    true
}

/// ⌃`: a terminal in the active checkout, opened in the main pane.
pub(super) fn new_terminal() {
    let Some(cwd) = crate::state::checkout::active_cwd() else {
        return;
    };
    if !crate::state::checkout::online() {
        return;
    }
    leptos::task::spawn_local(async move {
        if let Some(id) = crate::state::terminals::store().create(cwd).await {
            crate::state::get().ui.open_terminal(Some(id));
        }
    });
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
        let bare = !is_typing(&ev) && !ev.meta_key() && !ev.ctrl_key() && !ev.alt_key() && !modal;
        if bare && (key == "j" || key == "k") && !overlay_open() {
            ev.prevent_default();
            move_selection(key == "j");
            return;
        }
        // The permission card handles its own keys while focused.
        if bare
            && !ev.default_prevented()
            && (key == "a" || key == "escape")
            && !overlay_open()
            && answer_selected(key == "a")
        {
            ev.prevent_default();
            return;
        }
        if ev.ctrl_key() && !ev.meta_key() && (ev.code() == "Backquote" || key == "`") {
            ev.prevent_default();
            new_terminal();
            return;
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
