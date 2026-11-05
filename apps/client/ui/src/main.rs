//! Frogg client UI. Phase 0: connect to a daemon and list its agents (docs/plans/rust-client.md).

use frogg_client_core::protocol::{inbound, outbound};
use frogg_client_core::{ws, ClientConfig, ConnectionState, DaemonClient, Event};
use leptos::prelude::*;
use leptos::task::spawn_local;

mod native;
mod views;

type Entry = outbound::FetchAgentsResponsePayloadEntriesItem;

const URL_KEY: &str = "frogg.daemonUrl";
const CLIENT_ID_KEY: &str = "frogg.clientId";

fn storage() -> Option<web_sys::Storage> {
    web_sys::window()?.local_storage().ok().flatten()
}

fn stored(key: &str) -> Option<String> {
    storage()?.get_item(key).ok().flatten()
}

fn store(key: &str, value: &str) {
    if let Some(s) = storage() {
        let _ = s.set_item(key, value);
    }
}

/// Served by a daemon (web build): its own origin. In the shell: the local Frogg Next daemon.
fn default_url() -> String {
    let location = web_sys::window().map(|w| w.location());
    let protocol = location
        .as_ref()
        .and_then(|l| l.protocol().ok())
        .unwrap_or_default();
    if protocol == "http:" || protocol == "https:" {
        if let Some(host) = location.and_then(|l| l.host().ok()) {
            if !host.starts_with("localhost:1420") && !host.starts_with("tauri.localhost") {
                let ws = if protocol == "https:" { "wss" } else { "ws" };
                return format!("{ws}://{host}/ws");
            }
        }
    }
    "ws://127.0.0.1:9969/ws".to_owned()
}

fn client_id() -> String {
    stored(CLIENT_ID_KEY).unwrap_or_else(|| {
        let id = format!(
            "rs-{:012x}",
            (js_sys::Math::random() * 2f64.powi(48)) as u64
        );
        store(CLIENT_ID_KEY, &id);
        id
    })
}

fn status_name(entry: &Entry) -> String {
    serde_json::to_value(&entry.agent.status)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default()
}

#[component]
fn App() -> impl IntoView {
    let client = StoredValue::new_local(DaemonClient::new(ClientConfig {
        client_id: client_id(),
        client_type: inbound::HelloClientType::Browser,
        app_version: Some(env!("CARGO_PKG_VERSION").to_owned()),
        device_name: None,
    }));
    let url = RwSignal::new(stored(URL_KEY).unwrap_or_else(default_url));
    let state = RwSignal::new(ConnectionState::Idle);
    let agents = RwSignal::new(Vec::<Entry>::new());
    let error = RwSignal::new(None::<String>);

    let refresh = move || {
        let c = client.get_value();
        spawn_local(async move {
            match c.fetch_agents(None).await {
                Ok(page) => {
                    error.set(None);
                    agents.set(page.entries);
                }
                Err(e) => error.set(Some(e.to_string())),
            }
        });
    };

    client.with_value(|c| {
        c.subscribe(move |event| match event {
            Event::State(s) => {
                state.set(*s);
                if *s == ConnectionState::Connected {
                    refresh();
                }
            }
            Event::Session(frame) if frame.kind.starts_with("agent_") => refresh(),
            Event::Session(_) => {}
        });
    });

    let connect = move || {
        let target = url.get_untracked();
        store(URL_KEY, &target);
        client.with_value(|c| {
            c.disconnect();
            if let Err(e) = ws::connect(c, &target) {
                error.set(Some(e));
            }
        });
    };
    connect();

    let dot_class = move || match state.get() {
        ConnectionState::Connected => "dot connected",
        ConnectionState::Connecting => "dot connecting",
        ConnectionState::Disconnected => "dot disconnected",
        ConnectionState::Idle => "dot",
    };

    view! {
        <div class="app">
            <header class="bar">
                <span class=dot_class></span>
                <h1>"Frogg"</h1>
                <input
                    prop:value=move || url.get()
                    on:input=move |ev| url.set(event_target_value(&ev))
                    on:keydown=move |ev| if ev.key() == "Enter" { connect() }
                />
                <button on:click=move |_| connect()>"Connect"</button>
            </header>
            <Show when=move || error.get().is_some()>
                <div class="error">{move || error.get().unwrap_or_default()}</div>
            </Show>
            <main class="list">
                <Show
                    when=move || !agents.with(Vec::is_empty)
                    fallback=|| view! { <div class="empty">"No agents"</div> }
                >
                    <For
                        each=move || agents.get()
                        key=|e| (e.agent.id.clone(), e.agent.updated_at.clone())
                        children=|e| {
                            let status = status_name(&e);
                            let title = e.agent.title.clone().unwrap_or_else(|| e.agent.cwd.clone());
                            view! {
                                <div class="row">
                                    <span class=format!("status {status}")></span>
                                    <span class="title">{title}</span>
                                    <span class="meta">{e.agent.provider.clone()}" · "{status}</span>
                                </div>
                            }
                        }
                    />
                </Show>
            </main>
        </div>
    }
}

fn main() {
    console_error_panic_hook::set_once();
    mount_to_body(App);
}
