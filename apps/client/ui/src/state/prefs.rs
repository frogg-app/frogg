//! Device-local preferences (ui-next `prefs.ts`): settings the daemon does not hold, persisted as
//! one JSON object under the same key. Values are JSON so every ui-next pref round-trips; typed
//! reads go through [`Prefs::get`] or the named helpers.

use leptos::prelude::*;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Map, Value};

use super::storage;

const KEY: &str = "frogg.next.prefs";
const METER_DEFAULTS_V: u64 = 2;

fn ch(inbox: bool, desktop: bool, push: bool, spoken: bool, sound: bool) -> Value {
    json!({ "inbox": inbox, "desktop": desktop, "push": push, "spoken": spoken, "sound": sound })
}

/// `PREF_DEFAULTS` from prefs.ts.
pub fn defaults() -> Map<String, Value> {
    let v = json!({
        "buttonStyle": "gradient",
        "logoMotion": "ripple",
        "shapeLang": "chamfer",
        "toastStyle": "bracket",
        "stateStyle": "edge",
        "subworkStyle": "chip",
        "textReveal": "fade",
        "headingReveal": "stagger",
        "busyEnter": "steer",
        "toolCalls": "full",
        "expandReasoning": false,
        "chatOutline": true,
        "subagents": "tab",
        "serviceUrls": "ask",
        "prLinks": "tool",
        "downloads": "ask",
        "hiddenFolders": false,
        "vim": false,
        "openFiles": "main",
        "openDiffs": "main",
        "externalEditor": "vscode",
        "scrollback": 10000,
        "copyOnSelect": false,
        "legacyRenderer": false,
        "keepDays": "30",
        "railBadge": "attention",
        "deliver": {
            "needsYou": ch(true, true, true, false, true),
            "failed": ch(true, true, true, false, false),
            "finished": ch(true, true, false, false, false),
            "host": ch(true, true, false, false, false),
            "updates": ch(true, false, false, false, false),
            "plugins": ch(true, false, false, false, false),
            "pairing": ch(true, true, true, false, true),
        },
        "playSound": true,
        "quietFrom": "22:00",
        "quietTo": "07:30",
        "companion": true,
        "replyLength": "brief",
        "spokenUpdates": "both",
        "acknowledge": false,
        "audioMode": "call",
        "voiceSpeed": 1.3,
        "pause": "natural",
        "bargeIn": "instant",
        "animateVoice": true,
        "showReplyText": true,
        "codexVoice": false,
        "autoplayAlerts": false,
        "confirmReplies": true,
        "defaultMode": "edits",
        "allowUnattended": true,
        "unattendedWorktreesOnly": true,
        "shiftTab": "safe",
        "meterTimer": true,
        "meterSeconds": 120,
        "meterHover": false,
        "meterAfterReply": false,
        "warnPct": 65,
        "criticalPct": 90,
        "meterAnimate": true,
        "resumeCountdown": "reset",
        "suggestSwitch": true,
        "staleCacheWarning": true,
        "railPinned": false,
        "terminalListHidden": false,
        "terminalsAllHosts": true,
        "sessionsWithTerminals": false,
        "autoPinTabs": false,
        "scmGraph": true,
        "scmSha": true,
        "scmAuthor": false,
        "scmDate": true,
        "scmCompact": false,
        "scmBaseCommits": true,
        "scmStashes": true,
        "toastSeconds": 5,
    });
    match v {
        Value::Object(m) => m,
        _ => Map::new(),
    }
}

/// Saved prefs over the defaults; `deliver` merges per kind like prefs.ts.
fn load() -> Map<String, Value> {
    let mut prefs = defaults();
    let Some(Value::Object(mut saved)) = storage::get_json::<Value>(KEY) else {
        return prefs;
    };
    if saved
        .get("meterDefaultsV")
        .and_then(Value::as_u64)
        .unwrap_or(1)
        < METER_DEFAULTS_V
    {
        for k in ["meterSeconds", "meterHover", "meterAfterReply"] {
            saved.remove(k);
        }
    }
    if let (Some(Value::Object(d)), Some(Value::Object(s))) =
        (prefs.get("deliver").cloned(), saved.remove("deliver"))
    {
        let mut merged = d;
        merged.extend(s);
        prefs.insert("deliver".into(), Value::Object(merged));
    }
    prefs.extend(saved);
    prefs
}

#[derive(Clone, Copy)]
pub struct Prefs {
    pub all: RwSignal<Map<String, Value>>,
}

impl Prefs {
    pub fn init() -> Self {
        let all = RwSignal::new(load());
        Effect::new(move |_| {
            let mut out = all.get();
            out.insert("meterDefaultsV".into(), json!(METER_DEFAULTS_V));
            storage::set_json(KEY, &out);
        });
        Self { all }
    }

    /// A pref, typed; the default when unset or the wrong shape. Reactive.
    pub fn get<T: DeserializeOwned>(&self, key: &str) -> T {
        let v = self.all.with(|m| m.get(key).cloned());
        v.and_then(|v| serde_json::from_value(v).ok())
            .or_else(|| {
                defaults()
                    .remove(key)
                    .and_then(|v| serde_json::from_value(v).ok())
            })
            .expect("pref has a default of this type")
    }

    /// [`Prefs::get`] without subscribing: for values read once at setup.
    pub fn get_untracked<T: DeserializeOwned>(&self, key: &str) -> T {
        untrack(|| self.get(key))
    }

    pub fn set<T: Serialize>(&self, key: &str, value: T) {
        if let Ok(v) = serde_json::to_value(value) {
            self.all.update(|m| {
                m.insert(key.to_owned(), v);
            });
        }
    }

    pub fn flag(&self, key: &str) -> bool {
        self.all
            .with(|m| m.get(key).and_then(Value::as_bool))
            .unwrap_or(false)
    }

    pub fn text(&self, key: &str) -> String {
        self.all
            .with(|m| m.get(key).and_then(Value::as_str).map(str::to_owned))
            .unwrap_or_default()
    }

    pub fn rail_pinned(&self) -> bool {
        self.flag("railPinned")
    }

    /// Toast time on screen in ms; 0 keeps toasts until dismissed.
    pub fn toast_ms(&self) -> u32 {
        let sec = self
            .all
            .with(|m| m.get("toastSeconds").and_then(Value::as_f64))
            .unwrap_or(5.0);
        if sec.is_finite() && sec >= 0.0 {
            (sec * 1000.0) as u32
        } else {
            crate::theme::TOAST_LIFE_MS
        }
    }
}
