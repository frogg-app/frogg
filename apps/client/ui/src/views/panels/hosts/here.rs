//! Host detail cards: "Here now" (paired devices and pairing requests on the active host,
//! ui-next `hosts/HereNow.tsx`) and Tailscale (the daemon machine's node and key expiry,
//! `hosts/Tailscale.tsx` with `@frogg/protocol/tailscale`).

use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::{json, Value};

use crate::components::{Button, ButtonKind, Cut, Icon, Select, SelectOption};
use crate::state::config::{self, need, ns, s};
use crate::state::hosts::Host;
use crate::state::ui::Tool;
use crate::views::settings::kit::{Input, Pill};
use crate::views::settings::pages::host::{device_icon, seen_text};

const ROLES: &[(&str, &str)] = &[
    ("owner", "Owner"),
    ("operator", "Operator"),
    ("viewer", "Viewer"),
];

fn open_devices() {
    let ui = crate::state::get().ui;
    ui.set_tool(Tool::Settings);
    ui.open_settings(Some("devices".into()));
}

fn manage_label(total: usize) -> String {
    if total > 6 {
        format!("All {total} devices…")
    } else {
        "Manage devices…".into()
    }
}

#[component]
pub fn HereNow(owner: bool, role: Option<String>) -> impl IntoView {
    let devices = config::use_rpc(
        |c| async move { ns(&c, "auth.device.list.request", json!({})).await },
        Signal::derive(|| true),
        Some(5_000),
    );
    let requests = config::use_rpc(
        |c| async move { ns(&c, "auth.pairing_request.list.request", json!({})).await },
        Signal::derive(move || owner),
        Some(5_000),
    );
    let role = StoredValue::new(role);
    let refresh = Callback::new(move |_| {
        devices.reload();
        requests.reload();
    });
    let list = Memo::new(move |_| {
        devices.data.get().map(|d| {
            let mut l = d
                .get("devices")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let flag = |d: &Value, k: &str| d.get(k) == Some(&Value::Bool(true));
            l.sort_by_key(|d| (!flag(d, "current"), !flag(d, "connected")));
            l
        })
    });
    // A current daemon lists this app as a device; only an older one admits it unregistered.
    let anonymous = Memo::new(move |_| {
        list.get().is_some_and(|l| {
            !l.iter()
                .any(|d| d.get("current") == Some(&Value::Bool(true)))
        })
    });
    let count = move || {
        list.get().map(|l| {
            let n = l
                .iter()
                .filter(|d| d.get("connected") == Some(&Value::Bool(true)))
                .count()
                + usize::from(anonymous.get());
            format!("{n} connected")
        })
    };
    view! {
        <Cut size=10.0 flip=true class="hd-card">
            <span class="hd-card-t">"Here now"{move || count().map(|c| view! { <span class="faint">{format!(" · {c}")}</span> })}</span>
            <div class="hn-list">
                <Show when=move || anonymous.get()>
                    <div class="hn-line">
                        <Icon ico=crate::components::Ico::Globe size=14.0 class="cyan2" />
                        <span class="grow">
                            <span class="hn-name">"This app"</span>
                            <span class="hn-sub faint">"connected · not registered (the daemon predates device registration)"</span>
                        </span>
                        <Pill text=role.get_value().unwrap_or_else(|| "owner".into()) tint="cyan2" />
                    </div>
                </Show>
                {move || list.get().map(|l| {
                    let total = l.len();
                    view! {
                        {l.into_iter().take(6).map(|d| view! { <DeviceLine d=d owner=owner done=refresh /> }).collect_view()}
                        {(total == 0 && !anonymous.get()).then(|| view! { <span class="muted">"No paired devices."</span> })}
                        <div class="set-acts end">
                            <Button
                                label=manage_label(total)
                                on_press=Callback::new(|_| open_devices())
                            />
                        </div>
                    }
                })}
                {move || (devices.data.get().is_none() && devices.error.get().is_none()).then(|| view! { <span class="muted">"Reading devices…"</span> })}
                {move || devices.error.get().map(|e| view! { <span class="hn-err">{e}</span> })}
                {move || requests.data.get().and_then(|d| d.get("requests").and_then(Value::as_array).cloned()).unwrap_or_default().into_iter().map(|r| view! { <RequestLine r=r done=refresh /> }).collect_view()}
            </div>
        </Cut>
    }
}

#[component]
fn DeviceLine(d: Value, owner: bool, done: Callback<()>) -> impl IntoView {
    let current = d.get("current") == Some(&Value::Bool(true));
    let connected = d.get("connected") == Some(&Value::Bool(true));
    let can_roles = config::feature("deviceRoleManagement") == Some(true) && owner && !current;
    let id = StoredValue::new(s(&d, "id"));
    let name = s(&d, "name");
    let role = s(&d, "role");
    let err = RwSignal::new(None::<String>);
    let renaming = RwSignal::new(false);
    let draft = RwSignal::new(name.clone());
    let call = move |req: &'static str, fields: Value| {
        err.set(None);
        spawn_local(async move {
            let r = match need() {
                Ok(c) => ns(&c, req, fields).await,
                Err(e) => Err(e),
            };
            match r {
                Ok(v) => {
                    if let Some(e) = v.get("error").and_then(Value::as_str) {
                        err.set(Some(e.to_owned()));
                    }
                }
                Err(e) => err.set(Some(e)),
            }
            done.run(());
        });
    };
    let save = Callback::new(move |_| {
        let n = draft.get_untracked().trim().to_owned();
        renaming.set(false);
        if !n.is_empty() {
            call(
                "auth.device.rename.request",
                json!({ "deviceId": id.get_value(), "name": n }),
            );
        }
    });
    view! {
        <div class="hn-device">
            <div class="hn-line">
                <Icon ico=device_icon(&name) size=14.0 class=if current { "cyan2" } else { "muted" } />
                <span class="grow">
                    <span class="hn-name">{name.clone()}</span>
                    <span class=if connected { "hn-sub mint" } else { "hn-sub faint" }>{seen_text(&d)}</span>
                </span>
                {move || if renaming.get() {
                    view! {
                        <Input value=draft autofocus=true on_enter=save />
                        <Button kind=ButtonKind::Primary label="Save" on_press=save />
                    }
                    .into_any()
                } else {
                    let role = role.clone();
                    view! {
                        {if can_roles {
                            view! {
                                <Select
                                    options=ROLES.iter().map(|(v, l)| SelectOption::new(*v, *l)).collect()
                                    value=role
                                    on_change=Callback::new(move |r: String| call("auth.device.set_role.request", json!({ "credentialId": id.get_value(), "role": r })))
                                />
                            }
                            .into_any()
                        } else {
                            view! { <Pill text=role /> }.into_any()
                        }}
                        {(owner || current).then(|| view! { <Button label="Rename" on_press=Callback::new(move |_| renaming.set(true)) /> })}
                    }
                    .into_any()
                }}
            </div>
            {move || err.get().map(|e| view! { <span class="hn-err">{e}</span> })}
        </div>
    }
}

#[component]
fn RequestLine(r: Value, done: Callback<()>) -> impl IntoView {
    let err = RwSignal::new(None::<String>);
    let id = StoredValue::new(s(&r, "id"));
    let decide = move |decision: &'static str| {
        spawn_local(async move {
            let res = match need() {
                Ok(c) => {
                    ns(
                        &c,
                        "auth.pairing_request.decide.request",
                        json!({ "pairingRequestId": id.get_value(), "decision": decision, "role": "operator" }),
                    )
                    .await
                }
                Err(e) => Err(e),
            };
            if let Err(e) = res {
                err.set(Some(e));
            }
            done.run(());
        });
    };
    let addr = r
        .get("remoteAddress")
        .and_then(Value::as_str)
        .map(|a| format!(" · {a}"))
        .unwrap_or_default();
    view! {
        <div class="hn-request">
            <span class="hn-diamond"></span>
            <span class="grow">
                <span class="hd-strong">{format!("{} wants Operator access", s(&r, "deviceName"))}</span>
                <span class="muted">"Match code "<span class="t-mono cyan2">{s(&r, "matchCode")}</span>{format!(" on that device{addr}")}</span>
                {move || err.get().map(|e| view! { <span class="hn-err">{e}</span> })}
            </span>
            <Button label="Deny" on_press=Callback::new(move |_| decide("deny")) />
            <Button kind=ButtonKind::Primary label="Approve" on_press=Callback::new(move |_| decide("approve")) />
        </div>
    }
}

// ----- Tailscale ------------------------------------------------------------------------------

/// Host part of an endpoint, lowercased, without scheme, path or port.
fn strip_port(endpoint: &str) -> String {
    let t = endpoint.trim();
    let t = t.split_once("://").map_or(t, |(_, r)| r);
    let t = t.split('/').next().unwrap_or("");
    if let Some(rest) = t.strip_prefix('[') {
        return rest.split(']').next().unwrap_or("").to_lowercase();
    }
    if t.matches(':').count() == 1 {
        return t.split(':').next().unwrap_or("").to_lowercase();
    }
    t.to_lowercase()
}

/// A MagicDNS `*.ts.net` name, 100.64.0.0/10, or fd7a:115c:a1e0::/48.
pub fn is_tailnet_address(endpoint: &str) -> bool {
    let h = strip_port(endpoint);
    let h = h.trim_end_matches('.');
    if h == "ts.net" || h.ends_with(".ts.net") {
        return true;
    }
    let parts: Vec<&str> = h.split('.').collect();
    if parts.len() == 4
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.len() <= 3 && p.bytes().all(|b| b.is_ascii_digit()))
    {
        let a: u32 = parts[0].parse().unwrap_or(0);
        let b: u32 = parts[1].parse().unwrap_or(0);
        return a == 100 && (64..=127).contains(&b);
    }
    h.starts_with("fd7a:115c:a1e0:")
}

pub fn over_tailscale(h: &Host) -> bool {
    h.relay.is_none() && is_tailnet_address(&h.endpoint)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyLevel {
    None,
    Ok,
    Soon,
    Urgent,
    Expired,
}

/// Level and whole days left for a key expiring `ms_left` from now.
pub fn key_expiry(ms_left: Option<f64>) -> (KeyLevel, Option<u64>) {
    let Some(ms) = ms_left.filter(|m| !m.is_nan()) else {
        return (KeyLevel::None, None);
    };
    let days = (ms / 86_400_000.0).floor().max(0.0) as u64;
    let level = if ms <= 0.0 {
        KeyLevel::Expired
    } else if days < 3 {
        KeyLevel::Urgent
    } else if days < 14 {
        KeyLevel::Soon
    } else {
        KeyLevel::Ok
    };
    (level, Some(days))
}

fn fmt_date(iso: &str) -> String {
    let d = js_sys::Date::new(&wasm_bindgen::JsValue::from_str(iso));
    let o = js_sys::Object::new();
    for (k, v) in [("day", "numeric"), ("month", "short"), ("year", "numeric")] {
        let _ = js_sys::Reflect::set(&o, &k.into(), &v.into());
    }
    String::from(d.to_locale_date_string("default", &o))
}

#[component]
pub fn TailscaleCard(host: Host, info: Option<Value>) -> impl IntoView {
    let node = info
        .as_ref()
        .and_then(|i| i.get("tailscale"))
        .filter(|n| n.is_object())
        .cloned();
    let via = over_tailscale(&host);
    if node.is_none() && !via {
        return ().into_any();
    }
    let expiry = node
        .as_ref()
        .and_then(|n| n.get("keyExpiry"))
        .and_then(Value::as_str)
        .map(str::to_owned);
    let (level, days) = key_expiry(
        expiry
            .as_deref()
            .map(|e| js_sys::Date::parse(e) - js_sys::Date::now()),
    );
    let warn = matches!(level, KeyLevel::Soon | KeyLevel::Urgent | KeyLevel::Expired);
    let mut key_line = expiry
        .as_deref()
        .filter(|_| level != KeyLevel::None)
        .map(|e| {
            let date = fmt_date(e);
            match (level, days) {
                (KeyLevel::Expired, _) => format!("The node key expired on {date}."),
                (_, Some(0)) => format!("The node key expires today ({date})."),
                (_, Some(d)) => format!(
                    "The node key expires in {d} day{} ({date}).",
                    if d == 1 { "" } else { "s" }
                ),
                _ => String::new(),
            }
        });
    if node.is_some() && level == KeyLevel::None {
        key_line = Some("Key expiry is disabled for this machine.".into());
    }
    if node.is_none() {
        key_line = Some(
            "This daemon does not report its Tailscale node; update it to see key expiry.".into(),
        );
    }
    let relogin = if level == KeyLevel::Expired {
        "Log this machine in to Tailscale again (tailscale up, or the Tailscale app) to reach it over Tailscale. Disable key expiry for it in the Tailscale admin console to stop this recurring."
    } else {
        "Log this machine in to Tailscale again before then (tailscale up, or the Tailscale app), or disable key expiry for it in the Tailscale admin console. Until it is renewed, Frogg cannot reach this host over Tailscale."
    };
    let logged_out = node
        .as_ref()
        .is_some_and(|n| n.get("online") == Some(&Value::Bool(false)));
    let dns = node
        .as_ref()
        .map(|n| s(n, "dnsName"))
        .filter(|d| !d.is_empty());
    let tint = if level == KeyLevel::Soon {
        "amber"
    } else {
        "coral"
    };
    view! {
        <Cut size=10.0 flip=true class="hd-card">
            <span class="hd-card-t">"Tailscale"</span>
            <span class="hd-strong">
                {if via { "Connected over Tailscale" } else { "Tailscale on this host" }}
                {logged_out.then_some(" · logged out")}
            </span>
            {dns.map(|d| view! { <span class="t-mono faint">{d}</span> })}
            {key_line.map(|k| view! { <span class=if warn { format!("muted {tint}") } else { "muted".to_owned() }>{k}</span> })}
            {warn.then(|| view! { <span class="muted">{relogin}</span> })}
        </Cut>
    }
    .into_any()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tailnet_addresses() {
        assert!(is_tailnet_address("box.tail1234.ts.net:6767"));
        assert!(is_tailnet_address("100.101.2.3:6767"));
        assert!(is_tailnet_address("[fd7a:115c:a1e0::1]:6767"));
        assert!(!is_tailnet_address("100.128.0.1:6767"));
        assert!(!is_tailnet_address("192.168.1.20:6767"));
        assert!(!is_tailnet_address("nets.net:80"));
    }

    #[test]
    fn key_levels() {
        let day = 86_400_000.0;
        assert_eq!(key_expiry(None).0, KeyLevel::None);
        assert_eq!(key_expiry(Some(-1.0)).0, KeyLevel::Expired);
        assert_eq!(key_expiry(Some(2.5 * day)), (KeyLevel::Urgent, Some(2)));
        assert_eq!(key_expiry(Some(10.0 * day)).0, KeyLevel::Soon);
        assert_eq!(key_expiry(Some(30.0 * day)).0, KeyLevel::Ok);
    }
}
