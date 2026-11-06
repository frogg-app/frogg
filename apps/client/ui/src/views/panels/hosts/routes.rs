//! Every saved route to a host, with latency, switching and removal (ui-next
//! `hosts/Routes.tsx`). The route in use pings the live client; alternates time a WebSocket
//! open (relays aren't probed). "Use" reconnects only when the host is the active one.

use leptos::prelude::*;
use leptos::task::spawn_local;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

use crate::components::{Button, ButtonKind, Ico, Icon};
use crate::state::hosts::{Host, HostRoute};
use crate::state::Conn;

const PROBE_TIMEOUT_MS: i32 = 4000;

#[derive(Clone, Copy, Debug, PartialEq)]
enum Probe {
    Ms(u32),
    Down,
}

/// Time to open a WebSocket to a direct route.
async fn probe(endpoint: String, tls: bool) -> Probe {
    let url = format!("{}://{endpoint}/ws", if tls { "wss" } else { "ws" });
    let Ok(ws) = web_sys::WebSocket::new(&url) else {
        return Probe::Down;
    };
    let started = js_sys::Date::now();
    let p = js_sys::Promise::new(&mut |resolve, _| {
        let ok = resolve.clone();
        let open = Closure::once_into_js(move || {
            let _ = ok.call1(&JsValue::NULL, &JsValue::TRUE);
        });
        let down = Closure::<dyn Fn()>::new({
            let r = resolve.clone();
            move || {
                let _ = r.call1(&JsValue::NULL, &JsValue::FALSE);
            }
        })
        .into_js_value();
        ws.set_onopen(Some(open.unchecked_ref()));
        ws.set_onerror(Some(down.unchecked_ref()));
        ws.set_onclose(Some(down.unchecked_ref()));
        if let Some(w) = web_sys::window() {
            let _ = w.set_timeout_with_callback_and_timeout_and_arguments_0(
                down.unchecked_ref(),
                PROBE_TIMEOUT_MS,
            );
        }
    });
    let opened = wasm_bindgen_futures::JsFuture::from(p)
        .await
        .ok()
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    ws.set_onopen(None);
    ws.set_onerror(None);
    ws.set_onclose(None);
    let _ = ws.close();
    if opened {
        Probe::Ms((js_sys::Date::now() - started).round() as u32)
    } else {
        Probe::Down
    }
}

fn latency_label(p: Option<Probe>, r: &HostRoute) -> String {
    match p {
        Some(Probe::Ms(ms)) => format!("{ms} ms"),
        Some(Probe::Down) => "unreachable".into(),
        None if r.relay.is_some() => "via relay".into(),
        None => "…".into(),
    }
}

#[component]
pub fn Routes(host_id: String) -> impl IntoView {
    let app = crate::state::get();
    let id = StoredValue::new(host_id);
    let host = Memo::new(move |_| app.hosts.find(&id.get_value()));
    let active =
        Memo::new(move |_| app.hosts.active_id.get().as_deref() == Some(id.get_value().as_str()));
    let online = Memo::new(move |_| active.get() && app.conn.active_link().conn == Conn::Online);
    let rtt = RwSignal::new(None::<u32>);
    let alive = StoredValue::new(true);
    on_cleanup(move || {
        let _ = alive.try_set_value(false);
    });
    let tick = move || {
        if !online.get_untracked() {
            return;
        }
        let Some(c) = app.conn.client() else { return };
        spawn_local(async move {
            if let Ok(r) = c.ping(Some(5000)).await {
                if alive.try_get_value().unwrap_or(false) {
                    rtt.set(Some(r.rtt_ms.round() as u32));
                }
            }
        });
    };
    Effect::new(move |_| {
        rtt.set(None);
        if online.get() {
            tick();
        }
    });
    if let Ok(h) = set_interval_with_handle(
        move || {
            if alive.try_get_value().unwrap_or(false) {
                tick();
            }
        },
        std::time::Duration::from_millis(5000),
    ) {
        on_cleanup(move || h.clear());
    }
    move || {
        let Some(h) = host.get() else {
            return ().into_any();
        };
        let alts = h.routes.clone().unwrap_or_default();
        let removable = !alts.is_empty();
        let hs = StoredValue::new(h.clone());
        view! {
            <div class="routes">
                <RouteRow host=h.clone() r=h.primary_route() in_use=true removable=removable live=Some(Signal::derive(move || {
                    if online.get() { rtt.get().map(Probe::Ms) } else if active.get() && app.conn.active_link().conn == Conn::Offline { Some(Probe::Down) } else { None }
                })) />
                {alts.into_iter().map(|r| view! { <RouteRow host=hs.get_value() r=r in_use=false removable=true live=None /> }).collect_view()}
            </div>
        }
        .into_any()
    }
}

#[component]
fn RouteRow(
    host: Host,
    r: HostRoute,
    in_use: bool,
    removable: bool,
    live: Option<Signal<Option<Probe>>>,
) -> impl IntoView {
    let app = crate::state::get();
    let own = RwSignal::new(None::<Probe>);
    let confirm = RwSignal::new(false);
    if live.is_none() && r.relay.is_none() {
        let (endpoint, tls) = (r.endpoint.clone(), r.tls == Some(true));
        spawn_local(async move {
            let p = probe(endpoint, tls).await;
            let _ = own.try_set(Some(p));
        });
    }
    let shown = Signal::derive(move || match live {
        Some(s) => s.get(),
        None => own.get(),
    });
    let hid = StoredValue::new(host.id.clone());
    let rid = StoredValue::new(r.id.clone());
    let reconnect_if_active = move |next: Option<Host>| {
        if next.is_some()
            && app.hosts.active_id.get_untracked().as_deref() == Some(hid.get_value().as_str())
        {
            app.conn.activate(&hid.get_value());
        }
    };
    let use_route = Callback::new(move |_| {
        reconnect_if_active(app.hosts.promote_route(&hid.get_value(), &rid.get_value()));
    });
    let remove = Callback::new(move |_| {
        confirm.set(false);
        if in_use {
            // Drop the route in use: the first alternate takes its place.
            let first = app
                .hosts
                .find_untracked(&hid.get_value())
                .and_then(|h| h.routes.and_then(|rs| rs.first().map(|r| r.id.clone())));
            if let Some(first) = first {
                let next = app.hosts.promote_route(&hid.get_value(), &first);
                if let Some(demoted) = next
                    .as_ref()
                    .and_then(|h| h.routes.as_ref()?.first().map(|r| r.id.clone()))
                {
                    app.hosts.remove_route(&hid.get_value(), &demoted);
                }
                reconnect_if_active(next);
            }
        } else {
            app.hosts.remove_route(&hid.get_value(), &rid.get_value());
        }
    });
    let dot = move || match shown.get() {
        Some(Probe::Ms(_)) => "hdot online",
        Some(Probe::Down) => "hdot offline",
        None => "hdot",
    };
    let label_r = r.clone();
    let endpoint = r.endpoint.clone();
    view! {
        <div class="route">
            <span class=dot></span>
            <span class="route-text">
                <span class="t-mono">{format!("{}{}", r.endpoint, if r.tls == Some(true) { " · TLS" } else { "" })}</span>
                <span class="hosts-sub">{if r.relay.is_some() { "Relay" } else { "Direct" }}</span>
            </span>
            <span class="t-mono route-ms">{move || latency_label(shown.get(), &label_r)}</span>
            {in_use.then(|| view! { <span class="t-label">"in use"</span> })}
            {move || {
                if confirm.get() {
                    view! {
                        <Button label="Keep" on_press=Callback::new(move |_| confirm.set(false)) />
                        <Button kind=ButtonKind::Danger label="Remove" on_press=remove />
                    }
                    .into_any()
                } else {
                    let endpoint = endpoint.clone();
                    view! {
                        {(!in_use).then(|| view! { <Button label="Use" on_press=use_route /> })}
                        {removable.then(|| view! {
                            <button class="icon-btn danger" aria-label=format!("Remove route {endpoint}") on:click=move |_| confirm.set(true)>
                                <Icon ico=Ico::Trash2 size=13.0 />
                            </button>
                        })}
                    }
                    .into_any()
                }
            }}
        </div>
    }
}
