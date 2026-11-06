//! Add / switch host (ui-next `hosts/AddHost.tsx` and the host switcher): the saved hosts with
//! their link state, and a form to add one by direct address and password, or by pairing code /
//! link (ui-next `PairSheet`): parse, verify the daemon's key, redeem, save, connect.

use leptos::prelude::*;

use super::toast::{Toast, ToastKind};
use crate::components::{Button, ButtonKind, Field, Ico, Icon, Seg, Sheet, TextInput};
use crate::state::hosts::{parse_host_address, Host};
use crate::state::pairing::{self, Verify};
use crate::state::Conn;
use leptos::task::spawn_local;

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
                                                Conn::Offline if l.paused => " · stopped retrying, tap to retry".into(),
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
    // A pairing link arriving (deep link, launch) opens the pairing form.
    Effect::new(move |_| {
        if app.ui.pair_link.get().is_some() {
            method.set("pair".into());
        }
    });
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
                fallback=|| view! { <PairForm /> }
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

#[component]
fn PairForm() -> impl IntoView {
    let app = crate::state::get();
    let input = RwSignal::new(app.ui.pair_link.get_untracked().unwrap_or_default());
    let address = RwSignal::new(String::new());
    let error = RwSignal::new(None::<String>);
    let busy = RwSignal::new(false);
    let verify = RwSignal::new(None::<Verify>);
    Effect::new(move |_| {
        if let Some(link) = app.ui.pair_link.get() {
            input.set(link);
        }
    });
    let target = Memo::new(move |_| {
        let addr = address.get();
        pairing::parse(&input.get(), Some(addr.as_str()), false)
    });
    // Check the daemon's key whenever the target changes; a stale answer is dropped.
    Effect::new(move |_| {
        let Some(t) = target.get() else {
            verify.set(None);
            return;
        };
        verify.set(None);
        spawn_local(async move {
            let v = pairing::verify(app.hosts, &t).await;
            if target.get_untracked().as_ref() == Some(&t) {
                verify.set(Some(v));
            }
        });
    });
    let run = move |as_owner: bool| {
        let Some(t) = target.get_untracked() else {
            error.set(Some(
                "Paste a pairing link or enter the 8-character code".into(),
            ));
            return;
        };
        let verified = match verify.get_untracked() {
            Some(Verify::Refused(m)) => {
                error.set(Some(m));
                return;
            }
            Some(Verify::Verified(v)) => v,
            _ => None,
        };
        error.set(None);
        busy.set(true);
        spawn_local(async move {
            let result = pairing::pair(app.hosts, &t, as_owner, verified).await;
            busy.set(false);
            match result {
                Ok(host) => {
                    app.conn.activate(&host.id);
                    app.ui.pair_link.set(None);
                    input.set(String::new());
                    app.ui.host_sheet_open.set(false);
                    app.toasts.push(
                        Toast::new(ToastKind::Ok, format!("Paired with {}", host.name))
                            .detail(host.endpoint),
                    );
                }
                Err(e) => error.set(Some(e)),
            }
        });
    };
    let details = move || target.get().map(|t| pairing::describe_pair_target(&t));
    let needs_address = move || {
        matches!(
            target.get(),
            Some(frogg_client_core::pairing::PairTarget::Code { .. })
        ) || target.get().is_none()
    };
    view! {
        <div class="add-form">
            <Field label="Code or link" error=Signal::derive(move || error.get())>
                <TextInput value=input placeholder="ABCD-1234 or frogg://pair…" mono=true autofocus=true on_enter=Callback::new(move |_| run(false)) />
            </Field>
            <Show when=needs_address>
                <Field label="Address" hint=Signal::derive(|| Some("Where the daemon listens; codes need it".to_string()))>
                    <TextInput value=address placeholder="192.168.1.20:6767" mono=true on_enter=Callback::new(move |_| run(false)) />
                </Field>
            </Show>
            {move || details().map(|d| {
                let check = match verify.get() {
                    None => "checking key…".to_string(),
                    Some(Verify::Verified(Some(_))) => "key verified".into(),
                    Some(Verify::Verified(None)) => "key checked on connect".into(),
                    Some(Verify::Unverified(m)) => format!("unverified: {m}"),
                    Some(Verify::Refused(m)) => format!("refused: {m}"),
                };
                view! {
                    <div class="coming cut" style="--c:8px">
                        <Icon ico=if d.relay { Ico::Cloud } else { Ico::QrCode } size=18.0 class="cyan2" />
                        <span class="coming-text">
                            <span class="coming-title">{d.name.clone()}</span>
                            <span class="coming-sub t-mono">
                                {d.address.clone()}
                                " · "
                                {pairing::short_fingerprint(d.fingerprint.as_deref(), 4)}
                                {d.role.clone().map(|r| format!(" · {r}"))}
                            </span>
                            <span class="coming-sub">{check}</span>
                        </span>
                    </div>
                }
            })}
            <div class="add-actions">
                <Show when=move || details().is_some_and(|d| d.can_claim)>
                    <Button label="Claim as owner" disabled=Signal::derive(move || busy.get()) on_press=Callback::new(move |_| run(true)) />
                </Show>
                <Button
                    label=Signal::derive(move || if busy.get() { "Pairing…".to_string() } else { "Pair".to_string() })
                    kind=ButtonKind::Primary
                    icon=Ico::Link2
                    disabled=Signal::derive(move || busy.get() || matches!(verify.get(), Some(Verify::Refused(_))))
                    on_press=Callback::new(move |_| run(false))
                />
            </div>
        </div>
    }
}
