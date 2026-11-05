//! The frameless desktop window's title strip (ui-next `shell/TitleBar.tsx`,
//! `desktop/window-chrome.cjs`): a drag region the width of the window. Windows and Linux get
//! minimise / maximise / close drawn here (Tauri has no native overlay); macOS keeps its
//! traffic lights, so the strip leaves room on the left. Nothing outside the desktop shell.

use leptos::prelude::*;
use leptos::task::spawn_local;

use crate::native::{self, Chrome};

#[component]
pub fn TitleBar() -> impl IntoView {
    let chrome = native::chrome();
    if chrome == Chrome::None {
        return ().into_any();
    }
    // The shell's `.root` sits below the strip.
    if let Some(body) = web_sys::window()
        .and_then(|w| w.document())
        .and_then(|d| d.body())
    {
        let _ = body.class_list().add_1("has-title-bar");
    }
    let maximized = RwSignal::new(false);
    spawn_local(async move { maximized.set(native::is_maximized().await) });
    let toggle = move || spawn_local(async move { maximized.set(native::toggle_maximize().await) });
    let mac = chrome == Chrome::Mac;
    let class = match chrome {
        Chrome::Mac => "title-bar mac",
        Chrome::Linux => "title-bar linux",
        _ => "title-bar windows",
    };
    view! {
        <div
            class=class
            style=format!("height:{}px", native::TITLE_BAR_HEIGHT)
            on:mousedown=move |ev| {
                // Drag only from the strip itself, not its buttons.
                let on_strip = ev
                    .target()
                    .and_then(|t| wasm_bindgen::JsCast::dyn_into::<web_sys::Element>(t).ok())
                    .is_some_and(|el| el.closest(".title-controls").ok().flatten().is_none());
                if ev.button() == 0 && on_strip {
                    if ev.detail() == 2 {
                        toggle();
                    } else {
                        native::start_drag();
                    }
                }
            }
        >
            <span class="t-label title-text">"Frogg Next"</span>
            {(!mac).then(|| view! {
                <div class="title-controls">
                    <button class="title-btn" aria-label="Minimise" on:click=move |_| spawn_local(native::minimize())>
                        <svg viewBox="0 0 10 10" width="10" height="10"><path d="M0 5.5h10" /></svg>
                    </button>
                    <button
                        class="title-btn"
                        aria-label=move || if maximized.get() { "Restore" } else { "Maximise" }
                        on:click=move |_| toggle()
                    >
                        {move || if maximized.get() {
                            view! { <svg viewBox="0 0 10 10" width="10" height="10"><path d="M2.5 0.5h7v7M0.5 2.5h7v7h-7z" /></svg> }.into_any()
                        } else {
                            view! { <svg viewBox="0 0 10 10" width="10" height="10"><path d="M0.5 0.5h9v9h-9z" /></svg> }.into_any()
                        }}
                    </button>
                    <button class="title-btn close" aria-label="Close" on:click=move |_| spawn_local(native::close_window())>
                        <svg viewBox="0 0 10 10" width="10" height="10"><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" /></svg>
                    </button>
                </div>
            })}
        </div>
    }
    .into_any()
}
