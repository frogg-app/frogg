//! Every open modal, sheet and popover, oldest first (ui-next `modalStack.ts`). A capture-phase
//! key listener lets the top layer own Escape, so one press closes one layer and no page
//! shortcut behind it sees the key; Ctrl/Cmd+A outside a field selects the top layer's field
//! instead of the page. System back closes the top layer the same way (`shell/back.rs`).

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use leptos::prelude::*;
use wasm_bindgen::{closure::Closure, JsCast};

struct Layer {
    id: u64,
    close: Callback<()>,
    root: Option<web_sys::Element>,
}

thread_local! {
    static LAYERS: RefCell<Vec<Layer>> = const { RefCell::new(Vec::new()) };
    static SEQ: Cell<u64> = const { Cell::new(0) };
    static INSTALLED: Cell<bool> = const { Cell::new(false) };
    /// Bumped on every push/pop so reactive readers (the back guard) re-check.
    static VERSION: RefCell<Option<RwSignal<u64>>> = const { RefCell::new(None) };
}

fn version() -> RwSignal<u64> {
    VERSION.with(|v| *v.borrow_mut().get_or_insert_with(|| RwSignal::new(0)))
}

fn bump() {
    let v = version();
    // Layers come and go during render; notify on the next tick.
    request_animation_frame(move || v.update(|n| *n += 1));
}

/// True while any modal layer is open (page shortcuts stand down).
pub fn modal_open() -> bool {
    LAYERS.with(|l| !l.borrow().is_empty())
}

/// Number of open layers (reactive).
pub fn depth() -> usize {
    version().track();
    LAYERS.with(|l| l.borrow().len())
}

/// Closes the top layer; false when none is open.
pub fn close_top() -> bool {
    let top = LAYERS.with(|l| l.borrow().last().map(|x| x.close));
    match top {
        Some(c) => {
            c.run(());
            true
        }
        None => false,
    }
}

fn push(close: Callback<()>, root: Option<web_sys::Element>) -> u64 {
    let id = SEQ.with(|s| {
        s.set(s.get() + 1);
        s.get()
    });
    LAYERS.with(|l| l.borrow_mut().push(Layer { id, close, root }));
    install();
    bump();
    id
}

fn pop(id: u64) {
    let had = LAYERS.with(|l| {
        let mut l = l.borrow_mut();
        let n = l.len();
        l.retain(|x| x.id != id);
        n != l.len()
    });
    if had {
        bump();
    }
}

/// Registers an overlay as a modal layer while `open`.
pub fn use_modal_layer(open: Signal<bool>, on_close: Callback<()>) {
    use_modal_layer_in(open, on_close, None::<NodeRef<leptos::html::Div>>);
}

/// [`use_modal_layer`] with a root element where Ctrl/Cmd+A looks for the layer's text field.
pub fn use_modal_layer_in<E>(open: Signal<bool>, on_close: Callback<()>, root: Option<NodeRef<E>>)
where
    E: leptos::html::ElementType + 'static,
    E::Output: JsCast + Clone + 'static,
{
    let current = StoredValue::new_local(None::<u64>);
    let release = move || {
        if let Some(id) = current.try_get_value().flatten() {
            pop(id);
            current.set_value(None);
        }
    };
    Effect::new(move |_| {
        if open.get() {
            if current.get_value().is_none() {
                let el = root
                    .and_then(|r| r.get_untracked())
                    .and_then(|e| e.dyn_into::<web_sys::Element>().ok());
                current.set_value(Some(push(on_close, el)));
            }
        } else {
            release();
        }
    });
    on_cleanup(release);
}

const FIELD: &str = "textarea, input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=hidden])";

fn editable(el: Option<web_sys::Element>) -> bool {
    let Some(el) = el else { return false };
    let tag = el.tag_name().to_lowercase();
    tag == "input"
        || tag == "textarea"
        || tag == "select"
        || el
            .dyn_ref::<web_sys::HtmlElement>()
            .is_some_and(|h| h.is_content_editable())
}

fn focus_field(root: &web_sys::Element) {
    let Ok(all) = root.query_selector_all(FIELD) else {
        return;
    };
    for i in 0..all.length() {
        let Some(node) = all.item(i) else { continue };
        if let Some(input) = node.dyn_ref::<web_sys::HtmlInputElement>() {
            if input.disabled() || input.read_only() {
                continue;
            }
            let _ = input.focus();
            input.select();
            return;
        }
        if let Some(area) = node.dyn_ref::<web_sys::HtmlTextAreaElement>() {
            if area.disabled() || area.read_only() {
                continue;
            }
            let _ = area.focus();
            area.select();
            return;
        }
    }
}

fn install() {
    if INSTALLED.with(Cell::get) {
        return;
    }
    let Some(w) = web_sys::window() else { return };
    INSTALLED.with(|i| i.set(true));
    let swallow_up = Rc::new(Cell::new(false));
    let up_flag = swallow_up.clone();
    let down =
        Closure::<dyn FnMut(web_sys::KeyboardEvent)>::new(move |e: web_sys::KeyboardEvent| {
            if e.is_composing() {
                return;
            }
            let top = LAYERS.with(|l| l.borrow().last().map(|x| (x.close, x.root.clone())));
            let Some((close, root)) = top else { return };
            if e.key() == "Escape" {
                e.prevent_default();
                e.stop_propagation();
                swallow_up.set(true);
                close.run(());
                return;
            }
            let m = e.meta_key() || e.ctrl_key();
            if m && !e.alt_key() && !e.shift_key() && e.key().to_lowercase() == "a" {
                let active = web_sys::window()
                    .and_then(|w| w.document())
                    .and_then(|d| d.active_element());
                if editable(active) {
                    return;
                }
                e.prevent_default();
                if let Some(r) = root {
                    focus_field(&r);
                }
            }
        });
    let up = Closure::<dyn FnMut(web_sys::KeyboardEvent)>::new(move |e: web_sys::KeyboardEvent| {
        if e.key() == "Escape" && up_flag.get() {
            up_flag.set(false);
            e.stop_propagation();
        }
    });
    let _ =
        w.add_event_listener_with_callback_and_bool("keydown", down.as_ref().unchecked_ref(), true);
    let _ = w.add_event_listener_with_callback_and_bool("keyup", up.as_ref().unchecked_ref(), true);
    down.forget();
    up.forget();
}
