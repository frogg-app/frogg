//! Agent timelines (ui-next `daemon/store.ts` `openTimeline` / `mergeEntry`, `@frogg/client`
//! `fetchAgentTimeline`): the tail fetch, `agent_stream` timeline events folded in live, and
//! load-earlier pagination.
//!
//! Each row holds its entry in its own `ArcRwSignal`, so a streamed assistant chunk or a tool
//! call settling re-renders that one row and never the list. Items stay `serde_json::Value`: the
//! generated item union is wide and still moving, and the views read only a few fields.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

use frogg_client_core::protocol::inbound;
use frogg_client_core::{DaemonClient, Event, SessionFrame};
use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::Value;

/// How many entries the tail fetch and each page of older history ask for.
pub const TAIL_LIMIT: i64 = 200;
pub const PAGE_LIMIT: i64 = 100;

/// One timeline entry: a message, reasoning, a tool call, a todo list, an error or a compaction.
#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub seq_start: i64,
    pub seq_end: i64,
    pub turn_id: Option<String>,
    pub timestamp: Option<String>,
    pub item: Value,
}

impl Entry {
    /// From a fetched `AgentTimelineEntryPayload` (or a subagent timeline row).
    pub fn from_payload(v: &Value) -> Option<Self> {
        let item = v.get("item")?.clone();
        let seq = |k: &str| v.get(k).and_then(Value::as_i64);
        let start = seq("seqStart").or_else(|| seq("seq")).unwrap_or(0);
        Some(Self {
            seq_start: start,
            seq_end: seq("seqEnd").unwrap_or(start),
            turn_id: str_of(v, "turnId"),
            timestamp: str_of(v, "timestamp"),
            item,
        })
    }

    pub fn kind(&self) -> &str {
        self.item.get("type").and_then(Value::as_str).unwrap_or("")
    }

    pub fn text(&self) -> &str {
        self.item.get("text").and_then(Value::as_str).unwrap_or("")
    }

    pub fn str(&self, k: &str) -> Option<&str> {
        self.item.get(k).and_then(Value::as_str)
    }

    /// The row identity ui-next keys on: the tool call or message id, else the sequence.
    fn base_key(&self) -> String {
        match (self.kind(), self.str("callId"), self.str("messageId")) {
            ("tool_call", Some(id), _) => format!("tool:{id}"),
            (k @ ("assistant_message" | "user_message"), _, Some(id)) => format!("{k}:{id}"),
            (k, _, _) => format!("{}:{k}", self.seq_start),
        }
    }
}

fn str_of(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(str::to_owned)
}

/// What folding one entry into a list does (`mergeEntry`).
#[derive(Debug, PartialEq)]
pub enum Fold {
    /// Streamed text joins the last row.
    Append(usize, Entry),
    /// A tool call's later state replaces its row.
    Replace(usize, Entry),
    Push(Entry),
}

/// Streamed chunks of one assistant message (or reasoning) fold into the last row; a tool call
/// update replaces the row with its call id; anything else is a new row.
pub fn fold(list: &[&Entry], e: Entry) -> Fold {
    fold_with(
        list.len(),
        list.last().copied(),
        |id| {
            list.iter()
                .rposition(|x| x.kind() == "tool_call" && x.str("callId") == Some(id))
                .map(|i| (i, list[i].seq_start))
        },
        e,
    )
}

/// `fold` over any row store: `last` is the last entry, `find_call` the row (and its first seq)
/// holding a tool call id.
pub fn fold_with(
    len: usize,
    last: Option<&Entry>,
    find_call: impl Fn(&str) -> Option<(usize, i64)>,
    e: Entry,
) -> Fold {
    let k = e.kind();
    if let Some(last) = last {
        if (k == "assistant_message" || k == "reasoning")
            && last.kind() == k
            && last.turn_id == e.turn_id
            && (e.item.get("messageId").is_none() || e.str("messageId") == last.str("messageId"))
        {
            let mut merged = e.clone();
            let text = format!("{}{}", last.text(), e.text());
            merged.item["text"] = Value::String(text);
            merged.seq_start = last.seq_start;
            return Fold::Append(len - 1, merged);
        }
    }
    if k == "tool_call" {
        if let Some(id) = e.str("callId") {
            if let Some((i, start)) = find_call(id) {
                let mut e = e;
                e.seq_start = start;
                return Fold::Replace(i, e);
            }
        }
    }
    Fold::Push(e)
}

#[derive(Clone)]
pub struct Row {
    /// The entry's identity in this list (tool call / message id, else sequence).
    pub key: String,
    /// Unique per row object: render keys use it, so a refetch that rebuilds a row with the same
    /// `key` still swaps in the new entry signal.
    pub uid: u64,
    pub entry: ArcRwSignal<Entry>,
}

fn next_uid() -> u64 {
    thread_local! {
        static UID: std::cell::Cell<u64> = const { std::cell::Cell::new(1) };
    }
    UID.with(|u| {
        let v = u.get();
        u.set(v + 1);
        v
    })
}

#[derive(Debug, Clone, Default)]
struct Meta {
    epoch: Option<String>,
    /// Highest sequence already folded in; older stream events are duplicates of the fetch.
    max_seq: i64,
    start_cursor: Option<Value>,
    keys: HashSet<String>,
}

/// One agent's timeline. Cheap to clone; every field is a shared signal.
#[derive(Clone)]
pub struct Timeline {
    pub rows: ArcRwSignal<Vec<Row>>,
    /// The tail fetch landed (an empty list then means no messages).
    pub loaded: ArcRwSignal<bool>,
    pub has_older: ArcRwSignal<bool>,
    pub loading_older: ArcRwSignal<bool>,
    pub error: ArcRwSignal<Option<String>>,
    /// Bumped on every change, rows included (scroll anchoring follows it).
    pub tick: ArcRwSignal<u64>,
    meta: ArcRwSignal<Meta>,
}

impl Timeline {
    fn new() -> Self {
        Self {
            rows: ArcRwSignal::new(Vec::new()),
            loaded: ArcRwSignal::new(false),
            has_older: ArcRwSignal::new(false),
            loading_older: ArcRwSignal::new(false),
            error: ArcRwSignal::new(None),
            tick: ArcRwSignal::new(0),
            meta: ArcRwSignal::new(Meta::default()),
        }
    }

    fn bump(&self) {
        self.tick.update(|t| *t += 1);
    }

    fn unique_key(meta: &mut Meta, e: &Entry) -> String {
        let base = e.base_key();
        let mut key = base.clone();
        let mut n = 1;
        while meta.keys.contains(&key) {
            key = format!("{base}#{n}");
            n += 1;
        }
        meta.keys.insert(key.clone());
        key
    }

    /// Folds entries into rows, the way streamed and fetched entries both arrive.
    fn fold_into(meta: &mut Meta, rows: &mut Vec<Row>, entries: Vec<Entry>) {
        for e in entries {
            let last = rows.last().map(|r| r.entry.get_untracked());
            let len = rows.len();
            let found = |id: &str| {
                let key = format!("tool:{id}");
                rows.iter()
                    .rposition(|r| r.key == key || r.key.starts_with(&format!("{key}#")))
                    .map(|i| (i, rows[i].entry.with_untracked(|x| x.seq_start)))
            };
            let f = fold_with(len, last.as_ref(), found, e);
            match f {
                Fold::Append(i, e) | Fold::Replace(i, e) => rows[i].entry.set(e),
                Fold::Push(e) => {
                    let key = Self::unique_key(meta, &e);
                    rows.push(Row {
                        key,
                        uid: next_uid(),
                        entry: ArcRwSignal::new(e),
                    });
                }
            }
        }
    }

    /// Replaces the timeline with a fetched tail.
    pub fn reset_with(&self, payload: &Value) {
        self.reset_from(payload, "entries");
    }

    /// Replaces the timeline with the entries under `field` (`rows` for a subagent timeline).
    pub fn reset_from(&self, payload: &Value, field: &str) {
        let entries = entries_of(payload, field);
        let mut meta = Meta {
            epoch: str_of(payload, "epoch"),
            max_seq: entries.iter().map(|e| e.seq_end).max().unwrap_or(0),
            start_cursor: payload.get("startCursor").filter(|c| !c.is_null()).cloned(),
            keys: HashSet::new(),
        };
        let mut rows = Vec::new();
        Self::fold_into(&mut meta, &mut rows, entries);
        self.meta.set(meta);
        self.rows.set(rows);
        self.has_older.set(bool_of(payload, "hasOlder"));
        self.error.set(None);
        self.loaded.set(true);
        self.bump();
    }

    /// Prepends a page of older entries.
    pub fn prepend(&self, payload: &Value) {
        let entries = entries_of(payload, "entries");
        let mut meta = self.meta.get_untracked();
        let mut older = Vec::new();
        Self::fold_into(&mut meta, &mut older, entries);
        meta.start_cursor = payload.get("startCursor").filter(|c| !c.is_null()).cloned();
        self.meta.set(meta);
        self.rows.update(|rows| {
            older.append(rows);
            *rows = older;
        });
        self.has_older.set(bool_of(payload, "hasOlder"));
        self.bump();
    }

    /// An `agent_stream` payload (`{ agentId, event, timestamp, seq?, epoch? }`).
    pub fn apply_stream(&self, payload: &Value) {
        let Some(event) = payload.get("event") else {
            return;
        };
        if event.get("type").and_then(Value::as_str) != Some("timeline") {
            return;
        }
        let Some(item) = event.get("item").cloned() else {
            return;
        };
        let e = Entry {
            seq_start: 0,
            seq_end: 0,
            turn_id: str_of(event, "turnId"),
            timestamp: str_of(payload, "timestamp"),
            item,
        };
        self.push_live(
            e,
            payload.get("seq").and_then(Value::as_i64),
            str_of(payload, "epoch"),
        );
    }

    /// A live subagent row (`{ item, seq, epoch, timestamp }`).
    pub fn apply_row(&self, row: &Value) {
        let Some(item) = row.get("item").cloned() else {
            return;
        };
        let e = Entry {
            seq_start: 0,
            seq_end: 0,
            turn_id: None,
            timestamp: str_of(row, "timestamp"),
            item,
        };
        self.push_live(
            e,
            row.get("seq").and_then(Value::as_i64),
            str_of(row, "epoch"),
        );
    }

    fn push_live(&self, mut e: Entry, seq: Option<i64>, epoch: Option<String>) {
        let mut meta = self.meta.get_untracked();
        if let Some(s) = seq {
            let same_epoch = epoch.is_none() || meta.epoch.is_none() || epoch == meta.epoch;
            if same_epoch && s <= meta.max_seq && self.loaded.get_untracked() {
                return;
            }
            meta.max_seq = meta.max_seq.max(s);
            e.seq_start = s;
            e.seq_end = s;
        }
        if epoch.is_some() && meta.epoch.is_none() {
            meta.epoch = epoch;
        }
        let mut rows = self.rows.get_untracked();
        let before = rows.len();
        Self::fold_into(&mut meta, &mut rows, vec![e]);
        let pushed = rows.len() != before;
        self.meta.set(meta);
        if pushed {
            self.rows.set(rows);
        }
        self.bump();
    }

    /// Plain entries, in order (untracked).
    pub fn entries_untracked(&self) -> Vec<Entry> {
        self.rows
            .with_untracked(|r| r.iter().map(|x| x.entry.get_untracked()).collect())
    }
}

fn bool_of(v: &Value, k: &str) -> bool {
    v.get(k).and_then(Value::as_bool).unwrap_or(false)
}

pub fn entries_of(payload: &Value, field: &str) -> Vec<Entry> {
    payload
        .get(field)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Entry::from_payload)
        .collect()
}

thread_local! {
    static TIMELINES: RefCell<HashMap<String, Timeline>> = RefCell::new(HashMap::new());
    static SUBSCRIBED: RefCell<HashSet<String>> = RefCell::new(HashSet::new());
}

/// The timeline of `agent_id` on `host_id`, created empty on first use.
pub fn get(host_id: &str, agent_id: &str) -> Timeline {
    let key = format!("{host_id}\u{0}{agent_id}");
    TIMELINES.with(|t| {
        t.borrow_mut()
            .entry(key)
            .or_insert_with(Timeline::new)
            .clone()
    })
}

async fn request_page(
    client: &DaemonClient,
    agent_id: &str,
    direction: inbound::FetchAgentTimelineRequestDirection,
    cursor: Option<inbound::FetchAgentTimelineRequestCursor>,
    limit: i64,
) -> Result<Value, String> {
    let request_id = client.next_request_id();
    let message =
        inbound::SessionMessage::FetchAgentTimelineRequest(inbound::FetchAgentTimelineRequest {
            agent_id: agent_id.to_owned(),
            request_id: request_id.clone(),
            direction: Some(direction),
            cursor,
            limit: Some(limit),
            projection: None,
            merge_window: None,
        });
    let frame = client
        .request(&request_id, &message)
        .await
        .map_err(|e| e.to_string())?;
    let payload: Value = frame.payload().map_err(|e| e.to_string())?;
    if let Some(err) = payload.get("error").and_then(Value::as_str) {
        return Err(err.to_owned());
    }
    Ok(payload)
}

/// Subscribes the client to this agent's stream and fetches its tail.
pub async fn open(client: DaemonClient, tl: Timeline, agent_id: String) {
    let ids: Vec<String> = SUBSCRIBED.with(|s| {
        let mut s = s.borrow_mut();
        s.insert(agent_id.clone());
        s.iter().cloned().collect()
    });
    let _ = client.set_agent_timeline_subscription(&ids).await;
    match request_page(
        &client,
        &agent_id,
        inbound::FetchAgentTimelineRequestDirection::Tail,
        None,
        TAIL_LIMIT,
    )
    .await
    {
        Ok(p) => tl.reset_with(&p),
        Err(e) => {
            tl.error.set(Some(e));
            tl.loaded.set(true);
        }
    }
}

/// Fetches the page before the oldest loaded entry.
pub fn load_older(client: DaemonClient, tl: Timeline, agent_id: String) {
    if tl.loading_older.get_untracked() || !tl.has_older.get_untracked() {
        return;
    }
    let cursor = tl.meta.with_untracked(|m| m.start_cursor.clone());
    let Some(cursor) = cursor.and_then(|c| {
        Some(inbound::FetchAgentTimelineRequestCursor {
            epoch: c.get("epoch")?.as_str()?.to_owned(),
            seq: c.get("seq")?.as_i64()?,
        })
    }) else {
        tl.has_older.set(false);
        return;
    };
    tl.loading_older.set(true);
    spawn_local(async move {
        let res = request_page(
            &client,
            &agent_id,
            inbound::FetchAgentTimelineRequestDirection::Before,
            Some(cursor),
            PAGE_LIMIT,
        )
        .await;
        match res {
            Ok(p) => tl.prepend(&p),
            Err(e) => {
                let _ = crate::shell::toast::toast(
                    crate::shell::toast::ToastKind::Error,
                    format!("Could not load earlier messages: {e}"),
                );
            }
        }
        tl.loading_older.set(false);
    });
}

/// Routes this client's `agent_stream` pushes for `agent_id` into `tl`. Returns the listener id.
pub fn listen(client: &DaemonClient, tl: Timeline, agent_id: String) -> u64 {
    client.subscribe(move |event| {
        let Event::Session(frame) = event else {
            return;
        };
        if let Some(p) = stream_payload(frame, &agent_id) {
            tl.apply_stream(&p);
        }
    })
}

fn stream_payload(frame: &SessionFrame, agent_id: &str) -> Option<Value> {
    if frame.kind != "agent_stream" {
        return None;
    }
    let p: Value = frame.payload().ok()?;
    (p.get("agentId").and_then(Value::as_str) == Some(agent_id)).then_some(p)
}

/// What rode along with messages this device sent (ui-next `chat/sentAttachments.ts`), keyed by
/// the message id the daemon echoes back on the user message. The daemon keeps only the text, so
/// without this a sent screenshot or file would vanish from the bubble. Pictures live while the
/// app runs; across a reload only names survive (pictures would overrun web storage).
pub mod sent {
    use std::cell::Cell;

    use leptos::prelude::*;
    use serde::{Deserialize, Serialize};

    const KEY: &str = "frogg.sent-attachments";
    /// Messages remembered across reloads; older ones drop off first.
    const KEEP: usize = 200;

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    pub struct SentAtt {
        pub id: String,
        /// `"image"` or `"file"`.
        pub kind: String,
        pub name: String,
        /// `data:` URI, images only, while the app that sent it runs.
        #[serde(default, skip_serializing)]
        pub uri: Option<String>,
    }

    /// Insertion-ordered (message id, attachments).
    type Store = RwSignal<Vec<(String, Vec<SentAtt>)>, LocalStorage>;

    thread_local! {
        static STORE: Cell<Option<Store>> = const { Cell::new(None) };
        static SEQ: Cell<u64> = const { Cell::new(0) };
    }

    fn store() -> Store {
        if let Some(s) = STORE.with(Cell::get) {
            return s;
        }
        let saved: Vec<(String, Vec<SentAtt>)> =
            crate::state::storage::get_json(KEY).unwrap_or_default();
        // The root owns the signal for the app's life: dropping it would dispose the signal.
        let owner = Owner::new_root(None);
        let s = owner.with(|| RwSignal::new_local(saved));
        std::mem::forget(owner);
        STORE.with(|c| c.set(Some(s)));
        s
    }

    /// A message id unique enough to key a send (the daemon needs it unique per agent).
    pub fn new_message_id() -> String {
        let n = SEQ.with(|c| {
            c.set(c.get() + 1);
            c.get()
        });
        let now = js_sys::Date::now() as u64;
        let rnd = (js_sys::Math::random() * 2f64.powi(32)) as u64;
        format!("m-{now:x}-{n:x}-{rnd:x}")
    }

    pub fn remember(message_id: &str, list: Vec<SentAtt>) {
        if list.is_empty() {
            return;
        }
        let s = store();
        s.update(|all| {
            all.retain(|(id, _)| id != message_id);
            all.push((message_id.to_owned(), list));
            let over = all.len().saturating_sub(KEEP);
            all.drain(..over);
        });
        s.with_untracked(|all| crate::state::storage::set_json(KEY, all));
    }

    /// What was sent with `message_id` (reactive).
    pub fn of(message_id: &str) -> Vec<SentAtt> {
        store().with(|all| {
            all.iter()
                .rev()
                .find(|(id, _)| id == message_id)
                .map(|(_, l)| l.clone())
                .unwrap_or_default()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn e(seq: i64, turn: &str, item: Value) -> Entry {
        Entry {
            seq_start: seq,
            seq_end: seq,
            turn_id: Some(turn.into()),
            timestamp: None,
            item,
        }
    }

    #[test]
    fn assistant_chunks_join() {
        let a = e(1, "t", json!({"type":"assistant_message","text":"Hel"}));
        let b = e(2, "t", json!({"type":"assistant_message","text":"lo"}));
        match fold(&[&a], b) {
            Fold::Append(0, m) => {
                assert_eq!(m.text(), "Hello");
                assert_eq!(m.seq_start, 1);
            }
            f => panic!("{f:?}"),
        }
        let c = e(3, "u", json!({"type":"assistant_message","text":"x"}));
        assert!(matches!(fold(&[&a], c), Fold::Push(_)));
        let r = e(3, "t", json!({"type":"reasoning","text":"x"}));
        assert!(matches!(fold(&[&a], r), Fold::Push(_)));
    }

    #[test]
    fn tool_calls_replace() {
        let run = e(
            1,
            "t",
            json!({"type":"tool_call","callId":"c1","status":"running"}),
        );
        let msg = e(2, "t", json!({"type":"assistant_message","text":"x"}));
        let done = e(
            3,
            "t",
            json!({"type":"tool_call","callId":"c1","status":"completed"}),
        );
        match fold(&[&run, &msg], done) {
            Fold::Replace(0, x) => assert_eq!(x.str("status"), Some("completed")),
            f => panic!("{f:?}"),
        }
    }

    #[test]
    fn keys() {
        let t = e(4, "t", json!({"type":"tool_call","callId":"c"}));
        assert_eq!(t.base_key(), "tool:c");
        let u = e(4, "t", json!({"type":"user_message","messageId":"m"}));
        assert_eq!(u.base_key(), "user_message:m");
        let r = e(4, "t", json!({"type":"reasoning"}));
        assert_eq!(r.base_key(), "4:reasoning");
    }
}
