//! Overlays (ui-next `Floating.tsx`, the Select sheet, dialog styles): a modal `Sheet` (centred
//! card on wide layouts, bottom sheet on phones) and an anchored `Floating` popover. Both play
//! the overlay motion in and out and close on Escape or a scrim press.

use leptos::prelude::*;

use super::presence::use_presence;
use super::{Ico, Icon};
use crate::theme::{OVERLAY_OUT_MS, TOAST_OUT_MS};

#[component]
pub fn Sheet(
    #[prop(into)] open: Signal<bool>,
    on_close: Callback<()>,
    #[prop(optional, into)] title: Option<String>,
    /// Max width of the card on wide layouts.
    #[prop(default = 460.0)]
    width: f64,
    children: ChildrenFn,
) -> impl IntoView {
    let vp = crate::state::get().viewport;
    let p = use_presence(open, TOAST_OUT_MS.max(OVERLAY_OUT_MS));
    // One Escape (or system back) closes only the top layer.
    crate::shell::modal_stack::use_modal_layer(open, on_close);
    let children = StoredValue::new(children);
    let title = StoredValue::new(title);
    // Always portalled to <body>: a transformed ancestor (panels, the rail) would otherwise
    // trap the fixed overlay, and stacking stays one global scale (see components.css).
    view! {
        <leptos::portal::Portal>
        <Show when=move || p.mounted.get()>
            <div class="layer" class:closing=move || p.closing.get()>
                <div
                    class=move || {
                        format!("scrim {}", if p.closing.get() { "m-fade-out" } else { "m-fade-in" })
                    }
                    on:click=move |_| on_close.run(())
                ></div>
                <div
                    class=move || {
                        let phone = vp.phone();
                        let motion = match (phone, p.closing.get()) {
                            (true, false) => "m-sheet-in",
                            (true, true) => "m-sheet-out",
                            (false, false) => "m-rise",
                            (false, true) => "m-pop-out",
                        };
                        format!("sheet cut flip cut-stroke {} {motion}", if phone { "phone" } else { "wide" })
                    }
                    style=format!("--c:14px;--w:{width}px")
                    role="dialog"
                    aria-modal="true"
                >
                    {move || {
                        title
                            .get_value()
                            .map(|t| {
                                view! {
                                    <div class="sheet-head">
                                        <span class="t-display sheet-title">{t}</span>
                                        <button class="icon-btn" aria-label="Close" on:click=move |_| on_close.run(())>
                                            <Icon ico=Ico::X size=16.0 />
                                        </button>
                                    </div>
                                }
                            })
                    }}
                    <div class="sheet-body">{move || children.with_value(|c| c())}</div>
                </div>
            </div>
        </Show>
        </leptos::portal::Portal>
    }
}

/// A popover anchored inside a positioned parent: below it (`up = false`) or above it. Once laid
/// out it flips to the side with more room when the preferred one can't fit it, then shifts and
/// caps its height so no edge leaves the window (ui-next `Floating.web.tsx`).
#[component]
pub fn Floating(
    #[prop(into)] open: Signal<bool>,
    on_close: Callback<()>,
    #[prop(optional)] up: bool,
    #[prop(optional)] align_right: bool,
    #[prop(optional, into)] class: String,
    children: ChildrenFn,
) -> impl IntoView {
    let p = use_presence(open, OVERLAY_OUT_MS);
    // One Escape (or system back) closes only the top layer.
    crate::shell::modal_stack::use_modal_layer(open, on_close);
    let children = StoredValue::new(children);
    let class = StoredValue::new(class);
    let node = NodeRef::<leptos::html::Div>::new();
    // The side actually used: `up` until a measurement says the other side has more room.
    let side_up = RwSignal::new(up);
    Effect::new(move |_| {
        if !p.mounted.get() {
            side_up.set(up);
            return;
        }
        request_animation_frame(move || place(node, up, side_up));
    });
    view! {
        <Show when=move || p.mounted.get()>
            <div class="floating-catch" on:click=move |_| on_close.run(())></div>
            <div
                node_ref=node
                class=move || {
                    let up = side_up.get();
                    let motion = match (up, p.closing.get()) {
                        (_, true) => "m-pop-out",
                        (true, false) => "m-pop-up",
                        (false, false) => "m-pop-down",
                    };
                    format!(
                        "floating {} {} {motion} {}",
                        if up { "up" } else { "down" },
                        if align_right { "right" } else { "left" },
                        class.get_value(),
                    )
                }
            >
                {move || children.with_value(|c| c())}
            </div>
        </Show>
    }
}

/// Picks the side for a `Floating`, caps its height to that side's room, then keeps it in view.
fn place(node: NodeRef<leptos::html::Div>, prefer_up: bool, side_up: RwSignal<bool>) {
    use super::fit;
    let Some(el) = node.get_untracked() else {
        return;
    };
    let Some(anchor) = el.parent_element() else {
        return;
    };
    let a = anchor.get_bounding_client_rect();
    let need = el.scroll_height() as f64 + 2.0;
    let (above, below) = fit::room_around(a.top(), a.bottom(), 4.0);
    let up = fit::flip_up(prefer_up, need, above, below);
    let style = web_sys::HtmlElement::style(&el);
    let room = if up { above } else { below }.max(80.0);
    if need > room {
        let _ = style.set_property("max-height", &format!("{room}px"));
    } else {
        let _ = style.remove_property("max-height");
    }
    if up != side_up.get_untracked() {
        side_up.set(up);
    }
    // After the class swap lands, clamp what's left (sideways overflow, tiny windows).
    request_animation_frame(move || {
        if let Some(el) = node.get_untracked() {
            fit::keep_in_view(&el);
        }
    });
}
