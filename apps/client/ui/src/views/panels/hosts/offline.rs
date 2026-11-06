//! The active host when it isn't connected: waiting, retrying, refused, or the wrong daemon
//! (ui-next `hosts/Offline.tsx`). Offers "Use this daemon" (re-bind to the daemon now at the
//! address), a TLS flip when the other scheme answers, and "Retry now" with a retry track.

use leptos::prelude::*;
use leptos::task::spawn_local;

use crate::components::{Button, ButtonKind};
use crate::state::config;
use crate::state::hosts::Host;
use crate::state::hostview::{self, open_add_host, HostDialog};
use crate::state::Conn;

use super::access::{auth_refusal, identity_mismatch, offline_reason};

/// Re-binds the host to the daemon now at its address and connects; it then pairs afresh.
fn adopt(host_id: &str, actual: &str) {
    let app = crate::state::get();
    let next = app.hosts.update(host_id, |h| {
        h.server_id = Some(actual.to_owned());
        h.password = None;
        h.fingerprint = None;
        h.role = None;
        h.last_online_at = None;
    });
    if next.is_some() {
        app.conn.activate(host_id);
    }
}

#[component]
fn RetryTrack(connecting: bool, attempt: u32) -> impl IntoView {
    view! {
        <div class="retry-row">
            <div class="retry-track">{connecting.then(|| view! { <div class="retry-scan"></div> })}</div>
            <span class=if connecting { "t-mono retry-on" } else { "t-mono retry-idle" }>
                {if connecting {
                    format!("retrying · attempt {attempt}")
                } else {
                    format!("waiting to retry · {} tried", attempt.saturating_sub(1))
                }}
            </span>
        </div>
    }
}

/// A different daemon answers at the host's address.
#[component]
pub fn MismatchBanner(
    host: Host,
    expected: String,
    actual: String,
    retry: Option<(bool, u32)>,
) -> impl IntoView {
    let hv = hostview::get();
    let id = StoredValue::new(host.id.clone());
    let actual_s = StoredValue::new(actual.clone());
    let n = host.name.clone();
    view! {
        <div class="off-banner">
            <div class="off-head">
                <span class="off-flag live"></span>
                <span class="hd-strong">{format!("A different Frogg daemon is answering at {}", host.endpoint)}</span>
            </div>
            <span class="off-body">
                {format!(
                    "It isn't the daemon {n} was saved for, so Frogg keeps its sessions off this host{}. Use this daemon if it replaced {n} (this app pairs or signs in with it again), or edit the address if {n} moved.",
                    if retry.is_some() { format!(" and keeps checking for {n}") } else { String::new() }
                )}
            </span>
            <span class="t-mono off-ids">{format!("saved {expected} · answering {actual}")}</span>
            {retry.map(|(c, a)| view! { <RetryTrack connecting=c attempt=a /> })}
            <div class="set-acts">
                <Button kind=ButtonKind::Primary label="Use this daemon" on_press=Callback::new(move |_| adopt(&id.get_value(), &actual_s.get_value())) />
                <Button label="Edit address…" on_press=Callback::new(move |_| hv.open(HostDialog::Edit(id.get_value()))) />
                <Button kind=ButtonKind::Danger label="Remove host…" on_press=Callback::new(move |_| hv.open(HostDialog::Remove(id.get_value()))) />
            </div>
        </div>
    }
}

#[component]
pub fn Offline(host: Host) -> impl IntoView {
    let app = crate::state::get();
    let hv = hostview::get();
    let id = StoredValue::new(host.id.clone());
    let link = Memo::new(move |_| app.conn.active_link());
    let err = move || {
        app.conn
            .client_of(&id.get_value())
            .and_then(|c| c.last_error_info())
    };
    // The TLS probe: does the daemon answer only over the other scheme?
    let tls_wrong = RwSignal::new(false);
    let probed = StoredValue::new(false);
    let relay = host.is_relay();
    let tls = host.tls == Some(true);
    let endpoint = host.endpoint.clone();
    Effect::new(move |_| {
        let l = link.get();
        let first = l.conn == Conn::Connecting && l.attempt == 0 && l.error.is_none();
        let e = err();
        let down =
            !first && auth_refusal(e.as_ref()).is_none() && identity_mismatch(e.as_ref()).is_none();
        if !down || relay || probed.get_value() {
            return;
        }
        probed.set_value(true);
        let endpoint = endpoint.clone();
        spawn_local(async move {
            if crate::state::pairing::fetch_server_id(&endpoint, !tls)
                .await
                .is_some()
            {
                let _ = tls_wrong.try_set(true);
            }
        });
    });
    let host = StoredValue::new(host);
    let banner = move || {
        let h = host.get_value();
        let l = link.get();
        let e = err();
        let connecting = l.conn == Conn::Connecting;
        let attempt = l.attempt + 1;
        if let Some((expected, actual)) = identity_mismatch(e.as_ref()) {
            let retry = (connecting || l.attempt > 0).then_some((connecting, attempt));
            return view! { <MismatchBanner host=h expected=expected actual=actual retry=retry /> }
                .into_any();
        }
        let refusal = auth_refusal(e.as_ref());
        let first = connecting && l.attempt == 0 && l.error.is_none();
        let last = h.last_online_at.as_deref().map(config::ago);
        let (title, body) = if first {
            (format!("Connecting to {}…", h.name), h.endpoint.clone())
        } else if let Some(r) = &refusal {
            (r.title.clone(), r.body.clone())
        } else {
            (
                format!("Can't reach {}", h.name),
                format!(
                    "{}.{} Sessions on this host are paused here and come back when it does.",
                    offline_reason(e.as_ref(), l.error.as_deref()).trim_end_matches('.'),
                    last.map(|l| format!(" Last connected {l}."))
                        .unwrap_or_default()
                ),
            )
        };
        let wrong = tls_wrong.get() && refusal.is_none();
        let primary = if let Some(r) = &refusal {
            view! { <Button kind=ButtonKind::Primary label=r.action on_press=Callback::new(|_| open_add_host(true)) /> }.into_any()
        } else if wrong {
            view! {
                <Button
                    kind=ButtonKind::Primary
                    label=if tls { "Turn off TLS" } else { "Turn on TLS" }
                    on_press=Callback::new(move |_| {
                        if app.hosts.update(&id.get_value(), |h| h.tls = (!tls).then_some(true)).is_some() {
                            app.conn.activate(&id.get_value());
                        }
                    })
                />
            }
            .into_any()
        } else {
            view! { <Button kind=ButtonKind::Primary label="Retry now" on_press=Callback::new(move |_| app.conn.activate(&id.get_value())) /> }.into_any()
        };
        let endpoint = h.endpoint.clone();
        view! {
            <div class="off-banner" class:wait=first>
                <div class="off-head">
                    <span class="off-flag" class:wait=first class:live=refusal.is_none()></span>
                    <span class="hd-strong">{title}</span>
                </div>
                <span class="off-body">{body}</span>
                {wrong.then(|| view! {
                    <span class="off-hint">
                        {if tls {
                            format!("{endpoint} answers without TLS. Turn TLS off for this host to connect.")
                        } else {
                            format!("{endpoint} only answers over TLS. Turn TLS on for this host to connect.")
                        }}
                    </span>
                })}
                {(refusal.is_none() && !first).then(|| view! { <RetryTrack connecting=connecting attempt=attempt /> })}
                <div class="set-acts">
                    {primary}
                    <Button
                        label=if refusal.is_some() { "Add the password…" } else { "Edit host…" }
                        on_press=Callback::new(move |_| hv.open(HostDialog::Edit(id.get_value())))
                    />
                    <Button kind=ButtonKind::Danger label="Remove host…" on_press=Callback::new(move |_| hv.open(HostDialog::Remove(id.get_value()))) />
                </div>
            </div>
        }
        .into_any()
    };
    view! {
        {banner}
        <div class="hd-grid">
            <super::Card title="Connections">
                <super::Routes host_id=id.get_value() />
            </super::Card>
        </div>
    }
}
