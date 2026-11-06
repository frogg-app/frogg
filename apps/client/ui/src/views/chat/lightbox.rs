//! One image at the largest size the window allows, on the dialog scrim (ui-next
//! `markdown/Lightbox.tsx`). The backdrop, the close button and Esc close it. Any `<img>` in the
//! chat (sent attachments, markdown, tool output) opens it on click.

use std::cell::Cell;

use leptos::prelude::*;
use wasm_bindgen::JsCast;

use crate::components::{Ico, Icon};

#[derive(Clone, Debug, PartialEq)]
pub struct Shown {
    pub src: String,
    pub alt: String,
}

thread_local! {
    static OPEN: Cell<Option<RwSignal<Option<Shown>>>> = const { Cell::new(None) };
}

fn state() -> RwSignal<Option<Shown>> {
    if let Some(s) = OPEN.with(Cell::get) {
        return s;
    }
    let s = Owner::new_root(None).with(|| RwSignal::new(None));
    OPEN.with(|c| c.set(Some(s)));
    s
}

pub fn open(src: impl Into<String>, alt: impl Into<String>) {
    state().set(Some(Shown {
        src: src.into(),
        alt: alt.into(),
    }));
}

/// A click handler for a container: an `<img>` inside it opens the lightbox.
pub fn on_image_click(ev: leptos::ev::MouseEvent) {
    let Some(img) = ev
        .target()
        .and_then(|t| t.dyn_into::<web_sys::HtmlImageElement>().ok())
    else {
        return;
    };
    if img.class_list().contains("no-lightbox") {
        return;
    }
    let src = img.current_src();
    if src.is_empty() {
        return;
    }
    ev.prevent_default();
    open(src, img.alt());
}

/// Mount once per window.
#[component]
pub fn Lightbox() -> impl IntoView {
    let shown = state();
    let handle = window_event_listener(leptos::ev::keydown, move |ev| {
        if ev.key() == "Escape" && shown.get_untracked().is_some() {
            ev.stop_immediate_propagation();
            shown.set(None);
        }
    });
    on_cleanup(move || handle.remove());
    view! {
        <leptos::portal::Portal>
            {move || shown.get().map(|s| {
                let alt = s.alt.clone();
                let caption = (!alt.is_empty() && alt != "Image").then(|| view! {
                    <span class="lightbox-alt t-mono">{alt.clone()}</span>
                });
                view! {
                    <div class="lightbox m-fade-in" role="dialog" aria-label="Image">
                        <div class="scrim blur" on:click=move |_| shown.set(None)></div>
                        <div class="lightbox-panel m-rise" on:click=move |_| shown.set(None)>
                            <img class="lightbox-img no-lightbox" src=s.src alt=s.alt on:click=|ev| ev.stop_propagation() />
                            {caption}
                        </div>
                        <button class="lightbox-x" aria-label="Close" on:click=move |_| shown.set(None)>
                            <Icon ico=Ico::X size=18.0 />
                        </button>
                    </div>
                }
            })}
        </leptos::portal::Portal>
    }
}
