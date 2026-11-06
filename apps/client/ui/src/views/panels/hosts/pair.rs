//! Owner side of pairing (ui-next `hosts/PairDevice.tsx`, `Qr.tsx`, `useCountdown`): mint a
//! code for a role as soon as the dialog opens, show it as a QR code, a link (relay or this
//! network) and an 8-character code, with copy, a new code and an expiry countdown.

use leptos::prelude::*;
use leptos::task::spawn_local;
use qrcodegen::{QrCode, QrCodeEcc};
use serde_json::{json, Value};

use crate::components::{Button, ButtonKind, Seg};
use crate::shell::toast::{Toast, ToastKind};
use crate::state::config::{self, ns};
use crate::state::hostview;
use crate::state::pairing::short_fingerprint;
use crate::views::settings::kit::opts;

use super::access::pairing_error_text;

const ROLES: &[(&str, &str)] = &[
    ("owner", "Owner"),
    ("operator", "Operator"),
    ("viewer", "Viewer"),
];
const ROUTES: &[(&str, &str)] = &[
    ("relay", "Through the relay"),
    ("direct", "On this network"),
];
const QR_SIZE: f64 = 176.0;

/// The QR code of `value` as one SVG path (quiet zone of 2 modules), light modules in `--bg`
/// on a `--text` square like ui-next's.
pub fn qr_path(value: &str) -> Option<(String, i32)> {
    let qr = QrCode::encode_text(value, QrCodeEcc::Medium).ok()?;
    let n = qr.size();
    let mut d = String::new();
    for y in 0..n {
        let mut x = 0;
        while x < n {
            if !qr.get_module(x, y) {
                x += 1;
                continue;
            }
            let start = x;
            while x < n && qr.get_module(x, y) {
                x += 1;
            }
            let w = x - start;
            d.push_str(&format!("M{} {}h{w}v1h-{w}z", start + 2, y + 2));
        }
    }
    Some((d, n + 4))
}

#[component]
pub fn Qr(
    #[prop(into)] value: Signal<String>,
    #[prop(optional)] size: Option<f64>,
) -> impl IntoView {
    let size = size.unwrap_or(200.0);
    move || {
        match qr_path(&value.get()) {
        Some((d, n)) => view! {
            <svg class="qr" width=size height=size viewBox=format!("0 0 {n} {n}") aria-label="QR code" role="img">
                <rect width=n height=n fill="var(--text)" />
                <path d=d fill="var(--bg)" />
            </svg>
        }
        .into_any(),
        None => view! { <div class="qr-empty" style=format!("width:{size}px;height:{size}px")></div> }.into_any(),
    }
    }
}

/// "in 9:41" until `iso`, "expired" once past; None without a parsable time.
pub fn countdown_text(left_secs: f64) -> String {
    if left_secs <= 0.0 {
        return "expired".to_owned();
    }
    let left = left_secs.floor() as u64;
    format!("in {}:{:02}", left / 60, left % 60)
}

/// A ticking countdown to `iso` (ui-next `useCountdown`).
pub fn use_countdown(iso: Signal<Option<String>>) -> Signal<Option<String>> {
    let now = RwSignal::new(js_sys::Date::now());
    if let Ok(h) = set_interval_with_handle(
        move || now.set(js_sys::Date::now()),
        std::time::Duration::from_millis(1000),
    ) {
        on_cleanup(move || h.clear());
    }
    Signal::derive(move || {
        let t = iso.get()?;
        let at = js_sys::Date::parse(&t);
        (!at.is_nan()).then(|| countdown_text((at - now.get()) / 1000.0))
    })
}

#[derive(Clone, Debug, PartialEq)]
struct Minted {
    code: String,
    expires_at: Option<String>,
    fingerprint: String,
    direct: Option<String>,
    relay: Option<String>,
}

fn copy(text: String, what: &'static str) {
    spawn_local(async move {
        let ok = crate::native::clipboard_write(&text).await.is_ok();
        crate::state::get().toasts.push(if ok {
            Toast::new(ToastKind::Ok, format!("Copied {what}"))
        } else {
            Toast::new(ToastKind::Error, format!("Couldn't copy the {what}"))
        });
    });
}

/// The pair-a-device dialog body; mints on mount and whenever the role or "New code" changes.
#[component]
pub fn PairDevice() -> impl IntoView {
    let hv = hostview::get();
    let role = RwSignal::new("operator".to_owned());
    let route = RwSignal::new("relay".to_owned());
    let minted = RwSignal::new(None::<Minted>);
    let error = RwSignal::new(None::<String>);
    let nonce = RwSignal::new(0u32);
    let alive = StoredValue::new(true);
    on_cleanup(move || {
        let _ = alive.try_set_value(false);
    });
    Effect::new(move |_| {
        let r = role.get();
        let n = nonce.get();
        error.set(None);
        let Ok(c) = config::need() else {
            error.set(Some("Not connected to this host.".into()));
            return;
        };
        spawn_local(async move {
            let (code, offer) = futures::join!(
                ns(
                    &c,
                    "auth.pairing_code.create.request",
                    json!({ "role": r, "ttlSeconds": 600 })
                ),
                ns(&c, "daemon.get_pairing_offer.request", json!({})),
            );
            // Drop answers for a role or nonce the user already moved past.
            if !alive.try_get_value().unwrap_or(false)
                || role.get_untracked() != r
                || nonce.get_untracked() != n
            {
                return;
            }
            let code = match code {
                Ok(v) if v.get("code").and_then(Value::as_str).is_some() => v,
                Ok(v) => {
                    let e = v
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("This host did not mint a code")
                        .to_owned();
                    error.set(Some(pairing_error_text(
                        &e,
                        config::caller_role().as_deref(),
                    )));
                    return;
                }
                Err(e) => {
                    error.set(Some(pairing_error_text(
                        &e,
                        config::caller_role().as_deref(),
                    )));
                    return;
                }
            };
            let relay = offer
                .ok()
                .filter(|o| o.get("relayEnabled").and_then(Value::as_bool) == Some(true))
                .and_then(|o| o.get("url").and_then(Value::as_str).map(str::to_owned));
            if relay.is_none() {
                route.set("direct".into());
            }
            minted.set(Some(Minted {
                code: config::s(&code, "code"),
                expires_at: code
                    .get("expiresAt")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                fingerprint: config::s(&code, "fingerprint"),
                direct: code
                    .pointer("/endpoints/0/deepLink")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                relay,
            }));
        });
    });
    let link = Memo::new(move |_| {
        let m = minted.get()?;
        if route.get() == "relay" {
            m.relay.or(m.direct)
        } else {
            m.direct
        }
    });
    let expires = use_countdown(Signal::derive(move || {
        minted.get().and_then(|m| m.expires_at)
    }));
    let cells = move || {
        let code = minted
            .get()
            .map(|m| m.code.replace('-', ""))
            .unwrap_or_default();
        let mut chars: Vec<char> = code.chars().collect();
        chars.resize(8.max(chars.len()), ' ');
        chars
            .into_iter()
            .enumerate()
            .map(|(i, c)| view! { <span class="pair-cell t-mono" class:gap=i == 3>{c.to_string()}</span> })
            .collect_view()
    };
    view! {
        <div class="pair-device">
            <div class="pair-row">
                <div class="pair-qr">
                    {move || match link.get() {
                        Some(l) => view! { <Qr value=l size=QR_SIZE /> }.into_any(),
                        None => view! { <div class="qr-empty" style=format!("width:{QR_SIZE}px;height:{QR_SIZE}px")></div> }.into_any(),
                    }}
                </div>
                <div class="pair-side">
                    <span class="t-label">"Role for the new device"</span>
                    <Seg options=opts(ROLES) value=role on_change=Callback::new(move |v| role.set(v)) />
                    <Show when=move || minted.get().is_some_and(|m| m.relay.is_some())>
                        <Seg options=opts(ROUTES) value=route on_change=Callback::new(move |v| route.set(v)) />
                    </Show>
                    <span class="t-label">"Code"</span>
                    <div class="pair-cells">{cells}</div>
                    <span class="t-label">"Link"</span>
                    <div class="pair-link"><span class="t-mono">{move || link.get().unwrap_or_else(|| "…".into())}</span></div>
                    <div class="set-acts">
                        <Button
                            label="Copy link"
                            disabled=Signal::derive(move || link.get().is_none())
                            on_press=Callback::new(move |_| if let Some(l) = link.get_untracked() { copy(l, "link") })
                        />
                        <Button
                            label="Copy code"
                            disabled=Signal::derive(move || minted.get().is_none())
                            on_press=Callback::new(move |_| if let Some(m) = minted.get_untracked() { copy(m.code, "code") })
                        />
                        <Button label="New code" on_press=Callback::new(move |_| nonce.update(|n| *n += 1)) />
                    </div>
                    {move || minted.get().map(|m| {
                        let relay = route.get() == "relay" && m.relay.is_some();
                        view! {
                            <span class="pair-note">
                                {move || format!("Expires {} · fingerprint ", expires.get().unwrap_or_else(|| "soon".into()))}
                                <span class="t-mono cyan2">{short_fingerprint(Some(&m.fingerprint), 2)}</span>
                                {if relay {
                                    " · reached through the relay, so the device needs no shared network."
                                } else {
                                    " · reached on this network."
                                }}
                                " Anyone with this link can request access; the role is fixed by the code."
                            </span>
                        }
                    })}
                </div>
            </div>
            <div class="pair-foot">
                <span class=move || if error.get().is_some() { "pair-foot-t err" } else { "pair-foot-t" }>
                    {move || error.get().unwrap_or_else(|| "QR, link and code are the same offer.".into())}
                </span>
                <Button kind=ButtonKind::Primary label="Done" on_press=Callback::new(move |_| hv.close()) />
            </div>
        </div>
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qr_draws_runs() {
        let (d, n) = qr_path("frogg-next-rs://pair?x=1").unwrap();
        assert!(n >= 25);
        assert!(d.starts_with('M'));
    }

    #[test]
    fn countdown() {
        assert_eq!(countdown_text(0.0), "expired");
        assert_eq!(countdown_text(581.4), "in 9:41");
        assert_eq!(countdown_text(5.0), "in 0:05");
    }
}
