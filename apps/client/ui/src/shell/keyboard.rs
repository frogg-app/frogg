//! The software keyboard on phones (ui-next `shell/KeyboardFrame.tsx`, `useKeyboardVisible.ts`).
//! A WebView reports the keyboard through `visualViewport`: when it covers part of the layout
//! viewport, the overlap goes to `--kb` on the root element (layouts pad by it, so composers and
//! sheet footers stay above the keyboard where the window did not resize), and `kb-up` marks it
//! so the phone tabs step aside while typing.

use std::cell::Cell;

use leptos::prelude::*;
use wasm_bindgen::{closure::Closure, JsCast};

/// Below this the gap is browser chrome (URL bar), not a keyboard.
const MIN_KEYBOARD_PX: f64 = 120.0;

thread_local! {
    static UP: Cell<Option<RwSignal<bool>>> = const { Cell::new(None) };
}

fn up_signal() -> RwSignal<bool> {
    if let Some(s) = UP.with(Cell::get) {
        return s;
    }
    let owner = Owner::new_root(None);
    let s = owner.with(|| RwSignal::new(false));
    std::mem::forget(owner);
    UP.with(|c| c.set(Some(s)));
    s
}

/// Whether the software keyboard is up (reactive; always false on desktop browsers).
pub fn keyboard_up() -> bool {
    up_signal().get()
}

fn measure() {
    let Some(w) = web_sys::window() else { return };
    let Some(vv) = w.visual_viewport() else {
        return;
    };
    let inner = w
        .inner_height()
        .ok()
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let overlap = (inner - (vv.height() + vv.offset_top())).max(0.0);
    let up = overlap >= MIN_KEYBOARD_PX && untrack(|| crate::state::get().viewport.phone());
    let pad = if up { overlap.round() } else { 0.0 };
    if let Some(root) = w.document().and_then(|d| d.document_element()) {
        if let Some(el) = root.dyn_ref::<web_sys::HtmlElement>() {
            let _ = el.style().set_property("--kb", &format!("{pad}px"));
        }
        let _ = root.class_list().toggle_with_force("kb-up", up);
    }
    let s = up_signal();
    if s.get_untracked() != up {
        s.set(up);
    }
}

/// Starts tracking the keyboard for the life of the app.
pub fn install() {
    let Some(vv) = web_sys::window().and_then(|w| w.visual_viewport()) else {
        return;
    };
    let cb = Closure::<dyn FnMut()>::new(measure);
    let _ = vv.add_event_listener_with_callback("resize", cb.as_ref().unchecked_ref());
    let _ = vv.add_event_listener_with_callback("scroll", cb.as_ref().unchecked_ref());
    cb.forget();
    measure();
}
