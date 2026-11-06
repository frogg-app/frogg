//! Session-level state for the open chat (ui-next `chat/sessionOps.ts`, `chat/cutQueue.ts`,
//! `chat/cleanCut.ts`, `chat/title.ts`, `chat/SessionState.tsx`):
//!
//! - one conversation-rewriting operation (move to another account, clean cut) per session at a
//!   time, with a sticky progress toast;
//! - the message held back while that operation runs, sent once it finishes;
//! - the durable end-of-timeline state cards (offline, waiting on background work, finished,
//!   ready to review, signed out, failed).
//!
//! The composer (slice 7b) should call [`busy`] before sending and [`queue_message`] instead of
//! sending while it returns true.

use std::cell::Cell;
use std::collections::{HashMap, HashSet};

use frogg_client_core::SendMessageOptions;
use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::{json, Value};

use super::composer::{Att, AttKind};
use super::subwork::SubWork;
use crate::components::{Button, ButtonKind, StatusGlyph};
use crate::shell::toast::{Toast, ToastKind};
use crate::state::timeline::{sent, Entry};
use crate::state::{bucket_of, Agent, Bucket, Session};

// ----- operations ---------------------------------------------------------------------------

/// The running operation on a session.
#[derive(Debug, Clone, PartialEq)]
pub struct SessionOp {
    /// Present-tense progress line, e.g. "Moving the conversation to work".
    pub label: String,
    /// When it started (ms since the epoch), for the elapsed clock.
    pub started_at: f64,
}

/// What an operation says while it runs and when it ends.
#[derive(Debug, Clone)]
pub struct OpText {
    pub label: String,
    pub done: String,
    pub done_detail: Option<String>,
    pub failed: String,
}

/// The plain clean cut (same account), from the session menu or the cold-cache notice.
pub fn cut_text() -> OpText {
    OpText {
        label: "Clean cut: summarising the conversation".into(),
        done: "Clean cut done".into(),
        done_detail: Some("The next message starts from the summary".into()),
        failed: "Clean cut failed".into(),
    }
}

/// A message held until the session's operation finishes.
#[derive(Debug, Clone, PartialEq)]
pub struct Queued {
    pub text: String,
    pub atts: Vec<Att>,
    /// The operation it waited on failed, so it was not sent.
    pub failed: bool,
}

#[derive(Clone, Copy)]
struct Store {
    ops: RwSignal<HashMap<String, SessionOp>>,
    queue: RwSignal<HashMap<String, Queued>>,
}

thread_local! {
    static STORE: Cell<Option<Store>> = const { Cell::new(None) };
}

fn store() -> Store {
    STORE.with(|c| {
        c.get().unwrap_or_else(|| {
            // A root of its own, kept forever, so the store outlives any one chat.
            let owner = Owner::new_root(None);
            let s = owner.with(|| Store {
                ops: RwSignal::new(HashMap::new()),
                queue: RwSignal::new(HashMap::new()),
            });
            std::mem::forget(owner);
            c.set(Some(s));
            s
        })
    })
}

/// The session's running operation (reactive).
pub fn op_of(agent_id: &str) -> Option<SessionOp> {
    store().ops.with(|m| m.get(agent_id).cloned())
}

/// Whether an operation runs on the session now (untracked): the composer queues instead.
#[allow(dead_code)] // composer (7b)
pub fn busy(agent_id: &str) -> bool {
    store().ops.with_untracked(|m| m.contains_key(agent_id))
}

/// The held message for a session (reactive).
pub fn queued_of(agent_id: &str) -> Option<Queued> {
    store().queue.with(|m| m.get(agent_id).cloned())
}

/// Joins `text` onto what already waits, so nothing typed is lost.
#[allow(dead_code)] // composer (7b)
pub fn join_queued(cur: Option<&Queued>, text: &str, atts: Vec<Att>) -> Queued {
    let text = match cur.map(|q| q.text.as_str()) {
        Some(c) if !c.is_empty() && !text.is_empty() => format!("{c}\n\n{text}"),
        Some(c) if !c.is_empty() => c.to_owned(),
        _ => text.to_owned(),
    };
    let mut all = cur.map(|q| q.atts.clone()).unwrap_or_default();
    all.extend(atts);
    Queued {
        text,
        atts: all,
        failed: false,
    }
}

/// Holds a message until the session's running operation finishes.
#[allow(dead_code)] // composer (7b)
pub fn queue_message(agent_id: &str, text: &str, atts: Vec<Att>) {
    store().queue.update(|m| {
        let q = join_queued(m.get(agent_id), text, atts);
        m.insert(agent_id.to_owned(), q);
    });
}

pub fn drop_queued(agent_id: &str) {
    store().queue.update(|m| {
        m.remove(agent_id);
    });
}

/// Sends the held message now; a failure keeps it as failed.
pub async fn send_queued(agent_id: String) -> Result<(), String> {
    let Some(q) = store().queue.with_untracked(|m| m.get(&agent_id).cloned()) else {
        return Ok(());
    };
    drop_queued(&agent_id);
    let res = send(&agent_id, &q.text, &q.atts).await;
    if res.is_err() {
        store().queue.update(|m| {
            m.insert(agent_id.clone(), Queued { failed: true, ..q });
        });
    }
    res
}

/// The operation finished: send what waited, or keep it after a failure.
fn settle_queue(agent_id: String, ok: bool) {
    let waiting = store()
        .queue
        .with_untracked(|m| m.get(&agent_id).is_some_and(|q| !q.failed));
    if !waiting {
        return;
    }
    if !ok {
        store().queue.update(|m| {
            if let Some(q) = m.get_mut(&agent_id) {
                q.failed = true;
            }
        });
        return;
    }
    spawn_local(async move {
        if let Err(e) = send_queued(agent_id).await {
            super::toast_err("Message not sent", e);
        }
    });
}

/// The composer's send, for the held message (images inline, uploaded files as attachments).
async fn send(agent_id: &str, text: &str, atts: &[Att]) -> Result<(), String> {
    let client = crate::state::get()
        .conn
        .client()
        .ok_or("Not connected to a host")?;
    let images: Vec<Value> = atts
        .iter()
        .filter_map(|a| match &a.kind {
            AttKind::Image { mime, data } => Some(json!({ "data": data, "mimeType": mime })),
            _ => None,
        })
        .collect();
    let files: Vec<Value> = atts
        .iter()
        .filter_map(|a| match &a.kind {
            AttKind::File(v) => Some(v.clone()),
            _ => None,
        })
        .collect();
    let message_id = sent::new_message_id();
    client
        .send_message(
            agent_id,
            text,
            SendMessageOptions {
                message_id: Some(message_id),
                images: (!images.is_empty()).then_some(Value::Array(images)),
                attachments: (!files.is_empty()).then_some(Value::Array(files)),
                ..Default::default()
            },
        )
        .await
        .map_err(|e| e.to_string())
}

/// Runs `fut` as the session's only operation: a sticky progress toast while it runs, then a
/// success or failure toast. Returns false without running when another one is in flight.
pub fn run_session_op<F>(agent_id: &str, text: OpText, fut: F) -> bool
where
    F: std::future::Future<Output = Result<(), String>> + 'static,
{
    let app = crate::state::get();
    if let Some(cur) = store().ops.with_untracked(|m| m.get(agent_id).cloned()) {
        app.toasts.push(
            Toast::new(ToastKind::Needs, "Another operation is still running").detail(cur.label),
        );
        return false;
    }
    let id = agent_id.to_owned();
    store().ops.update(|m| {
        m.insert(
            id.clone(),
            SessionOp {
                label: text.label.clone(),
                started_at: js_sys::Date::now(),
            },
        );
    });
    let progress = app
        .toasts
        .push(Toast::new(ToastKind::Info, format!("{}…", text.label)).sticky());
    spawn_local(async move {
        let res = fut.await;
        app.toasts.dismiss(progress);
        store().ops.update(|m| {
            m.remove(&id);
        });
        match res {
            Ok(()) => {
                settle_queue(id, true);
                let mut t = Toast::new(ToastKind::Done, text.done);
                if let Some(d) = text.done_detail {
                    t = t.detail(d);
                }
                app.toasts.push(t);
            }
            Err(e) => {
                settle_queue(id, false);
                super::toast_err(&text.failed, e);
            }
        }
    });
    true
}

/// A clean cut, optionally onto another account or provider (`target` fields go on the request).
pub async fn clean_cut(
    agent_id: String,
    target: serde_json::Map<String, Value>,
) -> Result<(), String> {
    let c = crate::state::get()
        .conn
        .client()
        .ok_or("Not connected to a host")?;
    c.clean_cut_agent(&agent_id, target)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// `server_info.features.<name>` on the active host (reactive on the link).
pub fn has_feature(name: &str) -> bool {
    crate::state::config::feature(name).unwrap_or(false)
}

// ----- timeline helpers ---------------------------------------------------------------------

/// True when the timeline ends at a clean cut with no user message after it: that cut's summary
/// still stands, so moving again carries it over and the daemon runs no summariser.
pub fn ends_at_clean_cut(entries: &[Entry]) -> bool {
    for e in entries.iter().rev() {
        match e.kind() {
            "user_message" => return false,
            "compaction" if e.item.get("cleanCut").is_some_and(|c| !c.is_null()) => return true,
            _ => {}
        }
    }
    false
}

/// Files the timeline's edit and write tool calls touched.
pub fn edited_files<'a>(entries: impl IntoIterator<Item = &'a Entry>) -> usize {
    let mut files = HashSet::new();
    for e in entries {
        if e.kind() != "tool_call" {
            continue;
        }
        let d = e.item.get("detail");
        let t = d.and_then(|d| d.get("type")).and_then(Value::as_str);
        if matches!(t, Some("edit" | "write")) {
            let key = d
                .and_then(|d| d.get("filePath"))
                .and_then(Value::as_str)
                .or_else(|| e.str("callId"))
                .unwrap_or_default();
            files.insert(key.to_owned());
        }
    }
    files.len()
}

/// Longest title the daemon accepts (protocol MAX_EXPLICIT_AGENT_TITLE_CHARS).
const MAX_TITLE: usize = 200;

/// Until a session is named, the daemon titles it with the first 60 characters of the first
/// prompt line, cut mid-word. When the title is such a prefix, show the whole line instead.
pub fn header_title(title: &str, first_user_text: Option<&str>) -> String {
    let t = title.trim();
    let Some(text) = first_user_text.filter(|_| !t.is_empty()) else {
        return title.to_owned();
    };
    let Some(line) = text
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
    else {
        return title.to_owned();
    };
    if line.chars().count() <= t.chars().count() || !line.starts_with(t) {
        return title.to_owned();
    }
    if line.chars().count() > MAX_TITLE {
        format!("{}…", line.chars().take(MAX_TITLE).collect::<String>())
    } else {
        line
    }
}

/// "m:ss" or "h:mm:ss".
pub fn clock(ms: f64) -> String {
    let sec = (ms / 1000.0).floor().max(0.0) as u64;
    let (h, m, s) = (sec / 3600, (sec % 3600) / 60, sec % 60);
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m}:{s:02}")
    }
}

// ----- state cards --------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Review,
    Done,
    Waiting,
    Failed,
    Offline,
}

impl Kind {
    fn id(self) -> &'static str {
        match self {
            Kind::Review => "review",
            Kind::Done => "done",
            Kind::Waiting => "waiting",
            Kind::Failed => "failed",
            Kind::Offline => "offline",
        }
    }
    fn tag(self) -> &'static str {
        match self {
            Kind::Review => "READY",
            Kind::Done => "DONE",
            Kind::Waiting => "WAITING",
            Kind::Failed => "FAILED",
            Kind::Offline => "OFFLINE",
        }
    }
    fn glyph(self) -> Bucket {
        match self {
            Kind::Review | Kind::Done => Bucket::Review,
            Kind::Waiting => Bucket::Working,
            Kind::Failed => Bucket::Failed,
            Kind::Offline => Bucket::Idle,
        }
    }
}

/// What a card's button does.
#[derive(Debug, Clone, PartialEq)]
enum Act {
    Reconnect,
    Review,
    SignIn(crate::state::signin::SignInTarget),
}

/// What the card shows; compared so an unrelated agent update does not replay its entry.
#[derive(Debug, Clone, PartialEq)]
struct Card {
    kind: Kind,
    title: String,
    detail: String,
    mono: bool,
    action: Option<(String, Act)>,
}

fn run(act: Act) {
    let app = crate::state::get();
    match act {
        Act::Reconnect => {
            if let Some(h) = app.hosts.active_id.get_untracked() {
                app.conn.activate(&h);
            }
        }
        Act::Review => app.ui.set_tool(crate::state::ui::Tool::Scm),
        Act::SignIn(t) => crate::state::signin::open_sign_in(t),
    }
}

fn frame(card: Card, variant: String) -> AnyView {
    let k = card.kind;
    view! {
        <div class=format!("st-wrap st-{} st-v-{variant}", k.id())>
            <div class="st-card">
                <div class="st-flash"></div>
                <div class="st-trim"></div>
                <div class="st-body">
                    <div class="st-head">
                        <StatusGlyph bucket=k.glyph() size=9.0 />
                        <span class="t-mono st-tag">{k.tag()}</span>
                    </div>
                    <div class="st-row">
                        <div class="st-text">
                            <span class="st-title">{card.title}</span>
                            <span class=if card.mono { "st-detail t-mono mono" } else { "st-detail" }>{card.detail}</span>
                        </div>
                        {card.action.map(|(label, act)| view! {
                            <Button label=label kind=ButtonKind::Primary on_press=Callback::new(move |_| run(act.clone())) />
                        })}
                    </div>
                </div>
            </div>
        </div>
    }
    .into_any()
}

/// Durable turn outcomes at the end of the conversation, independent of transient toasts.
#[component]
pub fn SessionState(
    session: Memo<Option<Session>>,
    #[prop(into)] online: Signal<bool>,
    rows: Signal<Vec<Entry>>,
    work: SubWork,
) -> impl IntoView {
    let app = crate::state::get();
    let scm = crate::state::scm::store();
    let bucket = Memo::new(move |_| session.get().map(|s| bucket_of(&s.agent)));
    // The review button counts the checkout's live diff once loaded, else files this session edited.
    Effect::new(move |_| {
        if online.get() && bucket.get() == Some(Bucket::Review) {
            if let Some(cwd) = session.with_untracked(|s| s.as_ref().map(|s| s.agent.cwd.clone())) {
                scm.watch(cwd);
            }
        }
    });
    let pending = Memo::new(move |_| {
        work.items.with(|items| {
            items
                .iter()
                // Every listed item is a subagent this session started.
                .filter(|x| x.status == "running")
                .count()
        })
    });
    let card = Memo::new(move |_| {
        let s = session.get()?;
        let a: Agent = s.agent;
        if !online.get() {
            return Some(Card {
                kind: Kind::Offline,
                title: "Host offline".into(),
                detail:
                    "Showing the last received conversation. Reconnect before sending a message."
                        .into(),
                mono: false,
                action: Some(("Reconnect".into(), Act::Reconnect)),
            });
        }
        let b = bucket.get()?;
        if b == Bucket::Review {
            let n = pending.get();
            if n > 0 {
                let (what, when) = if n == 1 {
                    ("1 background task".to_owned(), "it finishes")
                } else {
                    (format!("{n} background tasks"), "they finish")
                };
                return Some(Card {
                    kind: Kind::Waiting,
                    title: "Waiting on background work".into(),
                    detail: format!("{what} still running. The agent picks up when {when}."),
                    mono: false,
                    action: None,
                });
            }
            let live = scm
                .cwd
                .with(|c| c.as_deref() == Some(a.cwd.as_str()))
                .then(|| scm.files.with(|f| f.as_ref().map(Vec::len)))
                .flatten();
            let changed = live.unwrap_or_else(|| rows.with(|r| edited_files(r.iter())));
            if changed == 0 {
                return Some(Card {
                    kind: Kind::Done,
                    title: "Finished".into(),
                    detail: "No files changed. Send a follow-up below.".into(),
                    mono: false,
                    action: None,
                });
            }
            let label = if changed == 1 {
                "Review 1 file".to_owned()
            } else {
                format!("Review {changed} files")
            };
            return Some(Card {
                kind: Kind::Review,
                title: "Ready to review".into(),
                detail: "Review the changes or send a follow-up below.".into(),
                mono: false,
                action: Some((label, Act::Review)),
            });
        }
        // An older daemon keeps the error a clean cut moved past; the cut marker is the latest word.
        if b != Bucket::Failed || rows.with(|r| ends_at_clean_cut(r)) {
            return None;
        }
        let err = a
            .raw
            .get("lastError")
            .and_then(Value::as_str)
            .map(str::to_owned);
        if let Some((_, account)) = err.as_deref().and_then(crate::state::signin::auth_problem) {
            let provider = a.provider.clone();
            let account_id = a
                .raw
                .get("providerAccountId")
                .and_then(Value::as_str)
                .map(str::to_owned);
            let sign_in = Act::SignIn(crate::state::signin::SignInTarget {
                host_id: app.hosts.active_id.get_untracked(),
                provider,
                account_id,
                account_name: account,
            });
            return Some(Card {
                kind: Kind::Failed,
                title: "Signed out of the provider".into(),
                detail: err.unwrap_or_default(),
                mono: true,
                action: Some(("Sign in again".into(), sign_in)),
            });
        }
        Some(Card {
            kind: Kind::Failed,
            title: "Session failed".into(),
            mono: err.is_some(),
            detail: err.unwrap_or_else(|| {
                "The agent stopped with an error. Send a message below to continue.".into()
            }),
            action: None,
        })
    });
    move || card.get().map(|c| frame(c, app.prefs.text("stateStyle")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(item: Value) -> Entry {
        Entry {
            seq_start: 0,
            seq_end: 0,
            turn_id: None,
            timestamp: None,
            item,
        }
    }

    #[test]
    fn title_expands_a_cut_prefix() {
        let t = header_title(
            "Fix the login",
            Some("\n  Fix the login  bug on   android\nmore"),
        );
        assert_eq!(t, "Fix the login bug on android");
        assert_eq!(header_title("Named", Some("Something else")), "Named");
        assert_eq!(header_title("Fix", None), "Fix");
        let long = "a".repeat(300);
        assert_eq!(
            header_title("aaa", Some(&long)).chars().count(),
            MAX_TITLE + 1
        );
    }

    #[test]
    fn clean_cut_tail() {
        let cut = entry(json!({"type":"compaction","cleanCut":{}}));
        let user = entry(json!({"type":"user_message","text":"hi"}));
        let reply = entry(json!({"type":"assistant_message","text":"ok"}));
        assert!(ends_at_clean_cut(&[user.clone(), cut.clone(), reply]));
        assert!(!ends_at_clean_cut(&[cut, user]));
        assert!(!ends_at_clean_cut(&[]));
    }

    #[test]
    fn edited_counts_unique_paths() {
        let e = |p: &str| {
            entry(json!({"type":"tool_call","callId":"c","detail":{"type":"edit","filePath":p}}))
        };
        assert_eq!(edited_files([e("a"), e("a"), e("b")].iter()), 2);
    }

    #[test]
    fn queue_joins_text() {
        let q = join_queued(None, "one", vec![]);
        let q = join_queued(Some(&q), "two", vec![]);
        assert_eq!(q.text, "one\n\ntwo");
        assert!(!q.failed);
    }

    #[test]
    fn clock_formats() {
        assert_eq!(clock(65_000.0), "1:05");
        assert_eq!(clock(3_725_000.0), "1:02:05");
        assert_eq!(clock(-5.0), "0:00");
    }
}
