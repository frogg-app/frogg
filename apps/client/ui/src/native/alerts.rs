//! OS notifications for session events, honouring the Notifications settings: the `desktop`
//! (or `push` on Android) channel of `deliver[kind]`, the `sound` channel with `playSound`, and
//! quiet hours (`quietFrom`–`quietTo`, which hold desktop and push).
//!
//! Neither ui-next nor apps/ui sends these yet; this is the Rust client's own. It watches every
//! connected host's sessions and raises one alert per transition into "needs you", "failed" or
//! "finished" while the window isn't focused (a focused window has toasts and the Inbox).

use std::collections::HashMap;

use leptos::prelude::*;
use serde_json::Value;

use crate::state::agents::{bucket_of, Bucket};

/// The notification kind (a `deliver` key) a bucket change raises, if any.
pub fn transition(prev: Bucket, next: Bucket) -> Option<&'static str> {
    if prev == next {
        return None;
    }
    match next {
        Bucket::Needs => Some("needsYou"),
        Bucket::Failed => Some("failed"),
        Bucket::Review | Bucket::Idle if prev == Bucket::Working => Some("finished"),
        _ => None,
    }
}

/// Minutes since midnight of an `HH:MM` string.
fn minutes(s: &str) -> Option<u32> {
    let (h, m) = s.trim().split_once(':')?;
    let (h, m) = (h.parse::<u32>().ok()?, m.parse::<u32>().ok()?);
    (h < 24 && m < 60).then_some(h * 60 + m)
}

/// Whether `now` (minutes since local midnight) falls in quiet hours `from`–`to`, which may wrap
/// past midnight. Unparsable or equal bounds mean no quiet hours.
pub fn in_quiet_hours(from: &str, to: &str, now: u32) -> bool {
    match (minutes(from), minutes(to)) {
        (Some(f), Some(t)) if f < t => now >= f && now < t,
        (Some(f), Some(t)) if f > t => now >= f || now < t,
        _ => false,
    }
}

fn now_minutes() -> u32 {
    let d = js_sys::Date::new_0();
    d.get_hours() * 60 + d.get_minutes()
}

fn window_focused() -> bool {
    web_sys::window()
        .and_then(|w| w.document())
        .and_then(|d| d.has_focus().ok())
        .unwrap_or(true)
}

fn channel(prefs: &serde_json::Map<String, Value>, kind: &str, ch: &str) -> bool {
    prefs
        .get("deliver")
        .and_then(|d| d.get(kind))
        .and_then(|r| r.get(ch))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// What an alert of `kind` should do now: `None` to stay silent, else whether to play sound.
pub fn decide(
    prefs: &serde_json::Map<String, Value>,
    kind: &str,
    mobile: bool,
    now: u32,
) -> Option<bool> {
    let ch = if mobile { "push" } else { "desktop" };
    let on = channel(prefs, kind, ch) || (mobile && channel(prefs, kind, "desktop"));
    if !on {
        return None;
    }
    let text = |k: &str| {
        prefs
            .get(k)
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned()
    };
    if in_quiet_hours(&text("quietFrom"), &text("quietTo"), now) {
        return None;
    }
    let sound = prefs
        .get("playSound")
        .and_then(Value::as_bool)
        .unwrap_or(true)
        && channel(prefs, kind, "sound");
    Some(sound)
}

fn copy(kind: &str, title: &str, host: &str) -> (String, String) {
    let head = match kind {
        "needsYou" => "Needs you",
        "failed" => "Failed",
        _ => "Finished",
    };
    (format!("{head}: {title}"), host.to_owned())
}

/// Starts the watcher; call once from the app root after the stores exist.
pub fn install() {
    let app = crate::state::get();
    let seen = StoredValue::new_local(HashMap::<(String, String), Bucket>::new());
    let mobile = crate::native::platform() == crate::native::Platform::Android;
    Effect::new(move |_| {
        let mut fire = Vec::new();
        app.agents.by_host.with(|hosts| {
            seen.update_value(|seen| {
                let mut next = HashMap::new();
                for (host, sessions) in hosts {
                    let known = seen.keys().any(|(h, _)| h == host);
                    for (id, s) in sessions {
                        if s.agent.archived_at.is_some() {
                            continue;
                        }
                        let key = (host.clone(), id.clone());
                        let b = bucket_of(&s.agent);
                        // A host's first snapshot only records; a new session on a known host
                        // counts as coming from Idle.
                        if known {
                            let prev = seen.get(&key).copied().unwrap_or(Bucket::Idle);
                            if let Some(kind) = transition(prev, b) {
                                fire.push((kind, host.clone(), s.agent.title_or_untitled()));
                            }
                        }
                        next.insert(key, b);
                    }
                    if sessions.is_empty() && !known {
                        // Remember the host so its first session alerts.
                        next.insert((host.clone(), String::new()), Bucket::Idle);
                    }
                }
                *seen = next;
            });
        });
        if fire.is_empty() || window_focused() {
            return;
        }
        let prefs = app.prefs.all.get_untracked();
        let now = now_minutes();
        for (kind, host, title) in fire {
            let Some(sound) = decide(&prefs, kind, mobile, now) else {
                continue;
            };
            let host_name = app
                .hosts
                .find_untracked(&host)
                .map(|h| h.name)
                .unwrap_or_default();
            let (t, body) = copy(kind, &title, &host_name);
            crate::native::notify_with(&t, Some(body.as_str()).filter(|b| !b.is_empty()), sound);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn transitions() {
        assert_eq!(transition(Bucket::Working, Bucket::Needs), Some("needsYou"));
        assert_eq!(
            transition(Bucket::Working, Bucket::Review),
            Some("finished")
        );
        assert_eq!(transition(Bucket::Working, Bucket::Idle), Some("finished"));
        assert_eq!(transition(Bucket::Idle, Bucket::Failed), Some("failed"));
        assert_eq!(transition(Bucket::Idle, Bucket::Working), None);
        assert_eq!(transition(Bucket::Needs, Bucket::Needs), None);
        assert_eq!(transition(Bucket::Idle, Bucket::Review), None);
    }

    #[test]
    fn quiet_hours() {
        assert!(in_quiet_hours("22:00", "07:30", 23 * 60));
        assert!(in_quiet_hours("22:00", "07:30", 60));
        assert!(!in_quiet_hours("22:00", "07:30", 12 * 60));
        assert!(in_quiet_hours("09:00", "17:00", 10 * 60));
        assert!(!in_quiet_hours("09:00", "17:00", 17 * 60));
        assert!(!in_quiet_hours("", "07:30", 60));
        assert!(!in_quiet_hours("8:00", "8:00", 8 * 60));
    }

    #[test]
    fn decides_by_prefs() {
        let p = |v: Value| v.as_object().cloned().unwrap();
        let prefs = p(json!({
            "deliver": { "finished": { "desktop": true, "sound": true }, "failed": { "push": true } },
            "playSound": true, "quietFrom": "22:00", "quietTo": "07:00"
        }));
        assert_eq!(decide(&prefs, "finished", false, 12 * 60), Some(true));
        assert_eq!(decide(&prefs, "finished", false, 23 * 60), None);
        assert_eq!(decide(&prefs, "failed", false, 12 * 60), None);
        assert_eq!(decide(&prefs, "failed", true, 12 * 60), Some(false));
        let mut quiet = prefs.clone();
        quiet.insert("playSound".into(), json!(false));
        assert_eq!(decide(&quiet, "finished", false, 12 * 60), Some(false));
    }
}
