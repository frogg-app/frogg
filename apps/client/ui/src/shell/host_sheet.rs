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
    let address = RwSignal::new(crate::state::connection::known_endpoint().unwrap_or_default());
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
    // A one-second tick for the offer countdown.
    let (now, set_now) = signal(js_sys::Date::now());
    if let Ok(h) = set_interval_with_handle(
        move || {
            let _ = set_now.try_set(js_sys::Date::now());
        },
        std::time::Duration::from_secs(1),
    ) {
        on_cleanup(move || h.clear());
    }
    let expired = move || {
        details()
            .and_then(|d| d.expires_at)
            .and_then(|iso| countdown(&iso, now.get()))
            .is_some_and(|e| e == "expired")
    };
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
            // ui-next `PairConfirm`: the confirm step every pairing route ends in.
            {move || {
                let raw = input.get();
                let raw = raw.trim();
                (target.get().is_none() && looks_like_link(raw)).then(|| view! {
                    <div class="pair-confirm">
                        <span class="pair-title">"Not a pairing link"</span>
                        <span class="pair-note">
                            "This link does not carry a Frogg pairing offer. Ask the host for a fresh link or code."
                        </span>
                    </div>
                })
            }}
            {move || details().map(|d| {
                let v = verify.get();
                let fp = match &v {
                    Some(Verify::Verified(Some(id))) => Some(id.fingerprint.clone()),
                    _ => d.fingerprint.clone(),
                };
                let fp_text = if fp.is_some() {
                    format!("SHA256:{}", pairing::short_fingerprint(fp.as_deref(), 4))
                } else {
                    "shown after connecting".into()
                };
                let (pill, tint) = match &v {
                    Some(Verify::Verified(_)) => ("verified", "mint"),
                    Some(Verify::Refused(_)) => ("mismatch", "coral"),
                    None => ("checking", "amber"),
                    Some(Verify::Unverified(_)) => ("unverified", "amber"),
                };
                let role = if d.claim {
                    "Owner (claiming this host)".to_string()
                } else {
                    match d.role.as_deref() {
                        Some(r) => format!("{} (set by the host)", role_label(r)),
                        None => "Set by the host".into(),
                    }
                };
                let expires_at = d.expires_at.clone();
                let expires = move || expires_at.as_deref().and_then(|iso| countdown(iso, now.get()));
                let expires_line = expires.clone();
                view! {
                    <div class="pair-confirm">
                        <span class="pair-title">{format!("Pair with {}?", d.name)}</span>
                        <div class="pair-line"><span class="pair-k">"Address"</span><span class="pair-v">{d.address.clone()}</span></div>
                        <div class="pair-line">
                            <span class="pair-k">"Host key"</span>
                            <span class="pair-fp">
                                <span class="t-mono pair-fp-t">{fp_text}</span>
                                <span class="pill t-mono" style=format!("--tint:var(--{tint})")>{pill}</span>
                            </span>
                        </div>
                        <div class="pair-line"><span class="pair-k">"Your role"</span><span class="pair-v">{role}</span></div>
                        {move || expires_line().map(|e| {
                            let warn = e == "expired";
                            view! {
                                <div class="pair-line">
                                    <span class="pair-k">"Offer expires"</span>
                                    <span class="pair-v" class:warn=warn>{e}</span>
                                </div>
                            }
                        })}
                        {d.server_id.clone().map(|id| view! {
                            <div class="pair-line"><span class="pair-k">"Server ID"</span><span class="pair-v t-mono">{id}</span></div>
                        })}
                        {match &v {
                            Some(Verify::Refused(m)) => Some(view! { <span class="pair-err">{m.clone()}</span> }.into_any()),
                            Some(Verify::Unverified(m)) => Some(view! { <span class="pair-note">{format!("Couldn't check the host's key yet: {m}")}</span> }.into_any()),
                            _ => None,
                        }}
                        {d.relay.then(|| view! {
                            <span class="pair-note">"Reached through the relay, end-to-end encrypted to this key. No shared network needed."</span>
                        })}
                        {d.can_claim.then(|| view! {
                            <span class="pair-note">"If this host has no owner yet you can claim it instead, which makes this device its owner."</span>
                        })}
                    </div>
                }
            })}
            <div class="add-actions">
                <Show when=move || details().is_some_and(|d| d.can_claim)>
                    <Button label="Claim as owner" disabled=Signal::derive(move || busy.get() || matches!(verify.get(), Some(Verify::Refused(_)))) on_press=Callback::new(move |_| run(true)) />
                </Show>
                <Button
                    label=Signal::derive(move || if busy.get() { "Pairing…".to_string() } else { "Pair".to_string() })
                    kind=ButtonKind::Primary
                    icon=Ico::Link2
                    disabled=Signal::derive(move || busy.get() || expired() || matches!(verify.get(), Some(Verify::Refused(_))))
                    on_press=Callback::new(move |_| run(false))
                />
            </div>
        </div>
    }
}

fn role_label(role: &str) -> &str {
    match role {
        "owner" => "Owner",
        "operator" => "Operator",
        "viewer" => "Viewer",
        other => other,
    }
}

/// Input that is plainly meant as a link (not a typed code).
fn looks_like_link(raw: &str) -> bool {
    raw.contains("://") || raw.starts_with("frogg:")
}

/// ui-next `useCountdown`: "in 9:41" for a future ISO time, "expired" once past.
fn countdown(iso: &str, now_ms: f64) -> Option<String> {
    let t = js_sys::Date::parse(iso);
    if !t.is_finite() {
        return None;
    }
    Some(countdown_from((t - now_ms) / 1000.0))
}

fn countdown_from(left_secs: f64) -> String {
    let left = left_secs.floor() as i64;
    if left <= 0 {
        "expired".into()
    } else {
        format!("in {}:{:02}", left / 60, left % 60)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn countdown_formats() {
        assert_eq!(countdown_from(581.4), "in 9:41");
        assert_eq!(countdown_from(0.2), "expired");
        assert_eq!(countdown_from(-5.0), "expired");
        assert!(looks_like_link("https://x/pair#a"));
        assert!(!looks_like_link("ABCD-1234"));
    }
}
