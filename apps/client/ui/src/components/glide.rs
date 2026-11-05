//! One shared selection indicator that slides and resizes between items (ui-next `Glide.tsx`).
//!
//! Items carry `data-glide="<key>"` inside a positioned container; the indicator reads the
//! active item's offset box and moves there on the `--ease` curve over `GLIDE_MS`. The first
//! placement jumps.

use leptos::html;
use leptos::prelude::*;
use wasm_bindgen::JsCast;

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct GlideBox {
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}

/// Measures `[data-glide=key]` inside `container`, now and again whenever `key` or `deps` change
/// (and on window resize). Returns the box and whether it has been placed once.
pub fn use_glide(
    container: NodeRef<html::Div>,
    key: Signal<String>,
    deps: Signal<u64>,
) -> (RwSignal<Option<GlideBox>>, RwSignal<bool>) {
    let rect = RwSignal::new(None::<GlideBox>);
    let animate = RwSignal::new(false);
    let measure = move || {
        let Some(root) = container.get_untracked() else {
            return;
        };
        let k = key.get_untracked();
        let found = root
            .query_selector(&format!("[data-glide=\"{k}\"]"))
            .ok()
            .flatten()
            .and_then(|e| e.dyn_into::<web_sys::HtmlElement>().ok());
        let next = found.map(|e| GlideBox {
            left: e.offset_left() as f64,
            top: e.offset_top() as f64,
            width: e.offset_width() as f64,
            height: e.offset_height() as f64,
        });
        if rect.get_untracked().is_some() && !animate.get_untracked() {
            animate.set(true);
        }
        if next != rect.get_untracked() {
            rect.set(next);
        }
    };
    Effect::new(move |_| {
        key.track();
        deps.track();
        container.track();
        // After layout settles for this change.
        request_animation_frame(measure);
    });
    let handle = window_event_listener(leptos::ev::resize, move |_| measure());
    on_cleanup(move || handle.remove());
    (rect, animate)
}

/// The `style` for an absolutely placed indicator from a `use_glide` box.
pub fn glide_style(rect: Option<GlideBox>, animate: bool) -> String {
    match rect {
        None => "opacity:0".into(),
        Some(r) => format!(
            "transform:translate({}px,{}px);width:{}px;height:{}px;{}",
            r.left,
            r.top,
            r.width,
            r.height,
            if animate {
                "transition:transform 200ms var(--ease),width 200ms var(--ease),height 200ms var(--ease)"
            } else {
                ""
            }
        ),
    }
}
