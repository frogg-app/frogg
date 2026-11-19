//! The frameless desktop window's title strip (ui-next `shell/TitleBar.tsx`,
//! `desktop/window-chrome.cjs`). It is a working bar, not a caption:
//! - left: the active host (status dot, saved name), dropping a menu to switch hosts in place;
//! - centre: the command search pill (opens the palette, ⌘K);
//! - right: live work, as the sessions running now and the ones that need you.
//!
//! Empty space drags the window and a double-click zooms (macOS) or maximises. Windows and
//! Linux get minimise / maximise / close drawn here (Tauri has no native overlay); macOS keeps
//! its traffic lights, so the strip leaves room on the left. Nothing outside the desktop shell.

use leptos::prelude::*;
use leptos::task::spawn_local;

use crate::components::{Floating, Ico, Icon, StatusGlyph};
use crate::state::hosts::Host;
use crate::native::{self, Chrome};
use crate::state::kbd::kbd;
use crate::state::{Bucket, Tool};

/// True when a pointer event started on bare strip, not on one of its controls.
fn on_bare_strip(target: Option<web_sys::EventTarget>) -> bool {
    target
        .and_then(|t| wasm_bindgen::JsCast::dyn_into::<web_sys::Element>(t).ok())
        .is_some_and(|el| {
            el.closest("button, a, .title-controls, .floating, .floating-catch")
                .ok()
                .flatten()
                .is_none()
        })
}

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
        // One height for the strip, the shell below it and full-window layers (`--title-h`).
        let _ = body
            .style()
            .set_property("--title-h", &format!("{}px", native::TITLE_BAR_HEIGHT));
    }
    let maximized = RwSignal::new(false);
    spawn_local(async move { maximized.set(native::is_maximized().await) });
    let toggle = move || spawn_local(async move { maximized.set(native::toggle_maximize().await) });
    let mac = chrome == Chrome::Mac;
    let armed = RwSignal::new(false);
    // The host menu drops below the strip, so the strip rises over the shell while it's open.
    let menu = RwSignal::new(false);
    let class = match chrome {
        Chrome::Mac => "title-bar mac",
        Chrome::Linux => "title-bar linux",
        _ => "title-bar windows",
    };
    view! {
        <div
            class=class
            class:menu-open=move || menu.get()
            on:mousedown=move |ev| {
                // The drag starts on the first move, so a still double-click reaches `dblclick`.
                armed.set(ev.button() == 0 && ev.detail() < 2 && on_bare_strip(ev.target()));
            }
            on:mousemove=move |ev| {
                if armed.get_untracked() && ev.buttons() & 1 == 1 {
                    armed.set(false);
                    native::start_drag();
                }
            }
            on:mouseup=move |_| armed.set(false)
            on:dblclick=move |ev| {
                if on_bare_strip(ev.target()) {
                    toggle();
                }
            }
        >
            <div class="tb-side tb-left">
                <Where open=menu />
            </div>
            <SearchPill />
            <div class="tb-side tb-right">
                <Live />
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
        </div>
    }
    .into_any()
}

/// The active host: status dot and saved name. It drops a menu of the saved hosts to switch in
/// place, without leaving the current view. The open session's name is the chat header's job,
/// so the strip doesn't repeat it.
#[component]
fn Where(open: RwSignal<bool>) -> impl IntoView {
    let app = crate::state::get();
    let link = Memo::new(move |_| app.conn.active_link());
    let host = move || {
        app.hosts
            .active()
            .map(|h| h.name)
            .or_else(|| link.get().server_name)
            .unwrap_or_else(|| "No host".into())
    };
    let close = Callback::new(move |_| open.set(false));
    view! {
        <div class="tb-host-wrap">
            <button
                class="tb-host"
                class:on=move || open.get()
                title="Switch host"
                aria-haspopup="menu"
                aria-expanded=move || open.get().to_string()
                on:click=move |_| open.update(|o| *o = !*o)
            >
                <span class=move || format!("dot {}", link.get().conn.id())></span>
                <span class="tb-host-t">{host}</span>
                <Icon ico=Ico::ChevronDown size=12.0 />
            </button>
            <Floating open=open on_close=close class="menu tb-host-menu">
                <For
                    each=move || app.hosts.hosts.get()
                    key=|h| (h.id.clone(), h.name.clone())
                    children=move |h: Host| view! { <HostOption host=h close=close /> }
                />
                <div class="tb-host-sep"></div>
                <button class="menu-item" on:click=move |_| {
                    close.run(());
                    app.ui.host_sheet_open.set(true);
                }>
                    <Icon ico=Ico::Plus size=14.0 />
                    <span class="menu-label">"Add host"</span>
                </button>
                <button class="menu-item" on:click=move |_| {
                    close.run(());
                    app.ui.set_tool(Tool::Hosts);
                }>
                    <Icon ico=Ico::Server size=14.0 />
                    <span class="menu-label">"Manage hosts"</span>
                </button>
            </Floating>
        </div>
    }
}

/// One saved host in the switcher: its link dot and name, ticked when active.
#[component]
fn HostOption(host: Host, close: Callback<()>) -> impl IntoView {
    let app = crate::state::get();
    let id = StoredValue::new(host.id.clone());
    let link = Memo::new(move |_| app.conn.link(&id.get_value()));
    let active = Memo::new(move |_| app.hosts.active_id.get() == Some(id.get_value()));
    view! {
        <button
            class="menu-item tb-host-opt"
            class:on=move || active.get()
            role="menuitemradio"
            aria-checked=move || active.get().to_string()
            on:click=move |_| {
                close.run(());
                if !active.get_untracked() {
                    app.conn.activate(&id.get_value());
                }
            }
        >
            <span class=move || format!("dot {}", link.get().conn.id())></span>
            <span class="menu-label">{host.name.clone()}</span>
            {move || active.get().then(|| view! { <Icon ico=Ico::Check size=14.0 /> })}
        </button>
    }
}

/// The command search pill: the palette's entry point, in the brand's chamfered cut.
#[component]
fn SearchPill() -> impl IntoView {
    let app = crate::state::get();
    view! {
        <button
            class="tb-search cut flip cut-stroke"
            aria-label="Search sessions and commands"
            on:click=move |_| app.ui.palette_open.set(true)
        >
            <Icon ico=Ico::Search size=13.0 />
            <span class="tb-search-t">"Search sessions and commands"</span>
            <span class="tb-kbd t-mono">{kbd("⌘K")}</span>
        </button>
    }
}

/// Live work on the active host: running sessions, and the ones waiting on you.
#[component]
fn Live() -> impl IntoView {
    let app = crate::state::get();
    let buckets = Memo::new(move |_| app.agents.buckets(app.active_host().as_deref()));
    view! {
        {move || {
            let n = buckets.get().needs;
            (n > 0).then(|| view! {
                <button class="tb-live tb-needs" on:click=move |_| app.ui.set_tool(Tool::Inbox)>
                    <StatusGlyph bucket=Bucket::Needs size=7.0 />
                    <span class="t-mono">{n}</span>
                    <span class="tb-live-t">" need you"</span>
                </button>
            })
        }}
        <button
            class="tb-live"
            class:busy=move || { buckets.get().working > 0 }
            on:click=move |_| app.ui.set_tool(Tool::Sessions)
        >
            <StatusGlyph bucket=Bucket::Working size=7.0 />
            <span class="t-mono">{move || buckets.get().working}</span>
            <span class="tb-live-t">" working"</span>
        </button>
    }
}
