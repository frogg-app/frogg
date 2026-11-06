//! Strips above the composer (ui-next `chat/Notices.tsx`): a running move or clean cut with its
//! elapsed time, a message queued behind it, a lapsed prompt cache and a pending auto-resume.
//! Also "who else is here" (ui-next `chat/Viewers.tsx`, `daemon/viewers.ts`).

use std::time::Duration;

use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::{json, Value};

use super::session_state::{self as ops, clock, has_feature};
use super::toast_err;
use crate::components::{Ico, Icon, StatusGlyph};
use crate::state::{Bucket, Session};

/// Ticks every `ms` while mounted.
fn use_now(ms: Signal<u64>) -> ReadSignal<f64> {
    let (now, set_now) = signal(js_sys::Date::now());
    Effect::new(move |_| {
        let every = ms.get();
        if let Ok(h) = set_interval_with_handle(
            move || {
                let _ = set_now.try_set(js_sys::Date::now());
            },
            Duration::from_millis(every),
        ) {
            on_cleanup(move || h.clear());
        }
    });
    now
}

fn k_tokens(n: u64) -> String {
    if n >= 1000 {
        format!("{}k", (n as f64 / 1000.0).round())
    } else {
        n.to_string()
    }
}

fn parse_ms(iso: &str) -> Option<f64> {
    let t = js_sys::Date::parse(iso);
    (!t.is_nan()).then_some(t)
}

/// The prompt cache TTL per provider (protocol `prompt-cache.ts`), with the config's idle
/// threshold overrides; None when the provider has no known cache.
pub fn idle_threshold_ms(provider: &str, settings: Option<&Value>) -> Option<f64> {
    let minutes = |v: Option<&Value>| {
        v.and_then(|v| v.get("idleThresholdMinutes"))
            .and_then(Value::as_f64)
    };
    let per = settings
        .and_then(|s| s.get("providers"))
        .and_then(|p| p.get(provider));
    if let Some(m) = minutes(per) {
        return Some(m * 60_000.0);
    }
    let ttl = matches!(provider, "claude" | "codex").then_some(60.0 * 60_000.0)?;
    Some(minutes(settings).map(|m| m * 60_000.0).unwrap_or(ttl))
}

#[component]
fn Link(label: &'static str, run: Callback<()>) -> impl IntoView {
    view! { <button class="nt-link" on:click=move |_| run.run(())>{label}</button> }
}

/// The notices for the open session; draws nothing when there is nothing to say.
#[component]
pub fn ComposerNotices(session: Memo<Option<Session>>) -> impl IntoView {
    let id = Memo::new(move |_| {
        session.with(|s| s.as_ref().map(|s| s.agent.id.clone()).unwrap_or_default())
    });
    let op = Memo::new(move |_| ops::op_of(&id.get()));
    let queued = Memo::new(move |_| ops::queued_of(&id.get()));
    let resume_at = Memo::new(move |_| {
        session.with(|s| {
            s.as_ref()?
                .agent
                .raw
                .get("autoResume")?
                .get("resumeAt")?
                .as_str()
                .and_then(parse_ms)
        })
    });
    let fast = Signal::derive(move || {
        if resume_at.get().is_some() || op.with(Option::is_some) {
            1000
        } else {
            30_000
        }
    });
    let now = use_now(fast);
    let cfg = crate::state::config::get();
    let cold = Memo::new(move |_| {
        if op.with(Option::is_some) {
            return false;
        }
        let Some(s) = session.get() else { return false };
        let a = &s.agent;
        let at = |k: &str| a.raw.get(k).and_then(Value::as_str).and_then(parse_ms);
        if a.status == "running" || at("lastUserMessageAt").is_none() {
            return false;
        }
        let Some(last) = at("lastUsageAt").or_else(|| at("lastUserMessageAt")) else {
            return false;
        };
        let settings = cfg.at("/cleanCut");
        idle_threshold_ms(&a.provider, settings.as_ref()).is_some_and(|ttl| now.get() - last > ttl)
    });
    let tokens = move || {
        session.with(|s| {
            s.as_ref()?
                .agent
                .raw
                .get("lastUsage")?
                .get("contextWindowUsedTokens")?
                .as_u64()
        })
    };
    let do_cut = Callback::new(move |_| {
        let id = id.get_untracked();
        ops::run_session_op(
            &id.clone(),
            ops::cut_text(),
            ops::clean_cut(id, Default::default()),
        );
    });
    let cancel = Callback::new(move |_| {
        let id = id.get_untracked();
        spawn_local(async move {
            let Some(c) = super::client_or_toast() else {
                return;
            };
            if let Err(e) = c.cancel_agent_auto_resume(&id).await {
                toast_err("Could not cancel auto-resume", e);
            }
        });
    });
    let drop_q = Callback::new(move |_| ops::drop_queued(&id.get_untracked()));
    let send_now = Callback::new(move |_| {
        let id = id.get_untracked();
        spawn_local(async move {
            if let Err(e) = ops::send_queued(id).await {
                toast_err("Message not sent", e);
            }
        });
    });
    let any = move || {
        cold.get()
            || resume_at.get().is_some()
            || op.with(Option::is_some)
            || queued.with(Option::is_some)
    };
    view! {
        <Show when=any>
            <div class="nt-list">
                {move || op.get().map(|o| view! {
                    <div class="nt-note nt-progress m-enter" aria-live="polite">
                        <StatusGlyph bucket=Bucket::Working size=7.0 />
                        <span class="nt-t">{format!("{}…", o.label)}</span>
                        <span class="t-mono nt-clock">{move || clock(now.get() - o.started_at)}</span>
                        <span class="nt-hint">"Anything you send now waits for it"</span>
                        <div class="nt-track"><div class="nt-beam"></div></div>
                    </div>
                })}
                {move || queued.get().map(|q| {
                    let extra = q.atts.len();
                    let mut preview = q.text.split_whitespace().collect::<Vec<_>>().join(" ");
                    if preview.is_empty() && extra > 0 {
                        preview = "Attachments".into();
                    } else if extra > 0 {
                        preview.push_str(&if extra == 1 { " · 1 attachment".to_owned() } else { format!(" · {extra} attachments") });
                    }
                    view! {
                        <div class="nt-note m-enter" class:nt-warn=q.failed>
                            <StatusGlyph bucket=if q.failed { Bucket::Needs } else { Bucket::Idle } size=7.0 />
                            <span class=if q.failed { "nt-warn-t" } else { "nt-t" }>
                                {if q.failed { "Not sent, the operation failed" } else { "Queued" }}
                            </span>
                            <span class="nt-preview">{preview}</span>
                            {q.failed.then(|| view! { <Link label="Send now" run=send_now /> })}
                            <Link label=if q.failed { "Discard" } else { "Cancel" } run=drop_q />
                        </div>
                    }
                })}
                <Show when=move || cold.get()>
                    <div class="nt-note nt-warn">
                        <StatusGlyph bucket=Bucket::Needs size=7.0 />
                        <span class="nt-warn-t">
                            "Cache expired: sending re-bills "
                            <b>{move || tokens().map(|t| format!("{} input tokens", k_tokens(t))).unwrap_or_else(|| "the whole conversation".into())}</b>
                        </span>
                        <Show when=move || has_feature("agentCleanCut")>
                            <Link label="Clean cut instead" run=do_cut />
                        </Show>
                    </div>
                </Show>
                {move || resume_at.get().map(|at| view! {
                    <div class="nt-note">
                        <StatusGlyph bucket=Bucket::Working size=7.0 />
                        <span class="nt-t">
                            "Usage limit reached · auto-resume in "
                            <b>{move || clock(at - now.get())}</b>
                        </span>
                        <Link label="Cancel auto-resume" run=cancel />
                    </div>
                })}
            </div>
        </Show>
    }
}

// ----- viewers ------------------------------------------------------------------------------

/// Mirrors the daemon's entry TTL: an entry not heard from for this long is gone.
const VIEWER_TTL_MS: f64 = 90_000.0;
/// Re-report inside the TTL, leaving room for two misses.
const REPORT_MS: u64 = 30_000;
/// Consecutive refusals before the heartbeat stops until something changes.
const MAX_FAILURES: u32 = 3;
/// Avatars shown before the rest fold into "+N".
const STACK: usize = 3;

#[derive(Debug, Clone, PartialEq)]
pub struct Viewer {
    pub id: String,
    pub name: String,
    pub key: String,
    pub client_type: Option<String>,
    pub activity: String,
}

impl Viewer {
    pub fn active(&self) -> bool {
        matches!(self.activity.as_str(), "typing" | "sending" | "input")
    }
}

/// Control characters out, whitespace folded, capped: device names come from other clients.
pub fn clean_name(raw: &str) -> String {
    let s: String = raw
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    s.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(40)
        .collect()
}

/// Everyone in a snapshot but this connection, expired entries dropped.
pub fn others_in(snapshot: &Value, now: f64) -> Vec<Viewer> {
    let s = |p: &Value, k: &str| p.get(k).and_then(Value::as_str).map(str::to_owned);
    snapshot
        .get("participants")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|p| p.get("isSelf").and_then(Value::as_bool) != Some(true))
        .filter(|p| {
            let at = s(p, "activityAt")
                .map(|a| js_sys::Date::parse(&a))
                .unwrap_or(f64::NAN);
            at.is_nan() || now - at < VIEWER_TTL_MS
        })
        .filter_map(|p| {
            let id = s(p, "participantId")?;
            let name = clean_name(&s(p, "deviceName").unwrap_or_default());
            Some(Viewer {
                key: s(p, "clientKey").unwrap_or_else(|| id.clone()),
                id,
                name: if name.is_empty() {
                    "Another device".into()
                } else {
                    name
                },
                client_type: s(p, "clientType"),
                activity: s(p, "activity").unwrap_or_else(|| "viewing".into()),
            })
        })
        .collect()
}

/// One or two letters from the first two words; "?" when nothing printable is left.
pub fn initials(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| *c != '\'' && *c != '’')
        .map(|c| {
            if c.is_alphanumeric() || c.is_whitespace() {
                c
            } else {
                ' '
            }
        })
        .collect();
    let words: Vec<&str> = cleaned.split_whitespace().collect();
    let letters: String = match words.as_slice() {
        [] => return "?".into(),
        [one] => one.chars().take(2).collect(),
        [a, b, ..] => a.chars().take(1).chain(b.chars().take(1)).collect(),
    };
    letters.to_uppercase()
}

fn verb(activity: &str) -> &'static str {
    match activity {
        "typing" => "is typing",
        "sending" => "is sending",
        "input" => "is answering",
        _ => "is here",
    }
}

/// "Pixel 8 is here", "Pixel 8 and Laptop are here", "Pixel 8 is typing · 2 more here".
pub fn describe_viewers(list: &[Viewer]) -> (String, Option<String>) {
    if let Some(a) = list.iter().find(|v| v.active()) {
        let more = list.len() - 1;
        return (
            format!("{} {}", a.name, verb(&a.activity)),
            (more > 0).then(|| format!("{more} more here")),
        );
    }
    match list {
        [] => (String::new(), None),
        [a] => (format!("{} is here", a.name), None),
        [a, b] => (format!("{} and {} are here", a.name, b.name), None),
        [a, ..] => (
            format!("{} and {} others are here", a.name, list.len() - 1),
            None,
        ),
    }
}

const TINTS: [&str; 6] = [
    "var(--violet)",
    "var(--cyan2)",
    "var(--mint)",
    "var(--amber)",
    "var(--coral)",
    "var(--cyan)",
];

/// The same device gets the same tint in every chat.
fn tint_of(key: &str) -> &'static str {
    let mut h: i32 = 0;
    for c in key.encode_utf16() {
        h = h.wrapping_mul(31).wrapping_add(c as i32);
    }
    TINTS[(h.unsigned_abs() as usize) % TINTS.len()]
}

fn device_icon(v: &Viewer) -> Ico {
    let n = v.name.to_lowercase();
    let has = |words: &[&str]| words.iter().any(|w| n.contains(w));
    match v.client_type.as_deref() {
        Some("mobile") => Ico::Smartphone,
        _ if has(&["pixel", "phone", "android", "ios", "iphone", "galaxy"]) => Ico::Smartphone,
        Some("browser") => Ico::Globe,
        _ if has(&["web", "browser", "chrome", "firefox", "safari"]) => Ico::Globe,
        Some("cli" | "mcp") => Ico::Terminal,
        _ => Ico::Laptop,
    }
}

fn avatar(v: &Viewer, first: bool) -> impl IntoView {
    view! {
        <span class="vw-avatar cut" class:overlap=!first style=format!("--c:4px;background:{}", tint_of(&v.key))>
            {initials(&v.name)}
        </span>
    }
}

/// Reports this app as viewing `agent_id` and shows everyone else there. Draws nothing when
/// nobody else has the session open, or the host does not share presence.
#[component]
pub fn Viewers(
    agent_id: String,
    #[prop(into)] online: Signal<bool>,
    /// True while this app's composer holds a draft: reported as "typing" instead of "viewing".
    #[prop(optional, into)]
    typing: Option<Signal<bool>>,
) -> impl IntoView {
    let app = crate::state::get();
    let state = move || {
        if typing.is_some_and(|t| t.get_untracked()) {
            "typing"
        } else {
            "viewing"
        }
    };
    let snapshot = RwSignal::new(Value::Null);
    let agent = StoredValue::new(agent_id);
    let target = move || json!({ "kind": "agent", "agentId": agent.get_value() });
    // Snapshot + live pushes + heartbeat while online; `left` goes out on close.
    let sub = StoredValue::new_local(None::<(frogg_client_core::DaemonClient, u64)>);
    let unsub = move || {
        if let Some((c, id)) = sub.try_update_value(Option::take).flatten() {
            c.unsubscribe(id);
        }
    };
    Effect::new(move |_| {
        unsub();
        snapshot.set(Value::Null);
        if !online.get() {
            return;
        }
        let Some(c) = app.conn.client() else { return };
        if !c.has_feature("sessionPresence") {
            return;
        }
        let me = agent.get_value();
        let id = c.subscribe(move |event| {
            let frogg_client_core::Event::Session(f) = event else {
                return;
            };
            if f.kind != "presence.update" {
                return;
            }
            let Ok(p) = f.payload::<Value>() else { return };
            let t = &p["target"];
            if t["kind"] == "agent" && t["agentId"].as_str() == Some(me.as_str()) {
                let _ = snapshot.try_set(p);
            }
        });
        sub.set_value(Some((c.clone(), id)));
        let t = target();
        let c2 = c.clone();
        spawn_local(async move {
            if let Ok(r) = c2.get_presence(t).await {
                if r.error.is_none() {
                    if let Ok(v) = serde_json::to_value(&r.snapshot) {
                        let _ = snapshot.try_set(v);
                    }
                }
            }
        });
        let failures = std::rc::Rc::new(std::cell::Cell::new(0u32));
        let report = move || {
            if failures.get() >= MAX_FAILURES {
                return;
            }
            let c = c.clone();
            let t = target();
            let failures = failures.clone();
            spawn_local(async move {
                match c.report_presence(t, json!(state()), None).await {
                    Ok(r) if r.error.is_none() => failures.set(0),
                    _ => failures.set(failures.get() + 1),
                }
            });
        };
        report();
        if let Ok(h) = set_interval_with_handle(report, Duration::from_millis(REPORT_MS)) {
            on_cleanup(move || h.clear());
        }
        on_cleanup(move || {
            if let Some(c) = app.conn.client().filter(|c| c.is_connected()) {
                let t = json!({ "kind": "agent", "agentId": agent.try_get_value().unwrap_or_default() });
                spawn_local(async move {
                    let _ = c.report_presence(t, json!("left"), None).await;
                });
            }
        });
    });
    // Starting or clearing a draft goes out at once, not at the next heartbeat.
    if let Some(typing) = typing {
        Effect::new(move |prev: Option<bool>| {
            let now = typing.get();
            if prev.is_some_and(|p| p != now) && online.get_untracked() {
                if let Some(c) = app
                    .conn
                    .client()
                    .filter(|c| c.has_feature("sessionPresence"))
                {
                    let t = target();
                    spawn_local(async move {
                        let _ = c.report_presence(t, json!(state()), None).await;
                    });
                }
            }
            now
        });
    }
    on_cleanup(unsub);
    // A clock so a peer that silently vanished drops off once its entry outlives the TTL.
    let now = use_now(Signal::derive(|| (VIEWER_TTL_MS / 3.0) as u64));
    let viewers = Memo::new(move |_| {
        snapshot.with(|s| {
            if s.is_null() {
                Vec::new()
            } else {
                others_in(s, now.get())
            }
        })
    });
    let pop = RwSignal::new(false);
    move || {
        let list = viewers.get();
        if list.is_empty() {
            return None;
        }
        let (lead, rest) = describe_viewers(&list);
        let active = list.iter().any(Viewer::active);
        let extra = list.len().saturating_sub(STACK);
        let label = format!(
            "Also here: {}",
            list.iter()
                .map(|v| v.name.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        );
        let rows = list.clone();
        Some(view! {
            <div class="vw-anchor">
                <button class="vw-row" aria-label=label on:click=move |_| pop.update(|p| *p = !*p)>
                    <span class="vw-stack">
                        {list.iter().take(STACK).enumerate().map(|(i, v)| avatar(v, i == 0)).collect_view()}
                        {(extra > 0).then(|| view! { <span class="vw-avatar vw-more cut overlap" style="--c:4px">{format!("+{extra}")}</span> })}
                    </span>
                    {active.then(|| view! { <span class="vw-live"></span> })}
                    <span class="vw-lead" class:active=active>{lead}</span>
                    {rest.map(|r| view! { <span class="vw-rest">{format!("· {r}")}</span> })}
                </button>
                <crate::components::Floating open=pop on_close=Callback::new(move |_| pop.set(false)) up=true class="vw-pop">
                    <span class="t-label vw-head">{format!("Also here · {}", rows.len())}</span>
                    {rows.iter().map(|v| view! {
                        <div class="vw-item">
                            {avatar(v, true)}
                            <Icon ico=device_icon(v) size=13.0 />
                            <span class="vw-name">{v.name.clone()}</span>
                            <span class="t-mono vw-act" class:active=v.active()>{match v.activity.as_str() {
                                "typing" => "typing", "sending" => "sending", "input" => "answering", "idle" => "idle", _ => "viewing",
                            }}</span>
                        </div>
                    }).collect_view()}
                </crate::components::Floating>
            </div>
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(name: &str, activity: &str) -> Viewer {
        Viewer {
            id: name.into(),
            name: name.into(),
            key: name.into(),
            client_type: None,
            activity: activity.into(),
        }
    }

    #[test]
    fn describes() {
        assert_eq!(describe_viewers(&[v("A", "viewing")]).0, "A is here");
        assert_eq!(
            describe_viewers(&[v("A", "viewing"), v("B", "idle")]).0,
            "A and B are here"
        );
        assert_eq!(
            describe_viewers(&[v("A", "viewing"), v("B", "typing"), v("C", "viewing")]),
            ("B is typing".into(), Some("2 more here".into()))
        );
        assert_eq!(
            describe_viewers(&[v("A", "x"), v("B", "x"), v("C", "x")]).0,
            "A and 2 others are here"
        );
    }

    #[test]
    fn initials_and_names() {
        assert_eq!(initials("Pixel 8"), "P8");
        assert_eq!(initials("laptop"), "LA");
        assert_eq!(initials("!!"), "?");
        assert_eq!(clean_name("a\u{7}  b"), "a b");
    }

    #[test]
    fn cache_threshold() {
        assert_eq!(idle_threshold_ms("claude", None), Some(3_600_000.0));
        assert_eq!(idle_threshold_ms("gemini", None), None);
        let s =
            json!({"idleThresholdMinutes": 5, "providers": {"codex": {"idleThresholdMinutes": 1}}});
        assert_eq!(idle_threshold_ms("claude", Some(&s)), Some(300_000.0));
        assert_eq!(idle_threshold_ms("codex", Some(&s)), Some(60_000.0));
        assert_eq!(k_tokens(12_400), "12k");
    }
}
