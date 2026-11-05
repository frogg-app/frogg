//! Add / switch host (ui-next `hosts/AddHost.tsx` and the host switcher): the saved hosts with
//! their link state, and a form to add one by direct address and password. Pairing by code or
//! link waits on the client core's relay transport and shows a "coming" note.

use leptos::prelude::*;

use super::toast::{Toast, ToastKind};
use crate::components::{Button, ButtonKind, Field, Ico, Icon, Seg, Sheet, TextInput};
use crate::state::hosts::{parse_host_address, Host};
use crate::state::Conn;

#[component]
pub fn HostSheet() -> impl IntoView {
    let app = crate::state::get();
    let open = app.ui.host_sheet_open;
    let close = Callback::new(move |_| open.set(false));
    view! {
        <Sheet open=open on_close=close title="Hosts".to_string() width=520.0>
            <HostList />
            <AddHost />
        </Sheet>
    }
}

#[component]
fn HostList() -> impl IntoView {
    let app = crate::state::get();
    view! {
        <div class="host-list">
            <For
                each=move || app.hosts.hosts.get()
                key=|h| (h.id.clone(), h.name.clone(), h.endpoint.clone())
                children=move |h: Host| {
                    let id = h.id.clone();
                    let id_pick = id.clone();
                    let id_rm = id.clone();
                    let id_on = id.clone();
                    let link = Memo::new(move |_| app.conn.link(&id));
                    let active = Memo::new(move |_| app.hosts.active_id.get().as_deref() == Some(id_on.as_str()));
                    view! {
                        <div class="host-row cut" class:on=move || active.get() style="--c:8px">
                            <button
                                class="host-main"
                                on:click=move |_| {
                                    app.conn.activate(&id_pick);
                                    app.ui.host_sheet_open.set(false);
                                }
                            >
                                <span class=move || format!("dot {}", link.get().conn.id())></span>
                                <span class="host-text">
                                    <span class="host-name">{h.name.clone()}</span>
                                    <span class="t-mono host-addr">
                                        {h.endpoint.clone()}
                                        {move || {
                                            let l = link.get();
                                            match l.conn {
                                                Conn::Online => l.version.map(|v| format!(" · v{v}")).unwrap_or_default(),
                                                Conn::Connecting if l.attempt > 0 => format!(" · retry {}", l.attempt),
                                                Conn::Connecting => " · connecting".into(),
                                                Conn::Offline => l.error.map(|e| format!(" · {e}")).unwrap_or_else(|| " · offline".into()),
                                            }
                                        }}
                                    </span>
                                </span>
                                {move || active.get().then(|| view! { <span class="t-label host-active">"active"</span> })}
                            </button>
                            <button
                                class="icon-btn"
                                aria-label="Forget host"
                                on:click=move |_| app.hosts.remove(&id_rm)
                            >
                                <Icon ico=Ico::Trash2 size=14.0 />
                            </button>
                        </div>
                    }
                }
            />
            <Show when=move || app.hosts.hosts.with(Vec::is_empty)>
                <span class="t-label host-empty">"no saved hosts"</span>
            </Show>
        </div>
    }
}

#[component]
fn AddHost() -> impl IntoView {
    let app = crate::state::get();
    let method = RwSignal::new("direct".to_owned());
    let address = RwSignal::new(String::new());
    let password = RwSignal::new(String::new());
    let error = RwSignal::new(None::<String>);
    let submit = Callback::new(move |_| {
        let Some((endpoint, name)) = parse_host_address(&address.get_untracked()) else {
            error.set(Some("Enter host:port, e.g. 192.168.1.20:6767".into()));
            return;
        };
        error.set(None);
        let mut host = Host::new(name, endpoint);
        let pw = password.get_untracked();
        if !pw.is_empty() {
            host.password = Some(pw);
        }
        let host = app.hosts.upsert(host);
        app.conn.activate(&host.id);
        address.set(String::new());
        password.set(String::new());
        app.ui.host_sheet_open.set(false);
        app.toasts.push(
            Toast::new(ToastKind::Info, format!("Connecting to {}", host.name))
                .detail(host.endpoint),
        );
    });
    view! {
        <div class="add-host">
            <span class="t-label">"Add a host"</span>
            <Seg
                options=vec![("direct".into(), "Address".into()), ("pair".into(), "Pair with code".into())]
                value=method
                on_change=Callback::new(move |v| method.set(v))
            />
            <Show
                when=move || method.get() == "direct"
                fallback=|| view! {
                    <div class="coming cut" style="--c:8px">
                        <Icon ico=Ico::QrCode size=18.0 class="cyan2" />
                        <span class="coming-text">
                            <span class="coming-title">"Pairing is coming"</span>
                            <span class="coming-sub">
                                "Codes and links pair through the relay, end-to-end encrypted. Until it lands, add the host by address."
                            </span>
                        </span>
                    </div>
                }
            >
                <div class="add-form">
                    <Field label="Address" error=Signal::derive(move || error.get())>
                        <TextInput value=address placeholder="192.168.1.20:6767" mono=true autofocus=true on_enter=submit />
                    </Field>
                    <Field label="Password" hint=Signal::derive(|| Some("Only if the daemon asks for one".to_string()))>
                        <TextInput value=password placeholder="optional" password=true mono=true on_enter=submit />
                    </Field>
                    <div class="add-actions">
                        <Button label="Connect" kind=ButtonKind::Primary icon=Ico::Plus on_press=submit />
                    </div>
                </div>
            </Show>
        </div>
    }
}
