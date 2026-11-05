//! The session list's own state (ui-next `sessions/directory.ts`, list half): scope, display
//! prefs, hidden ids and the open sheet, persisted per device. Also the derived reads on a
//! `Session` the list needs (workspace, labels, branch, last error) and small path/time helpers.

use std::cell::Cell;

use leptos::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{storage, Session};

const KEY: &str = "frogg-next:session-list";
/// The label a child session carries naming the agent that started it.
pub const PARENT_AGENT_ID_LABEL: &str = "frogg.parent-agent-id";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Show {
    pub project: bool,
    pub branch: bool,
    pub host: bool,
    pub labels: bool,
    pub provider: bool,
}

impl Default for Show {
    fn default() -> Self {
        Self {
            project: true,
            branch: true,
            host: false,
            labels: true,
            provider: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ListPrefs {
    /// "attention" | "project" | "labels"
    pub group: String,
    /// "recent" | "created" | "title" | "state"
    pub sort: String,
    /// "title" | "branch"
    pub title: String,
    pub show: Show,
    pub label: Option<String>,
    #[serde(rename = "showHidden")]
    pub show_hidden: bool,
}

impl Default for ListPrefs {
    fn default() -> Self {
        Self {
            group: "attention".into(),
            sort: "recent".into(),
            title: "title".into(),
            show: Show::default(),
            label: None,
            show_hidden: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Sheet {
    Labels(String),
    Rename(String),
    Archive(String),
    Import,
    AddProject,
}

#[derive(Default, Serialize, Deserialize)]
struct Saved {
    #[serde(default)]
    prefs: ListPrefs,
    #[serde(default)]
    hidden: Vec<String>,
    #[serde(default)]
    scope: Option<String>,
}

#[derive(Clone, Copy)]
pub struct SessionList {
    /// "all", "chats", "archived", or a project id.
    pub scope: RwSignal<String>,
    pub prefs: RwSignal<ListPrefs>,
    /// Hidden from the list on this device only.
    pub hidden: RwSignal<Vec<String>>,
    pub sheet: RwSignal<Option<Sheet>>,
}

thread_local! {
    static LIST: Cell<Option<SessionList>> = const { Cell::new(None) };
}

/// The list state, built on first use.
pub fn get() -> SessionList {
    if let Some(l) = LIST.with(Cell::get) {
        return l;
    }
    let owner = Owner::new_root(None);
    let l = owner.with(SessionList::build);
    std::mem::forget(owner);
    LIST.with(|c| c.set(Some(l)));
    l
}

impl SessionList {
    fn build() -> Self {
        let saved: Saved = storage::get_json(KEY).unwrap_or_default();
        let l = Self {
            scope: RwSignal::new(saved.scope.unwrap_or_else(|| "all".into())),
            prefs: RwSignal::new(saved.prefs),
            hidden: RwSignal::new(saved.hidden),
            sheet: RwSignal::new(None),
        };
        Effect::new(move |_| {
            let saved = Saved {
                prefs: l.prefs.get(),
                hidden: l.hidden.get(),
                scope: Some(l.scope.get()),
            };
            storage::set_json(KEY, &saved);
        });
        // A host switch closes any open dialog (it pointed into the old host).
        let app = super::get();
        Effect::new(move |prev: Option<Option<String>>| {
            let host = app.hosts.active_id.get();
            if prev.is_some() && prev.as_ref() != Some(&host) {
                l.sheet.set(None);
                let scope = l.scope.get_untracked();
                if scope != "all" && scope != "chats" && scope != "archived" {
                    l.scope.set("all".into());
                }
            }
            host
        });
        l
    }

    pub fn open(&self, sheet: Sheet) {
        self.sheet.set(Some(sheet));
    }

    pub fn close(&self) {
        self.sheet.set(None);
    }

    pub fn toggle_hidden(&self, id: &str) {
        self.hidden.update(|h| {
            if let Some(i) = h.iter().position(|x| x == id) {
                h.remove(i);
            } else {
                h.push(id.to_owned());
            }
        });
    }
}

/// Reads on a session's raw snapshot that the shell's `Agent` struct does not carry.
pub trait SessionExt {
    fn workspace_id(&self) -> Option<String>;
    fn last_error(&self) -> Option<String>;
    fn attention_at(&self) -> String;
    fn branch(&self) -> Option<String>;
    fn project_name(&self) -> String;
    fn parent_id(&self) -> Option<String>;
    fn first_permission(&self) -> Option<Value>;
}

impl SessionExt for Session {
    fn workspace_id(&self) -> Option<String> {
        match self.agent.raw.get("workspaceId")? {
            Value::String(s) => Some(s.clone()),
            Value::Null => None,
            v => Some(v.to_string()),
        }
    }

    fn last_error(&self) -> Option<String> {
        self.agent
            .raw
            .get("lastError")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
    }

    fn attention_at(&self) -> String {
        self.agent
            .raw
            .get("attentionTimestamp")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| self.agent.updated_at.clone())
    }

    fn branch(&self) -> Option<String> {
        let c = &self.project.as_ref()?.checkout;
        if c.get("isGit").and_then(Value::as_bool) != Some(true) {
            return None;
        }
        c.get("currentBranch")
            .and_then(Value::as_str)
            .map(str::to_owned)
    }

    fn project_name(&self) -> String {
        self.project
            .as_ref()
            .map(|p| p.project_name.clone())
            .unwrap_or_else(|| paths::base_name(&self.agent.cwd))
    }

    fn parent_id(&self) -> Option<String> {
        self.agent
            .raw
            .get("labels")?
            .get(PARENT_AGENT_ID_LABEL)?
            .as_str()
            .filter(|id| *id != self.agent.id)
            .map(str::to_owned)
    }

    fn first_permission(&self) -> Option<Value> {
        self.agent.pending_permissions.first().cloned()
    }
}

/// Milliseconds since the epoch for an ISO timestamp (0 when unparseable).
pub fn parse_ms(iso: &str) -> f64 {
    let v = js_sys::Date::parse(iso);
    if v.is_nan() {
        0.0
    } else {
        v
    }
}

fn now_ms() -> f64 {
    js_sys::Date::now()
}

/// Compact age: "now", "5m", "3h", "2d", "4w", "1y".
pub fn ago(iso: &str) -> String {
    let t = parse_ms(iso);
    if t == 0.0 {
        return String::new();
    }
    let s = ((now_ms() - t) / 1000.0).max(0.0);
    if s < 45.0 {
        "now".into()
    } else if s < 3600.0 {
        format!("{}m", (s / 60.0).round().max(1.0))
    } else if s < 86400.0 {
        format!("{}h", (s / 3600.0).floor())
    } else if s < 86400.0 * 7.0 {
        format!("{}d", (s / 86400.0).floor())
    } else if s < 86400.0 * 365.0 {
        format!("{}w", (s / (86400.0 * 7.0)).floor())
    } else {
        format!("{}y", (s / (86400.0 * 365.0)).floor())
    }
}

/// Calendar bucket for a past session, newest first.
pub fn age_group(iso: &str) -> &'static str {
    const DAY: f64 = 86_400_000.0;
    let now = now_ms();
    let t = parse_ms(iso);
    let today = js_sys::Date::new_0();
    today.set_hours(0);
    today.set_minutes(0);
    today.set_seconds(0);
    today.set_milliseconds(0);
    let midnight = today.get_time();
    if t >= midnight {
        "Today"
    } else if t >= midnight - DAY {
        "Yesterday"
    } else if now - t < 7.0 * DAY {
        "Previous 7 days"
    } else if now - t < 30.0 * DAY {
        "This month"
    } else {
        "Older"
    }
}

pub fn provider_label(id: &str) -> String {
    match id {
        "claude" => "Claude Code".into(),
        "codex" => "Codex".into(),
        "gemini" => "Gemini".into(),
        "opencode" => "OpenCode".into(),
        "copilot" => "Copilot".into(),
        "cursor" => "Cursor".into(),
        other => {
            let mut c = other.chars();
            c.next()
                .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
                .unwrap_or_default()
        }
    }
}

/// Host path helpers (ui-next `sessions/paths.ts`).
pub mod paths {
    pub fn is_windows(p: &str) -> bool {
        let b = p.as_bytes();
        (b.len() >= 2 && b[1] == b':' && b[0].is_ascii_alphabetic()) || p.starts_with("\\\\")
    }

    pub fn is_system_folder(name: &str) -> bool {
        let n = name.to_lowercase();
        n.starts_with('$')
            || matches!(
                n.as_str(),
                "system volume information" | "recovery" | "config.msi" | "msocache"
            )
    }

    fn sep(p: &str) -> char {
        if is_windows(p) {
            '\\'
        } else {
            '/'
        }
    }

    pub fn join(dir: &str, name: &str) -> String {
        let s = sep(dir);
        if dir.ends_with(s) {
            format!("{dir}{name}")
        } else {
            format!("{dir}{s}{name}")
        }
    }

    pub fn is_drive_root(p: &str) -> bool {
        is_windows(p) && p.trim_end_matches(['\\', '/']).len() <= 2
    }

    pub fn parent(p: &str) -> String {
        let s = sep(p);
        let t = p.trim_end_matches(s);
        if is_drive_root(p) {
            return p.to_owned();
        }
        match t.rfind(s) {
            Some(0) | None if s == '/' => "/".into(),
            Some(i) => {
                let head = &t[..i];
                if is_windows(head) && head.len() == 2 {
                    format!("{head}\\")
                } else {
                    head.to_owned()
                }
            }
            None => p.to_owned(),
        }
    }

    pub fn base_name(p: &str) -> String {
        p.trim_end_matches(['/', '\\'])
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or("")
            .to_owned()
    }

    /// `/home/me/x` → `~/x` (display only).
    pub fn tilde(p: &str) -> String {
        let parts: Vec<&str> = p.split('/').collect();
        if parts.len() >= 3 && parts[0].is_empty() && (parts[1] == "home" || parts[1] == "Users") {
            let rest = parts[3..].join("/");
            if rest.is_empty() {
                "~".into()
            } else {
                format!("~/{rest}")
            }
        } else {
            p.to_owned()
        }
    }

    /// A typed path, trimmed of quotes and whitespace.
    pub fn typed(p: &str) -> String {
        p.trim().trim_matches(['"', '\'']).trim().to_owned()
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn unix() {
            assert_eq!(parent("/home/me/x"), "/home/me");
            assert_eq!(parent("/home"), "/");
            assert_eq!(parent("/"), "/");
            assert_eq!(join("/", "a"), "/a");
            assert_eq!(base_name("/a/b/"), "b");
            assert_eq!(tilde("/home/me/src"), "~/src");
        }

        #[test]
        fn windows() {
            assert_eq!(parent("C:\\Users\\me"), "C:\\Users");
            assert_eq!(parent("C:\\Users"), "C:\\");
            assert!(is_drive_root("C:\\"));
            assert_eq!(join("C:\\", "x"), "C:\\x");
        }
    }
}
