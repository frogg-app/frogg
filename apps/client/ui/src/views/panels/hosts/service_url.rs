//! "Open <service>?" for a URL a session's service is published on (ui-next
//! `hosts/ServiceUrl.tsx`): open in the default browser or copy, optionally remembered.
//!
//! Callers (port chips, sub-work links) call [`open_service_url`]: it acts on a remembered
//! choice, else shows [`ServiceUrlDialog`] (mounted once at the app root).

#![allow(dead_code)] // `open_service_url` is for the sub-work port chips (7c) to call.

use leptos::prelude::*;
use leptos::task::spawn_local;

use crate::components::{Button, ButtonKind, Ico, Icon, Sheet};
use crate::views::settings::kit::Toggle;

const KEY: &str = "frogg-next.service-url.how";

#[derive(Clone, Debug, PartialEq)]
pub struct ServiceUrlAsk {
    pub url: String,
    pub service: Option<String>,
    pub port: Option<u16>,
}

thread_local! {
    static ASK: std::cell::Cell<Option<RwSignal<Option<ServiceUrlAsk>>>> = const { std::cell::Cell::new(None) };
}

fn ask_signal() -> RwSignal<Option<ServiceUrlAsk>> {
    ASK.with(|a| {
        a.get().unwrap_or_else(|| {
            let s = RwSignal::new(None);
            a.set(Some(s));
            s
        })
    })
}

fn storage() -> Option<web_sys::Storage> {
    web_sys::window()?.local_storage().ok().flatten()
}

/// The remembered choice ("browser" | "copy"), if any.
pub fn saved_choice() -> Option<String> {
    storage()?
        .get_item(KEY)
        .ok()
        .flatten()
        .filter(|v| v == "browser" || v == "copy")
}

fn act(url: String, how: &str) {
    if how == "copy" {
        spawn_local(async move {
            let ok = crate::native::clipboard_write(&url).await.is_ok();
            let t = crate::shell::toast::Toast::new(
                if ok {
                    crate::shell::toast::ToastKind::Ok
                } else {
                    crate::shell::toast::ToastKind::Error
                },
                if ok {
                    "Copied the URL"
                } else {
                    "Couldn't copy the URL"
                },
            );
            crate::state::get().toasts.push(t);
        });
    } else {
        crate::native::open_external(&url);
    }
}

/// Opens or copies `url` the way the user chose, asking when there's no saved choice.
pub fn open_service_url(url: &str, service: Option<&str>, port: Option<u16>) {
    match saved_choice() {
        Some(how) => act(url.to_owned(), &how),
        None => ask_signal().set(Some(ServiceUrlAsk {
            url: url.to_owned(),
            service: service.map(str::to_owned),
            port,
        })),
    }
}

fn host_of(url: &str) -> String {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    rest.split('/').next().unwrap_or(rest).to_owned()
}

#[component]
pub fn ServiceUrlDialog() -> impl IntoView {
    let ask = ask_signal();
    let how = RwSignal::new("browser".to_owned());
    let remember = RwSignal::new(false);
    let close = Callback::new(move |_| ask.set(None));
    let open = Callback::new(move |_| {
        let Some(a) = ask.get_untracked() else { return };
        let h = how.get_untracked();
        if remember.get_untracked() {
            if let Some(s) = storage() {
                let _ = s.set_item(KEY, &h);
            }
        }
        act(a.url, &h);
        ask.set(None);
    });
    let choice = move |id: &'static str, label: &'static str| {
        view! {
            <button class="svc-choice" class:on=move || how.get() == id role="radio" aria-checked=move || (how.get() == id).to_string() on:click=move |_| how.set(id.into())>
                <span class="svc-diamond"></span>
                <span>{label}</span>
            </button>
        }
    };
    view! {
        <Sheet open=Signal::derive(move || ask.get().is_some()) on_close=close width=480.0>
            <div class="sheet-head">
                <span class="sheet-titles">
                    <span class="t-label">"Service URL"</span>
                    <span class="t-display sheet-title">{move || format!("Open {}?", ask.get().map(|a| host_of(&a.url)).unwrap_or_default())}</span>
                </span>
                <button class="icon-btn" aria-label="Close" on:click=move |_| ask.set(None)>
                    <Icon ico=Ico::X size=16.0 />
                </button>
            </div>
            <div class="dlg-form">
                <span class="svc-body">
                    {move || ask.get().map(|a| match a.service {
                        Some(s) => format!(
                            "The {s} service for this session is running{} behind the reverse proxy.",
                            a.port.map(|p| format!(" on :{p}")).unwrap_or_default()
                        ),
                        None => a.url,
                    })}
                </span>
                {choice("browser", "In your default browser")}
                {choice("copy", "Copy URL")}
                <div class="svc-remember">
                    <Toggle value=Signal::derive(move || remember.get()) on_change=Callback::new(move |v| remember.set(v)) label="Don't ask again" />
                    <span>"Don't ask again"</span>
                </div>
                <div class="set-acts end">
                    <Button label="Cancel" on_press=close />
                    <Button kind=ButtonKind::Primary label="Open" on_press=open />
                </div>
            </div>
        </Sheet>
    }
}
