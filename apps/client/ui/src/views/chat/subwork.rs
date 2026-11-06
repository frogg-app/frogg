//! Sub-work (ui-next `components/subwork/*`, `daemon/subwork.ts`): everything a session has
//! running underneath it — provider subagents (and a Workflow's agents nested under them), child
//! sessions, background commands, terminals and workspace scripts — as one list with roll-up
//! counts. A slim live strip under the chat header shows it while it runs; a row opens what it
//! stands for (a child session, a terminal, a claimed to-do, else its details in the chat pane,
//! with a subagent's own timeline streamed live).

use frogg_client_core::{DaemonClient, Event, SubagentTimelineOptions};
use leptos::prelude::*;
use leptos::task::spawn_local;
use serde::Deserialize;
use serde_json::Value;

use super::item::TimelineItem;
use crate::components::{Ico, Icon, StatusGlyph};
use crate::state::bucket_of;
use crate::state::timeline::{self, Timeline};

pub use model::{Item, Kind, Status};

const PARENT_LABEL: &str = crate::state::sessions::PARENT_AGENT_ID_LABEL;
/// The strip stays this long after the last item settles, so the result is readable.
const LINGER_MS: u64 = 2600;
/// One-shot settle flash and glyph pop.
const SETTLE_MS: u64 = 640;

/// The pure model: source shapes, per-source mappers, merge and roll-up. No Leptos, no JS, so
/// it tests natively and other views (session rows, the status summary) can reuse it; some
/// helpers (`describe`, `tone`, `needs_attention`, …) exist for those views.
#[allow(dead_code)]
pub mod model {
    use serde::Deserialize;
    use serde_json::Value;

    use crate::state::Bucket;

    #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
    pub enum Kind {
        Subagent,
        ChildSession,
        BackgroundTask,
        Terminal,
        Script,
    }

    pub const KIND_ORDER: [Kind; 5] = [
        Kind::Subagent,
        Kind::ChildSession,
        Kind::BackgroundTask,
        Kind::Terminal,
        Kind::Script,
    ];

    impl Kind {
        pub fn noun(self) -> &'static str {
            match self {
                Kind::Subagent => "subagent",
                Kind::ChildSession => "child session",
                Kind::BackgroundTask => "background command",
                Kind::Terminal => "terminal",
                Kind::Script => "script",
            }
        }

        pub fn label(self) -> &'static str {
            match self {
                Kind::Subagent => "Subagents",
                Kind::ChildSession => "Child sessions",
                Kind::BackgroundTask => "Background commands",
                Kind::Terminal => "Terminals",
                Kind::Script => "Scripts",
            }
        }
    }

    /// `Attention` is "waiting on you" (a terminal asking for input, a child with a prompt).
    #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
    pub enum Status {
        Running,
        Attention,
        Done,
        Failed,
        Idle,
    }

    impl Status {
        pub fn id(self) -> &'static str {
            match self {
                Status::Running => "running",
                Status::Attention => "attention",
                Status::Done => "done",
                Status::Failed => "failed",
                Status::Idle => "idle",
            }
        }

        pub fn text(self) -> &'static str {
            match self {
                Status::Running => "Running",
                Status::Attention => "Waiting on you",
                Status::Failed => "Failed",
                Status::Done => "Finished",
                Status::Idle => "Stopped",
            }
        }

        pub fn bucket(self) -> Bucket {
            match self {
                Status::Running => Bucket::Working,
                Status::Attention => Bucket::Needs,
                Status::Failed => Bucket::Failed,
                Status::Done => Bucket::Review,
                Status::Idle => Bucket::Idle,
            }
        }

        fn rank(self) -> u8 {
            match self {
                Status::Attention => 0,
                Status::Failed => 1,
                Status::Running => 2,
                Status::Done => 3,
                Status::Idle => 4,
            }
        }
    }

    #[derive(Clone, Debug, PartialEq)]
    pub struct Item {
        pub id: String,
        pub kind: Kind,
        pub label: String,
        pub status: Status,
        /// Epoch ms the work began, when the source says.
        pub started_at: Option<f64>,
        /// Epoch ms it finished, for settled work.
        pub ended_at: Option<f64>,
        /// What it was asked to do, when that differs from the label.
        pub detail: Option<String>,
        /// The latest activity line ("Grep · evictOldest").
        pub activity: Option<String>,
        /// A service script's port.
        pub port: Option<u64>,
        pub parent_id: String,
        /// Another item this one runs under (a Workflow's agents).
        pub nested_under: Option<String>,
        /// The tool call that spawned it.
        pub tool_call_id: Option<String>,
        /// A session or terminal id the row can open.
        pub open_id: Option<String>,
    }

    impl Item {
        fn new(id: String, kind: Kind, label: String, status: Status, parent: &str) -> Self {
            Self {
                id,
                kind,
                label,
                status,
                started_at: None,
                ended_at: None,
                detail: None,
                activity: None,
                port: None,
                parent_id: parent.to_owned(),
                nested_under: None,
                tool_call_id: None,
                open_id: None,
            }
        }

        /// The provider's own id for a subagent row (`sub:<id>`).
        pub fn subagent_id(&self) -> Option<&str> {
            (self.kind == Kind::Subagent)
                .then(|| self.id.strip_prefix("sub:"))
                .flatten()
        }
    }

    #[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
    pub struct Rollup {
        pub running: usize,
        pub attention: usize,
        pub failed: usize,
        pub done: usize,
        pub idle: usize,
        pub total: usize,
        /// Work worth a glance: running, waiting on you or failed.
        pub active: usize,
    }

    // ---- source shapes ------------------------------------------------------------------------

    #[derive(Clone, Debug, Default, PartialEq, Deserialize)]
    #[serde(rename_all = "camelCase", default)]
    pub struct SubagentSrc {
        pub id: String,
        pub parent_agent_id: String,
        pub title: Option<String>,
        pub description: Option<String>,
        /// `running` / `completed` / `failed` / `canceled`.
        pub status: String,
        pub created_at: String,
        pub updated_at: String,
        pub tool_call_id: Option<String>,
        pub subtitle: Option<String>,
        pub parent_subagent_id: Option<String>,
    }

    #[derive(Clone, Debug, Default, PartialEq, Deserialize)]
    #[serde(rename_all = "camelCase", default)]
    pub struct ScriptSrc {
        pub script_name: String,
        pub port: Value,
        /// `running` / `stopped`.
        pub lifecycle: String,
        /// `healthy` / `unhealthy` / null.
        pub health: Value,
        pub exit_code: Option<f64>,
        pub terminal_id: Option<String>,
    }

    #[derive(Clone, Debug, Default, PartialEq, Deserialize)]
    #[serde(rename_all = "camelCase", default)]
    pub struct TermActivity {
        pub state: Option<String>,
        pub attention_reason: Option<String>,
        pub changed_at: Option<f64>,
    }

    #[derive(Clone, Debug, Default, PartialEq, Deserialize)]
    #[serde(rename_all = "camelCase", default)]
    pub struct TerminalSrc {
        pub id: String,
        pub name: String,
        pub title: Option<String>,
        pub activity: Option<TermActivity>,
    }

    #[derive(Clone, Debug, PartialEq)]
    pub struct ChildSrc {
        pub id: String,
        pub title: Option<String>,
        pub bucket: Bucket,
        pub created_at: String,
        pub updated_at: String,
    }

    /// A timeline row: its timestamp and item.
    pub struct TimelineSrc<'a> {
        pub timestamp: Option<&'a str>,
        pub item: &'a Value,
    }

    #[derive(Default)]
    pub struct Sources<'a> {
        pub subagents: &'a [SubagentSrc],
        pub children: &'a [ChildSrc],
        pub timeline: Vec<TimelineSrc<'a>>,
        pub terminals: &'a [TerminalSrc],
        pub scripts: &'a [ScriptSrc],
    }

    /// Epoch ms for an RFC 3339 timestamp (`2026-01-02T03:04:05.678Z`, offsets allowed).
    pub fn iso_ms(s: &str) -> Option<f64> {
        let b = s.trim().as_bytes();
        let num = |r: std::ops::Range<usize>| -> Option<i64> {
            let t = std::str::from_utf8(b.get(r)?).ok()?;
            t.bytes()
                .all(|c| c.is_ascii_digit())
                .then(|| t.parse().ok())?
        };
        if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || b[13] != b':' || b[16] != b':' {
            return None;
        }
        let (y, mo, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
        let (h, mi, sec) = (num(11..13)?, num(14..16)?, num(17..19)?);
        let mut i = 19;
        let mut frac = 0.0;
        if b.get(i) == Some(&b'.') {
            let start = i + 1;
            i = start;
            while b.get(i).is_some_and(u8::is_ascii_digit) {
                i += 1;
            }
            let digits = std::str::from_utf8(&b[start..i]).ok()?;
            frac = format!("0.{digits}").parse::<f64>().ok()?;
        }
        let offset_min = match b.get(i) {
            None | Some(b'Z') | Some(b'z') => 0,
            Some(&sign @ (b'+' | b'-')) => {
                let oh = num(i + 1..i + 3)?;
                let om = num(i + 4..i + 6).or_else(|| num(i + 3..i + 5))?;
                let m = oh * 60 + om;
                if sign == b'+' {
                    m
                } else {
                    -m
                }
            }
            _ => return None,
        };
        // Days from the civil date (Howard Hinnant's algorithm).
        let y2 = if mo <= 2 { y - 1 } else { y };
        let era = y2.div_euclid(400);
        let yoe = y2 - era * 400;
        let mp = (mo + 9) % 12;
        let doy = (153 * mp + 2) / 5 + d - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        let days = era * 146_097 + doe - 719_468;
        let secs = days * 86_400 + h * 3600 + mi * 60 + sec - offset_min * 60;
        Some((secs as f64 + frac) * 1000.0)
    }

    // ---- per-source mappers -------------------------------------------------------------------

    pub fn from_subagent(parent: &str, a: &SubagentSrc) -> Item {
        let status = match a.status.as_str() {
            "running" => Status::Running,
            "completed" => Status::Done,
            "failed" => Status::Failed,
            _ => Status::Idle,
        };
        let title = a.title.clone().filter(|t| !t.trim().is_empty());
        let label = title
            .clone()
            .or_else(|| a.description.clone())
            .unwrap_or_else(|| "Subagent".into());
        let mut it = Item::new(
            format!("sub:{}", a.id),
            Kind::Subagent,
            label,
            status,
            parent,
        );
        it.started_at = iso_ms(&a.created_at);
        it.ended_at = (status != Status::Running)
            .then(|| iso_ms(&a.updated_at))
            .flatten();
        it.detail = match (&title, &a.description) {
            (Some(t), Some(d)) if d != t => Some(d.clone()),
            _ => None,
        };
        it.activity = a.subtitle.clone().filter(|s| !s.is_empty());
        it.nested_under = a.parent_subagent_id.as_ref().map(|p| format!("sub:{p}"));
        it.tool_call_id = a.tool_call_id.clone();
        it
    }

    pub fn from_script(parent: &str, workspace: &str, sc: &ScriptSrc) -> Item {
        let unhealthy = sc.health.as_str() == Some("unhealthy");
        let status = if sc.lifecycle == "running" {
            if unhealthy {
                Status::Failed
            } else {
                Status::Running
            }
        } else if sc.exit_code.is_some_and(|c| c != 0.0) {
            Status::Failed
        } else {
            Status::Idle
        };
        let mut it = Item::new(
            format!("script:{workspace}:{}", sc.script_name),
            Kind::Script,
            sc.script_name.clone(),
            status,
            parent,
        );
        it.port = sc.port.as_u64();
        it.activity = unhealthy.then(|| "unhealthy".into());
        it.open_id = sc.terminal_id.clone();
        it
    }

    pub fn from_terminal(parent: &str, t: &TerminalSrc) -> Item {
        let act = t.activity.clone().unwrap_or_default();
        let status = match act.state.as_deref() {
            Some("working") => Status::Running,
            Some("attention") if act.attention_reason.as_deref() == Some("needs_input") => {
                Status::Attention
            }
            Some("attention") => Status::Done,
            _ => Status::Idle,
        };
        let label = t
            .title
            .clone()
            .filter(|x| !x.is_empty())
            .unwrap_or_else(|| t.name.clone());
        let mut it = Item::new(
            format!("term:{}", t.id),
            Kind::Terminal,
            label,
            status,
            parent,
        );
        it.started_at = act.changed_at;
        it.open_id = Some(t.id.clone());
        it
    }

    pub fn from_child(parent: &str, c: &ChildSrc) -> Item {
        let status = match c.bucket {
            Bucket::Working => Status::Running,
            Bucket::Needs => Status::Attention,
            Bucket::Failed => Status::Failed,
            Bucket::Review | Bucket::Idle => Status::Done,
        };
        let label = c
            .title
            .clone()
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| "Untitled session".into());
        let mut it = Item::new(
            format!("child:{}", c.id),
            Kind::ChildSession,
            label,
            status,
            parent,
        );
        it.started_at = iso_ms(&c.created_at);
        it.ended_at = (c.bucket != Bucket::Working)
            .then(|| iso_ms(&c.updated_at))
            .flatten();
        it.open_id = Some(c.id.clone());
        it
    }

    /// A background command with no settling notification after this long is treated as gone.
    pub const BG_STALE_MS: f64 = 6.0 * 60.0 * 60.0 * 1000.0;

    /// The task id in a "running in the background with ID: abc123" result (`\bID[:\s]+(\w{4,})`).
    fn bg_id(out: &str) -> Option<&str> {
        let b = out.as_bytes();
        let word = |c: u8| c.is_ascii_alphanumeric() || c == b'_';
        let mut i = 0;
        while i + 2 <= b.len() {
            if b[i].eq_ignore_ascii_case(&b'i')
                && b[i + 1].eq_ignore_ascii_case(&b'd')
                && (i == 0 || !word(b[i - 1]))
            {
                let mut j = i + 2;
                while j < b.len() && (b[j] == b':' || b[j].is_ascii_whitespace()) {
                    j += 1;
                }
                let start = j;
                while j < b.len() && (word(b[j]) || b[j] == b'-') {
                    j += 1;
                }
                if start > i + 2 && j - start >= 4 {
                    return Some(&out[start..j]);
                }
            }
            i += 1;
        }
        None
    }

    fn s<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
        v.get(k).and_then(Value::as_str)
    }

    /// Background shells (Bash `run_in_background`) are not on the subagent track: the daemon
    /// leaves a shell tool call whose result says it went to the background, and later a
    /// `task_notification_*` call when it settles. A heuristic, as in ui-next.
    pub fn from_timeline(parent: &str, rows: &[TimelineSrc], now: f64) -> Vec<Item> {
        let call_id = |r: &TimelineSrc| -> Option<String> {
            (s(r.item, "type") == Some("tool_call"))
                .then(|| s(r.item, "callId").map(str::to_owned))
                .flatten()
        };
        let notes: Vec<(&TimelineSrc, String)> = rows
            .iter()
            .filter_map(|r| call_id(r).map(|c| (r, c)))
            .filter(|(_, c)| c.starts_with("task_notification_"))
            .collect();
        let mut out = Vec::new();
        for r in rows {
            let Some(cid) = call_id(r) else { continue };
            let Some(d) = r.item.get("detail") else {
                continue;
            };
            if s(d, "type") != Some("shell") {
                continue;
            }
            let Some(output) = s(d, "output") else {
                continue;
            };
            if !output.to_ascii_lowercase().contains("background") {
                continue;
            }
            // Claude's notifications carry the task id in `metadata.taskId` (the call id is a
            // fresh uuid); older shapes put it in the call id.
            let note = bg_id(output).and_then(|id| {
                notes
                    .iter()
                    .find(|(n, c)| {
                        c.contains(id)
                            || n.item
                                .get("metadata")
                                .and_then(|m| s(m, "taskId"))
                                .is_some_and(|t| t == id)
                    })
                    .map(|n| n.0)
            });
            let started = r.timestamp.and_then(iso_ms);
            let note_status = note.and_then(|n| {
                n.item
                    .get("metadata")
                    .and_then(|m| s(m, "status"))
                    .or_else(|| s(n.item, "status"))
            });
            let status = match note {
                Some(_) if matches!(note_status, Some("failed" | "killed")) => Status::Failed,
                Some(_) => Status::Done,
                None if started.is_some_and(|t| now - t > BG_STALE_MS) => Status::Idle,
                None => Status::Running,
            };
            let cmd = s(d, "command").unwrap_or("command");
            let label: String = cmd
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .take(80)
                .collect();
            let mut it = Item::new(
                format!("bg:{cid}"),
                Kind::BackgroundTask,
                label,
                status,
                parent,
            );
            it.started_at = started;
            it.ended_at = note.and_then(|n| n.timestamp).and_then(iso_ms);
            it.tool_call_id = Some(cid);
            out.push(it);
        }
        out
    }

    // ---- merge and roll-up --------------------------------------------------------------------

    /// Every source as one list: waiting-on-you first, then failed, running, done, idle.
    pub fn merge(parent: &str, workspace: Option<&str>, src: &Sources, now: f64) -> Vec<Item> {
        let mut all: Vec<Item> = src
            .subagents
            .iter()
            .map(|a| from_subagent(parent, a))
            .chain(src.children.iter().map(|c| from_child(parent, c)))
            .chain(from_timeline(parent, &src.timeline, now))
            .chain(src.terminals.iter().map(|t| from_terminal(parent, t)))
            .chain(
                src.scripts
                    .iter()
                    .map(|sc| from_script(parent, workspace.unwrap_or("ws"), sc)),
            )
            .collect();
        // Stable: equal ranks keep source order.
        all.sort_by_key(|x| x.status.rank());
        all
    }

    pub fn rollup(items: &[Item]) -> Rollup {
        let mut r = Rollup {
            total: items.len(),
            ..Rollup::default()
        };
        for x in items {
            match x.status {
                Status::Running => r.running += 1,
                Status::Attention => r.attention += 1,
                Status::Failed => r.failed += 1,
                Status::Done => r.done += 1,
                Status::Idle => r.idle += 1,
            }
        }
        r.active = r.running + r.attention + r.failed;
        r
    }

    /// Items that count toward the chip: settled-and-quiet work (stopped scripts, idle shells)
    /// does not.
    pub fn visible(items: &[Item]) -> Vec<Item> {
        items
            .iter()
            .filter(|x| x.status != Status::Idle)
            .cloned()
            .collect()
    }

    /// Open by default only when something is waiting on you or failed.
    pub fn needs_attention(r: &Rollup) -> bool {
        r.attention + r.failed > 0
    }

    /// Running background work the agent waits on (subagents and background commands): the
    /// "waiting on background work" state card's count.
    pub fn pending_background(items: &[Item]) -> usize {
        items
            .iter()
            .filter(|x| {
                x.status == Status::Running
                    && matches!(x.kind, Kind::Subagent | Kind::BackgroundTask)
            })
            .count()
    }

    /// The tone a roll-up reads in: waiting on you, failed, running, else done.
    pub fn tone(items: &[Item]) -> Status {
        let r = rollup(items);
        if r.attention > 0 {
            Status::Attention
        } else if r.failed > 0 {
            Status::Failed
        } else if r.running > 0 {
            Status::Running
        } else if r.done > 0 {
            Status::Done
        } else {
            Status::Idle
        }
    }

    /// "3 subagents · 1 background command", for captions and labels.
    pub fn describe(items: &[Item]) -> String {
        KIND_ORDER
            .iter()
            .filter_map(|k| {
                let n = items.iter().filter(|x| x.kind == *k).count();
                (n > 0).then(|| format!("{n} {}{}", k.noun(), if n == 1 { "" } else { "s" }))
            })
            .collect::<Vec<_>>()
            .join(" · ")
    }

    /// "12s", "3m 04s", "1h 05m".
    pub fn elapsed(from: f64, to: f64) -> String {
        let s = ((to - from) / 1000.0).floor().max(0.0) as u64;
        if s < 60 {
            format!("{s}s")
        } else if s < 3600 {
            format!("{}m {:02}s", s / 60, s % 60)
        } else {
            format!("{}h {:02}m", s / 3600, (s % 3600) / 60)
        }
    }

    /// The row's time column: ticking run time, "needs you", "stopped", or how long it took.
    pub fn time_text(it: &Item, now: f64) -> String {
        match it.status {
            Status::Running => it.started_at.map(|t| elapsed(t, now)).unwrap_or_default(),
            Status::Attention => "needs you".into(),
            Status::Idle if it.kind == Kind::Script => "stopped".into(),
            Status::Idle => String::new(),
            _ => match (it.started_at, it.ended_at) {
                (Some(a), Some(b)) => elapsed(a, b),
                _ => String::new(),
            },
        }
    }

    /// Puts nested items (a Workflow's agents) straight after the item they run under.
    pub fn nest_order(items: &[Item]) -> Vec<(Item, bool)> {
        let has = |id: &str| items.iter().any(|x| x.id == id);
        let mut out = Vec::new();
        for t in items
            .iter()
            .filter(|x| x.nested_under.as_deref().is_none_or(|p| !has(p)))
        {
            out.push((t.clone(), false));
            for c in items
                .iter()
                .filter(|c| c.nested_under.as_deref() == Some(&t.id))
            {
                out.push((c.clone(), true));
            }
        }
        out
    }

    /// The screen-reader summary of a chip: "4 sub-processes, 2 running, 1 failed".
    pub fn a11y(items: &[Item]) -> String {
        let r = rollup(items);
        let mut parts = vec![format!("{} sub-processes", r.total)];
        if r.running > 0 {
            parts.push(format!("{} running", r.running));
        }
        if r.attention > 0 {
            parts.push(format!("{} need you", r.attention));
        }
        if r.failed > 0 {
            parts.push(format!("{} failed", r.failed));
        }
        parts.join(", ")
    }
}

use model::{ChildSrc, ScriptSrc, SubagentSrc, TerminalSrc};

fn now_ms() -> f64 {
    js_sys::Date::now()
}

// ---- the live store ---------------------------------------------------------------------------

/// One session's sub-work, kept live from the list calls and pushes. `items` is the merged list.
#[derive(Clone, Copy)]
pub struct SubWork {
    /// (host id, parent session id) once bound.
    ctx: RwSignal<Option<(String, String)>>,
    pub subagents: RwSignal<Vec<SubagentSrc>>,
    pub scripts: RwSignal<Vec<ScriptSrc>>,
    pub terminals: RwSignal<Vec<TerminalSrc>>,
    /// Every source merged, attention first.
    pub items: Memo<Vec<Item>>,
    /// The item whose details fill the chat pane.
    pub detail: RwSignal<Option<String>>,
    /// A 1s clock, ticking while anything runs.
    pub now: RwSignal<f64>,
    /// Bumped on every (re)load, so an open detail refetches after a reconnect.
    pub epoch: RwSignal<u64>,
}

impl SubWork {
    /// Creates the store and provides it as context to the chat pane (tool rows read it).
    pub fn new() -> Self {
        let app = crate::state::get();
        let ctx = RwSignal::new(None::<(String, String)>);
        let subagents = RwSignal::new(Vec::<SubagentSrc>::new());
        let scripts = RwSignal::new(Vec::<ScriptSrc>::new());
        let terminals = RwSignal::new(Vec::<TerminalSrc>::new());
        let now = RwSignal::new(now_ms());
        // The background-command staleness cut needs only a coarse clock.
        let minute = Memo::new(move |_| (now.get() / 60_000.0).floor());
        let items = Memo::new(move |_| {
            let Some((host, parent)) = ctx.get() else {
                return Vec::new();
            };
            let session = app.agents.get(&host, &parent);
            let workspace = session
                .as_ref()
                .and_then(|s| s.agent.raw.get("workspaceId"))
                .and_then(Value::as_str)
                .map(str::to_owned);
            let children: Vec<ChildSrc> = app
                .agents
                .list(Some(&host))
                .into_iter()
                .filter(|s| {
                    s.agent
                        .raw
                        .get("labels")
                        .and_then(|l| l.get(PARENT_LABEL))
                        .and_then(Value::as_str)
                        == Some(parent.as_str())
                })
                .map(|s| ChildSrc {
                    bucket: bucket_of(&s.agent),
                    id: s.agent.id,
                    title: s.agent.title,
                    created_at: s.agent.created_at,
                    updated_at: s.agent.updated_at,
                })
                .collect();
            let tl = timeline::get(&host, &parent);
            let entries: Vec<timeline::Entry> =
                tl.rows.with(|r| r.iter().map(|x| x.entry.get()).collect());
            let rows = entries
                .iter()
                .map(|e| model::TimelineSrc {
                    timestamp: e.timestamp.as_deref(),
                    item: &e.item,
                })
                .collect();
            let subs = subagents.get();
            let sc = scripts.get();
            let te = terminals.get();
            model::merge(
                &parent,
                workspace.as_deref(),
                &model::Sources {
                    subagents: &subs,
                    children: &children,
                    timeline: rows,
                    terminals: &te,
                    scripts: &sc,
                },
                minute.get() * 60_000.0,
            )
        });
        let this = Self {
            ctx,
            subagents,
            scripts,
            terminals,
            items,
            detail: RwSignal::new(None),
            now,
            epoch: RwSignal::new(0),
        };
        // One clock for every ticking label; it only moves while something runs.
        if let Ok(h) = set_interval_with_handle(
            move || {
                let live = items
                    .try_with_untracked(|l| l.iter().any(|x| x.status == Status::Running))
                    .unwrap_or(false);
                if live {
                    let _ = now.try_set(now_ms());
                }
            },
            std::time::Duration::from_millis(1000),
        ) {
            on_cleanup(move || h.clear());
        }
        provide_context(this);
        this
    }

    fn bind(&self, host: &str, parent: &str) {
        let next = Some((host.to_owned(), parent.to_owned()));
        if self.ctx.with_untracked(|c| *c != next) {
            self.ctx.set(next);
        }
    }

    /// Loads every source for `parent`: subagents (when the host shares them), the terminals of
    /// its checkout and its workspace's scripts. Failures leave a source empty, never an error.
    pub fn load(&self, client: &DaemonClient, parent: &str) {
        let app = crate::state::get();
        let Some(host) = app.hosts.active_id.get_untracked() else {
            return;
        };
        self.bind(&host, parent);
        self.now.set(now_ms());
        self.epoch.update(|e| *e += 1);
        let this = *self;
        if client.has_feature("providerSubagents") {
            let c = client.clone();
            let parent = parent.to_owned();
            spawn_local(async move {
                let Ok(r) = c.list_provider_subagents(&parent, None).await else {
                    return;
                };
                let list = serde_json::to_value(&r.subagents)
                    .ok()
                    .and_then(|v| serde_json::from_value::<Vec<SubagentSrc>>(v).ok())
                    .unwrap_or_default();
                let _ = this.subagents.try_set(list);
            });
        }
        let session = app.agents.get_untracked(&host, parent);
        if let Some(cwd) = session.as_ref().map(|s| s.agent.cwd.clone()) {
            let _ = client.subscribe_terminals(&cwd, None);
            let c = client.clone();
            spawn_local(async move {
                let Ok(r) = c.list_terminals(Some(&cwd), None).await else {
                    return;
                };
                let list = serde_json::to_value(&r.terminals)
                    .ok()
                    .and_then(|v| serde_json::from_value::<Vec<TerminalSrc>>(v).ok())
                    .unwrap_or_default();
                let _ = this.terminals.try_set(list);
            });
        }
        let workspace = session
            .as_ref()
            .and_then(|s| s.agent.raw.get("workspaceId"))
            .and_then(Value::as_str)
            .map(str::to_owned);
        if let Some(ws) = workspace {
            let c = client.clone();
            spawn_local(async move {
                use frogg_client_core::protocol::inbound::{
                    SessionMessage, WorkspaceScriptListRequest,
                };
                let rid = c.new_request_id();
                let msg = SessionMessage::WorkspaceScriptListRequest(WorkspaceScriptListRequest {
                    workspace_id: ws,
                    request_id: rid.clone(),
                });
                let Ok(f) = c.request(&rid, &msg).await else {
                    return;
                };
                #[derive(Deserialize)]
                struct P {
                    #[serde(default)]
                    scripts: Option<Vec<ScriptSrc>>,
                }
                if let Ok(P {
                    scripts: Some(list),
                }) = f.payload::<P>()
                {
                    let _ = this.scripts.try_set(list);
                }
            });
        }
    }

    /// Applies a push for `parent`: subagent upserts/removals (timeline rows go to an open
    /// subagent timeline), script status and terminal changes.
    pub fn apply(&self, host: &str, parent: &str, kind: &str, p: &Value) {
        match kind {
            "agent.provider_subagents.update" => self.apply_subagent(host, parent, p),
            "script_status_update" => {
                let ws = self.ctx.with_untracked(|c| {
                    c.as_ref()
                        .and_then(|(h, id)| crate::state::get().agents.get_untracked(h, id))
                        .and_then(|s| {
                            s.agent
                                .raw
                                .get("workspaceId")
                                .and_then(Value::as_str)
                                .map(str::to_owned)
                        })
                });
                if ws.is_none() || p.get("workspaceId").and_then(Value::as_str) != ws.as_deref() {
                    return;
                }
                if let Some(list) = p
                    .get("scripts")
                    .and_then(|v| serde_json::from_value::<Vec<ScriptSrc>>(v.clone()).ok())
                {
                    self.scripts.set(list);
                }
            }
            "terminals_changed" => {
                let cwd = crate::state::get()
                    .agents
                    .get_untracked(host, parent)
                    .map(|s| s.agent.cwd);
                if cwd.is_none() || p.get("cwd").and_then(Value::as_str) != cwd.as_deref() {
                    return;
                }
                if let Some(list) = p
                    .get("terminals")
                    .and_then(|v| serde_json::from_value::<Vec<TerminalSrc>>(v.clone()).ok())
                {
                    self.terminals.set(list);
                }
            }
            _ => {}
        }
    }

    fn apply_subagent(&self, host: &str, parent: &str, p: &Value) {
        let kind = p.get("kind").and_then(Value::as_str);
        match kind {
            Some("upsert") => {
                let Some(sub) = p
                    .get("subagent")
                    .and_then(|v| serde_json::from_value::<SubagentSrc>(v.clone()).ok())
                else {
                    return;
                };
                if sub.parent_agent_id != parent || sub.id.is_empty() {
                    return;
                }
                self.subagents
                    .update(|l| match l.iter_mut().find(|x| x.id == sub.id) {
                        Some(x) => *x = sub,
                        None => l.push(sub),
                    });
            }
            Some("remove") | Some("timeline") => {
                if p.get("parentAgentId").and_then(Value::as_str) != Some(parent) {
                    return;
                }
                let Some(id) = p.get("subagentId").and_then(Value::as_str) else {
                    return;
                };
                if kind == Some("remove") {
                    self.subagents.update(|l| l.retain(|x| x.id != id));
                } else {
                    let tl = sub_timeline(host, parent, id);
                    if tl.loaded.get_untracked() {
                        tl.apply_row(p);
                    }
                }
            }
            _ => {}
        }
    }

    /// The live subagent a Task/Agent tool call spawned, matched on its tool call id.
    pub fn spawned(&self, call_id: &str) -> Option<Item> {
        self.items.with(|l| {
            l.iter()
                .find(|x| x.kind == Kind::Subagent && x.tool_call_id.as_deref() == Some(call_id))
                .cloned()
        })
    }

    /// Opens what a row stands for: a child session or a terminal as itself, a subagent linked
    /// to a to-do as that to-do in Tasks, anything else as its details in the chat pane.
    pub fn open(&self, item: &Item) {
        use crate::state::ui::Tool;
        let ui = crate::state::get().ui;
        if item.kind == Kind::ChildSession {
            if let Some(id) = &item.open_id {
                ui.select(Some(id.clone()));
                return;
            }
        }
        if let Some((project, todo)) = linked_todo(item) {
            crate::state::tasks::store()
                .open
                .set(Some((project, todo.id)));
            ui.set_tool(Tool::Tasks);
            return;
        }
        if matches!(item.kind, Kind::Terminal | Kind::Script) {
            if let Some(id) = &item.open_id {
                ui.set_tool(Tool::Terminals);
                ui.open_terminal(Some(id.clone()));
                return;
            }
        }
        self.detail.set(Some(item.id.clone()));
    }
}

/// A loaded to-do this item's agent has claimed: (project id, to-do).
pub fn linked_todo(item: &Item) -> Option<(String, crate::state::tasks::Todo)> {
    let ids: Vec<&str> = [item.subagent_id(), item.open_id.as_deref()]
        .into_iter()
        .flatten()
        .collect();
    if ids.is_empty() {
        return None;
    }
    crate::state::tasks::store().items.with(|all| {
        all.iter().find_map(|(project, list)| {
            list.iter()
                .flatten()
                .find(|t| t.claims.iter().any(|c| ids.contains(&c.agent_id.as_str())))
                .map(|t| (project.clone(), t.clone()))
        })
    })
}

pub fn sub_timeline(host: &str, parent: &str, sub: &str) -> Timeline {
    timeline::get(host, &format!("sub:{parent}:{sub}"))
}

/// Routes the pushes sub-work follows on this client into `work`.
pub fn listen(client: &DaemonClient, host: String, parent: String, work: SubWork) -> u64 {
    work.bind(&host, &parent);
    client.subscribe(move |event| {
        let Event::Session(frame) = event else { return };
        if !matches!(
            frame.kind.as_str(),
            "agent.provider_subagents.update" | "script_status_update" | "terminals_changed"
        ) {
            return;
        }
        if let Ok(p) = frame.payload::<Value>() {
            work.apply(&host, &parent, &frame.kind, &p);
        }
    })
}

// ---- views ------------------------------------------------------------------------------------

fn kind_ico(k: Kind) -> Ico {
    match k {
        Kind::Subagent => Ico::Bot,
        Kind::ChildSession => Ico::GitBranch,
        Kind::BackgroundTask => Ico::Timer,
        Kind::Terminal => Ico::SquareTerminal,
        Kind::Script => Ico::Server,
    }
}

/// Plays once on a live running → done/failed change, never on mount with a final status.
fn settle_of(status: Signal<Status>) -> RwSignal<Option<Status>> {
    let settle = RwSignal::new(None);
    Effect::new(move |prev: Option<Status>| {
        let now = status.get();
        if prev == Some(Status::Running) && matches!(now, Status::Done | Status::Failed) {
            settle.set(Some(now));
            set_timeout(
                move || {
                    let _ = settle.try_set(None);
                },
                std::time::Duration::from_millis(SETTLE_MS),
            );
        }
        now
    });
    settle
}

fn settle_class(s: Option<Status>) -> &'static str {
    match s {
        Some(Status::Failed) => " settle-fail",
        Some(_) => " settle-done",
        None => "",
    }
}

#[component]
fn PortChip(port: u64) -> impl IntoView {
    view! { <span class="sw-port t-mono">{format!(":{port}")}</span> }
}

/// Indented child row: kind glyph, label, port chip, elapsed (ticking while running), status.
#[component]
fn ItemRow(item: Item, last: bool, nested: bool, work: SubWork) -> impl IntoView {
    let id = item.id.clone();
    // The row is keyed on id: its live fields follow the store.
    let cur = {
        let fallback = item.clone();
        Memo::new(move |_| {
            work.items
                .with(|l| l.iter().find(|x| x.id == id).cloned())
                .unwrap_or_else(|| fallback.clone())
        })
    };
    let status = Signal::derive(move || cur.with(|c| c.status));
    let settle = settle_of(status);
    let time = move || {
        let n = work.now.get();
        cur.with(|c| model::time_text(c, n))
    };
    let label = move || cur.with(|c| format!("{} {}, {}", c.kind.noun(), c.label, c.status.id()));
    view! {
        <button
            class=move || {
                format!(
                    "sw-item sw-{}{}{}",
                    status.get().id(),
                    if nested { " nested" } else { "" },
                    settle_class(settle.get()),
                )
            }
            aria-label=label
            on:click=move |_| work.open(&cur.get_untracked())
        >
            <span class="sw-flash" aria-hidden="true"></span>
            <span class="sw-gutter" aria-hidden="true">
                <span class="sw-vline" class:last=last></span>
                <span class="sw-tick"></span>
            </span>
            <span class="sw-item-body">
                <span class="sw-item-top">
                    <Icon ico=Signal::derive(move || kind_ico(cur.with(|c| c.kind))) size=12.0 class="sw-kind" />
                    <span class="sw-item-label">{move || cur.with(|c| c.label.clone())}</span>
                    {move || cur.with(|c| c.port).map(|p| view! { <PortChip port=p /> })}
                    {move || {
                        let t = time();
                        (!t.is_empty()).then(|| view! { <span class="sw-time t-mono">{t}</span> })
                    }}
                    <span class="sw-glyph">
                        <StatusGlyph bucket=Signal::derive(move || status.get().bucket()) size=6.0 still=true />
                    </span>
                </span>
                {move || cur.with(|c| c.activity.clone()).map(|a| view! {
                    <span class="sw-activity t-mono">{a}</span>
                })}
            </span>
        </button>
    }
}

/// The nested rows with their tree connector; `max` caps the list with a "+N more" line.
#[component]
pub fn SubWorkTree(
    #[prop(into)] items: Signal<Vec<Item>>,
    work: SubWork,
    #[prop(optional)] max: Option<usize>,
) -> impl IntoView {
    let rows = Memo::new(move |_| items.with(|l| model::nest_order(l)));
    let shown = Memo::new(move |_| {
        rows.with(|r| {
            let n = max.map_or(r.len(), |m| m.min(r.len()));
            let more = r.len() - n;
            r.iter()
                .take(n)
                .enumerate()
                .map(|(i, (it, nested))| (it.clone(), *nested, i + 1 == n && more == 0))
                .collect::<Vec<_>>()
        })
    });
    let more = move || {
        let total = rows.with(Vec::len);
        total - max.map_or(total, |m| m.min(total))
    };
    view! {
        <div class="sw-tree">
            <For
                each=move || shown.get()
                key=|(it, nested, last)| (it.id.clone(), *nested, *last)
                children=move |(it, nested, last)| view! { <ItemRow item=it last=last nested=nested work=work /> }
            />
            {move || {
                let m = more();
                (m > 0).then(|| view! { <div class="sw-more t-mono">{format!("+{m} more")}</div> })
            }}
        </div>
    }
}

/// The slim live strip under the chat header while sub-work runs: a count and the running
/// names, expanding to the list. When the last item settles it stays for a moment with the
/// result and one settle flash (mint for done, coral if anything failed).
#[component]
pub fn SubWorkStrip(work: SubWork) -> impl IntoView {
    let shown = Memo::new(move |_| work.items.with(|l| model::visible(l)));
    let r = Memo::new(move |_| shown.with(|l| model::rollup(l)));
    let busy = Memo::new(move |_| r.with(|r| r.running + r.attention > 0));
    let open = RwSignal::new(false);
    let linger = RwSignal::new(false);
    let timer = StoredValue::new_local(None::<TimeoutHandle>);
    Effect::new(move |was: Option<bool>| {
        let b = busy.get();
        if was == Some(true) && !b && r.with_untracked(|r| r.total > 0) {
            linger.set(true);
            if let Some(h) = timer.get_value() {
                h.clear();
            }
            if let Ok(h) = set_timeout_with_handle(
                move || {
                    let _ = linger.try_set(false);
                },
                std::time::Duration::from_millis(LINGER_MS),
            ) {
                timer.set_value(Some(h));
            }
        }
        b
    });
    on_cleanup(move || {
        if let Some(h) = timer.try_get_value().flatten() {
            h.clear();
        }
    });
    let visible = Memo::new(move |_| busy.get() || linger.get());
    Effect::new(move |_| {
        if !visible.get() {
            open.set(false);
        }
    });
    let tone = Signal::derive(move || {
        if busy.get() {
            Status::Running
        } else if r.with(|r| r.failed > 0) {
            Status::Failed
        } else {
            Status::Done
        }
    });
    let settle = settle_of(tone);
    let names = move || {
        shown.with(|l| {
            let n: Vec<&str> = l
                .iter()
                .filter(|x| matches!(x.status, Status::Running | Status::Attention))
                .map(|x| x.label.as_str())
                .collect();
            let extra = n.len().saturating_sub(2);
            format!(
                "{}{}",
                n.iter().take(2).copied().collect::<Vec<_>>().join(", "),
                if extra > 0 {
                    format!(" +{extra}")
                } else {
                    String::new()
                }
            )
        })
    };
    view! {
        <div class="subwork-collapse" class:open=move || visible.get()>
            <div class="subwork-clip">
                <div class="subwork">
                    <button
                        class=move || format!("subwork-bar{}", settle_class(settle.get()))
                        aria-label="Sub-processes"
                        aria-expanded=move || open.get().to_string()
                        on:click=move |_| open.update(|o| *o = !*o)
                    >
                        <span class="subwork-beam-clip" aria-hidden="true">
                            <Show when=move || busy.get()>
                                <span class="subwork-beam"></span>
                            </Show>
                        </span>
                        <span class="subwork-flash" aria-hidden="true"></span>
                        <span class=move || format!("subwork-mark sw-{}", tone.get().id()) class:live=move || busy.get()></span>
                        {move || if busy.get() {
                            view! {
                                <span class="subwork-n t-mono">{move || r.with(|r| r.running + r.attention)}</span>
                                <span class="subwork-label">"running"</span>
                                <span class="subwork-names">{names}</span>
                            }
                            .into_any()
                        } else {
                            let (failed, done) = r.with(|r| (r.failed, r.done));
                            let text = if failed > 0 {
                                format!("{failed} failed · {done} finished")
                            } else {
                                "All finished".to_owned()
                            };
                            view! { <span class="subwork-label" class:fail={failed > 0}>{text}</span> }.into_any()
                        }}
                        <span class="spacer"></span>
                        <Icon ico=Ico::ChevronDown size=13.0 class="subwork-chev" />
                    </button>
                    <div class="subwork-collapse" class:open=move || open.get() && visible.get()>
                        <div class="subwork-clip">
                            <div class="subwork-list">
                                <SubWorkTree items=shown work=work max=8 />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    }
}

/// Ticking run time in a subagent tool call's header while its subagent runs.
#[component]
pub fn SpawnedElapsed(#[prop(into)] call_id: String) -> impl IntoView {
    let work = use_context::<SubWork>();
    move || {
        let w = work?;
        let sub = w.spawned(&call_id)?;
        (sub.status == Status::Running).then(|| {
            let t = sub
                .started_at
                .map(|s| model::elapsed(s, w.now.get()))
                .unwrap_or_default();
            view! { <span class="tool-live t-mono">{t}</span> }
        })
    }
}

/// Body link from a subagent tool call to its details (or its to-do, when it claimed one).
#[component]
pub fn SpawnedLink(#[prop(into)] call_id: String) -> impl IntoView {
    let work = use_context::<SubWork>();
    move || {
        let w = work?;
        let sub = w.spawned(&call_id)?;
        let text = format!("Open subagent · {}", sub.status.id());
        Some(view! {
            <button class="tool-link sw-open" on:click=move |_| w.open(&sub)>
                <Icon ico=Ico::Bot size=12.0 />
                {text}
            </button>
        })
    }
}

/// One sub-work item in its parent's chat pane: what it is, its live status and run time, a
/// link back to the conversation (and to its to-do), and for a provider subagent its own
/// activity, streamed while it runs.
#[component]
pub fn SubWorkDetail(
    host: String,
    parent: String,
    id: String,
    work: SubWork,
    #[prop(into)] provider: Signal<String>,
) -> impl IntoView {
    let app = crate::state::get();
    let sid = id.clone();
    let item = Memo::new(move |_| work.items.with(|l| l.iter().find(|s| s.id == sid).cloned()));
    let parent_title = {
        let (h, p) = (host.clone(), parent.clone());
        Memo::new(move |_| {
            app.agents
                .get(&h, &p)
                .and_then(|s| s.agent.title)
                .filter(|t| !t.trim().is_empty())
                .unwrap_or_else(|| "conversation".into())
        })
    };
    let sub_id = id.strip_prefix("sub:").map(str::to_owned);
    let kind = Memo::new(move |_| item.with(|i| i.as_ref().map(|i| i.kind)));
    let head = move || {
        item.get().map(|it| {
            let live = it.status == Status::Running;
            let status = it.status;
            let todo = linked_todo(&it);
            let it2 = it.clone();
            view! {
                <div class="subdetail-head">
                    <div class="subdetail-kind">
                        <Icon ico=kind_ico(it.kind) size=12.0 />
                        <span class="t-label">{it.kind.noun()}</span>
                    </div>
                    <div class="subdetail-title">{it.label.clone()}</div>
                    <div class="subdetail-status">
                        <StatusGlyph bucket=status.bucket() size=7.0 />
                        <span class=format!("sw-status-t sw-{}", status.id())>{status.text()}</span>
                        {move || {
                            let t = model::time_text(&it2, work.now.get());
                            (!t.is_empty()).then(|| view! { <span class="subdetail-time t-mono">{t}</span> })
                        }}
                        {it.port.map(|p| view! { <PortChip port=p /> })}
                    </div>
                    {it.detail.clone().map(|d| view! { <div class="subdetail-detail">{d}</div> })}
                    {it.activity.clone().map(|a| view! {
                        <div class="subdetail-activity t-mono" class:live=live>{a}</div>
                    })}
                    {todo.map(|(project, t)| {
                        let tid = t.id.clone();
                        view! {
                            <button class="subdetail-todo" on:click=move |_| {
                                crate::state::tasks::store().open.set(Some((project.clone(), tid.clone())));
                                app.ui.set_tool(crate::state::ui::Tool::Tasks);
                            }>
                                <Icon ico=Ico::ListTodo size=13.0 />
                                <span>{format!("To-do · {}", t.title)}</span>
                            </button>
                        }
                    })}
                </div>
            }
        })
    };
    let running = Signal::derive(move || {
        item.with(|i| i.as_ref().is_some_and(|i| i.status == Status::Running))
    });
    view! {
        <div class="subdetail m-enter">
            <button class="subdetail-back" on:click=move |_| work.detail.set(None)>
                <Icon ico=Ico::ArrowLeft size=14.0 />
                <span>{move || format!("Back to {}", parent_title.get())}</span>
            </button>
            {move || match (item.with(Option::is_some), kind.get()) {
                (false, _) => view! {
                    <div class="subdetail-gone t-label">"this item has finished and left the list"</div>
                }
                .into_any(),
                _ => ().into_any(),
            }}
            {head}
            {match sub_id {
                Some(sub) => view! {
                    <Activity host=host parent=parent sub=sub provider=provider running=running work=work />
                }
                .into_any(),
                None => view! {
                    <Show when=move || item.with(Option::is_some)>
                        <div class="subdetail-gone t-label">
                            {move || format!("no activity stream for a {}", kind.get().map_or("item", |k| k.noun()))}
                        </div>
                    </Show>
                }
                .into_any(),
            }}
        </div>
    }
}

/// A subagent's own timeline, loaded on open (and again after a reconnect), kept live by the
/// subagent update stream, and pinned to the bottom while it grows unless scrolled up.
#[component]
fn Activity(
    host: String,
    parent: String,
    sub: String,
    #[prop(into)] provider: Signal<String>,
    running: Signal<bool>,
    work: SubWork,
) -> impl IntoView {
    use wasm_bindgen::closure::Closure;
    use wasm_bindgen::JsCast;
    let app = crate::state::get();
    let tl = sub_timeline(&host, &parent, &sub);
    {
        let tl = tl.clone();
        Effect::new(move |_| {
            // `epoch` moves on every (re)load of the session, i.e. after a reconnect.
            work.epoch.track();
            if app.conn.active_link().conn != crate::state::Conn::Online {
                return;
            }
            let Some(c) = app.conn.client() else {
                tl.error.set(Some("Not connected".into()));
                tl.loaded.set(true);
                return;
            };
            if !c.has_feature("providerSubagents") {
                tl.error
                    .set(Some("This host does not share subagent activity.".into()));
                tl.loaded.set(true);
                return;
            }
            let tl = tl.clone();
            let (parent, sub) = (parent.clone(), sub.clone());
            spawn_local(async move {
                let res = c
                    .fetch_provider_subagent_timeline(
                        &parent,
                        &sub,
                        SubagentTimelineOptions {
                            direction: Some("tail".into()),
                            limit: Some(200),
                            ..Default::default()
                        },
                    )
                    .await;
                match res.map(|r| serde_json::to_value(r).unwrap_or_default()) {
                    Ok(v) => {
                        let err = v.get("error").and_then(Value::as_str).map(str::to_owned);
                        tl.reset_from(&v, "rows");
                        tl.error.set(err);
                    }
                    Err(e) => {
                        tl.error.set(Some(e.to_string()));
                        tl.loaded.set(true);
                    }
                }
            });
        });
    }
    // Bottom anchor: follow new rows while within reach of the end.
    let scroller = NodeRef::<leptos::html::Div>::new();
    let pinned = StoredValue::new(true);
    let observer = StoredValue::new_local(None::<(web_sys::ResizeObserver, Closure<dyn FnMut()>)>);
    Effect::new(move |_| {
        let Some(el) = scroller.get() else { return };
        let Some(body) = el.first_element_child() else {
            return;
        };
        let el2 = el.clone();
        let cb = Closure::<dyn FnMut()>::new(move || {
            if pinned.try_get_value().unwrap_or(false) {
                el2.set_scroll_top(el2.scroll_height());
            }
        });
        if let Ok(ro) = web_sys::ResizeObserver::new(cb.as_ref().unchecked_ref()) {
            ro.observe(&body);
            observer.set_value(Some((ro, cb)));
        }
    });
    on_cleanup(move || {
        if let Some((ro, _)) = observer.try_update_value(Option::take).flatten() {
            ro.disconnect();
        }
    });
    let on_scroll = move |_| {
        if let Some(el) = scroller.get_untracked() {
            let gap = el.scroll_height() - el.scroll_top() - el.client_height();
            pinned.set_value(gap <= 48);
        }
    };
    let rows = tl.rows.clone();
    let rows2 = tl.rows.clone();
    let loaded = tl.loaded.clone();
    let loaded2 = tl.loaded.clone();
    let error = tl.error.clone();
    let error2 = tl.error.clone();
    let last_uid = Memo::new(move |_| rows2.with(|r| r.last().map(|x| x.uid)));
    view! {
        <div class="chat-scroll" node_ref=scroller on:scroll=on_scroll>
            <div class="chat-body subdetail-body" on:click=super::lightbox::on_image_click>
                {move || (!loaded.get()).then(|| view! {
                    <div class="tl-loading t-label m-shimmer-text">"Loading subagent activity"</div>
                })}
                {move || error.get().map(|e| view! { <div class="tl-error t-mono">{e}</div> })}
                {move || (loaded2.get() && error2.with(Option::is_none) && last_uid.get().is_none()).then(|| view! {
                    <div class="subdetail-gone t-label">"no activity yet"</div>
                })}
                <For
                    each=move || rows.get()
                    key=|r| r.uid
                    children=move |r| {
                        let uid = r.uid;
                        let streaming = Signal::derive(move || running.get() && last_uid.get() == Some(uid));
                        view! { <TimelineItem entry=r.entry provider=provider streaming=streaming /> }
                    }
                />
            </div>
        </div>
    }
}

#[cfg(test)]
mod tests {
    use super::model::*;
    use crate::state::Bucket;
    use serde_json::json;

    fn sub(id: &str, status: &str) -> SubagentSrc {
        SubagentSrc {
            id: id.into(),
            parent_agent_id: "p".into(),
            title: Some(format!("t-{id}")),
            description: Some("desc".into()),
            status: status.into(),
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:01:05.500Z".into(),
            ..Default::default()
        }
    }

    #[test]
    fn iso_parsing() {
        assert_eq!(iso_ms("1970-01-01T00:00:00Z"), Some(0.0));
        assert_eq!(iso_ms("1970-01-02T00:00:01.250Z"), Some(86_401_250.0));
        assert_eq!(
            iso_ms("2026-01-01T02:00:00+02:00"),
            iso_ms("2026-01-01T00:00:00Z")
        );
        assert_eq!(iso_ms("2000-03-01T00:00:00Z"), Some(951_868_800_000.0));
        assert_eq!(iso_ms("nope"), None);
    }

    #[test]
    fn subagents_map_and_nest() {
        let mut child = sub("c", "running");
        child.parent_subagent_id = Some("a".into());
        child.subtitle = Some("Grep · x".into());
        let a = from_subagent("p", &sub("a", "completed"));
        assert_eq!(a.id, "sub:a");
        assert_eq!(a.status, Status::Done);
        assert_eq!(a.detail.as_deref(), Some("desc"));
        assert_eq!(a.subagent_id(), Some("a"));
        assert_eq!(
            time_text(&a, 0.0),
            "1m 05s",
            "settled work shows how long it took"
        );
        let c = from_subagent("p", &child);
        assert_eq!(c.nested_under.as_deref(), Some("sub:a"));
        assert_eq!(c.activity.as_deref(), Some("Grep · x"));
        let b = from_subagent("p", &sub("b", "running"));
        let order = nest_order(&[a.clone(), b.clone(), c.clone()]);
        let ids: Vec<(&str, bool)> = order.iter().map(|(i, n)| (i.id.as_str(), *n)).collect();
        assert_eq!(
            ids,
            vec![("sub:a", false), ("sub:c", true), ("sub:b", false)]
        );
    }

    #[test]
    fn scripts_terminals_children() {
        let sc: ScriptSrc = serde_json::from_value(json!({
            "scriptName": "web", "type": "service", "hostname": "h", "port": 5173,
            "lifecycle": "running", "health": "healthy", "terminalId": "t1"
        }))
        .unwrap();
        let it = from_script("p", "ws1", &sc);
        assert_eq!((it.status, it.port), (Status::Running, Some(5173)));
        assert_eq!(it.id, "script:ws1:web");
        let stopped: ScriptSrc = serde_json::from_value(json!({
            "scriptName": "b", "port": null, "lifecycle": "stopped", "health": null, "exitCode": 1
        }))
        .unwrap();
        assert_eq!(from_script("p", "w", &stopped).status, Status::Failed);
        let t: TerminalSrc = serde_json::from_value(json!({
            "id": "t", "name": "zsh", "activity": { "state": "attention", "attentionReason": "needs_input" }
        }))
        .unwrap();
        assert_eq!(from_terminal("p", &t).status, Status::Attention);
        assert_eq!(from_terminal("p", &t).label, "zsh");
        let c = ChildSrc {
            id: "k".into(),
            title: None,
            bucket: Bucket::Working,
            created_at: String::new(),
            updated_at: String::new(),
        };
        let ci = from_child("p", &c);
        assert_eq!(
            (ci.status, ci.label.as_str()),
            (Status::Running, "Untitled session")
        );
    }

    #[test]
    fn background_commands_from_the_timeline() {
        let shell = json!({ "type": "tool_call", "callId": "c1", "status": "completed",
            "detail": { "type": "shell", "command": "npm   run\n dev",
                "output": "Command running in background with ID: bash_42x" } });
        let note = json!({ "type": "tool_call", "callId": "task_notification_bash_42x", "status": "failed" });
        let other = json!({ "type": "tool_call", "callId": "c2",
            "detail": { "type": "shell", "command": "ls", "output": "a b" } });
        let t0 = iso_ms("2026-01-01T00:00:00Z").unwrap();
        let rows = |with_note: bool| {
            let mut v = vec![
                TimelineSrc {
                    timestamp: Some("2026-01-01T00:00:00Z"),
                    item: &shell,
                },
                TimelineSrc {
                    timestamp: None,
                    item: &other,
                },
            ];
            if with_note {
                v.push(TimelineSrc {
                    timestamp: Some("2026-01-01T00:00:10Z"),
                    item: &note,
                });
            }
            v
        };
        // Claude's shape: a uuid call id, the task id and status in metadata.
        let shell2 = json!({ "type": "tool_call", "callId": "c3", "status": "completed",
            "detail": { "type": "shell", "command": "sleep 5",
                "output": "Command running in background with ID: b8ptp1nge. Output is being written to: /tmp/x" } });
        let note2 = json!({ "type": "tool_call", "callId": "task_notification_e0c91805",
            "metadata": { "taskId": "b8ptp1nge", "status": "completed" } });
        let claude = from_timeline(
            "p",
            &[
                TimelineSrc {
                    timestamp: Some("2026-01-01T00:00:00Z"),
                    item: &shell2,
                },
                TimelineSrc {
                    timestamp: Some("2026-01-01T00:00:05Z"),
                    item: &note2,
                },
            ],
            t0,
        );
        assert_eq!(claude[0].status, Status::Done);
        let open = from_timeline("p", &rows(false), t0 + 1000.0);
        assert_eq!(open.len(), 1);
        assert_eq!(open[0].label, "npm run dev");
        assert_eq!(open[0].status, Status::Running);
        assert_eq!(open[0].kind, Kind::BackgroundTask);
        let stale = from_timeline("p", &rows(false), t0 + BG_STALE_MS + 1.0);
        assert_eq!(stale[0].status, Status::Idle);
        let settled = from_timeline("p", &rows(true), t0);
        assert_eq!(settled[0].status, Status::Failed);
        assert_eq!(time_text(&settled[0], 0.0), "10s");
    }

    #[test]
    fn merge_rollup_and_text() {
        let subs = [
            sub("a", "running"),
            sub("b", "failed"),
            sub("c", "canceled"),
        ];
        let t: TerminalSrc = serde_json::from_value(json!({
            "id": "t", "name": "zsh", "activity": { "state": "attention", "attentionReason": "needs_input" }
        }))
        .unwrap();
        let items = merge(
            "p",
            None,
            &Sources {
                subagents: &subs,
                terminals: std::slice::from_ref(&t),
                ..Default::default()
            },
            0.0,
        );
        let order: Vec<&str> = items.iter().map(|x| x.id.as_str()).collect();
        assert_eq!(order, vec!["term:t", "sub:b", "sub:a", "sub:c"]);
        let r = rollup(&items);
        assert_eq!(
            (r.running, r.attention, r.failed, r.idle, r.active),
            (1, 1, 1, 1, 3)
        );
        assert!(needs_attention(&r));
        assert_eq!(visible(&items).len(), 3);
        assert_eq!(pending_background(&items), 1);
        assert_eq!(tone(&items), Status::Attention);
        assert_eq!(describe(&items), "3 subagents · 1 terminal");
        assert_eq!(
            a11y(&items),
            "4 sub-processes, 1 running, 1 need you, 1 failed"
        );
    }

    #[test]
    fn elapsed_text() {
        assert_eq!(elapsed(0.0, 12_000.0), "12s");
        assert_eq!(elapsed(0.0, 184_000.0), "3m 04s");
        assert_eq!(elapsed(0.0, 3_900_000.0), "1h 05m");
        assert_eq!(elapsed(10.0, 0.0), "0s");
    }
}
