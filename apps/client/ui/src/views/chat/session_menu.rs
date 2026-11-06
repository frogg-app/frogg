//! The chat header ⋯ (ui-next `chat/SessionMenu.tsx`): rename, fork, rewind, clean cut, detach,
//! new window (desktop), copy ID, archive with an unsaved-work check.

use std::cell::RefCell;
use std::collections::HashMap;

use frogg_client_core::protocol::inbound;
use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::{json, Value};

use super::session_state::{self as ops, has_feature};
use super::{toast_err, PARENT_LABEL};
use crate::components::{
    Button, ButtonKind, Ico, Icon, Menu, MenuItem, Sheet as Dialog, StatusGlyph, TextInput,
};
use crate::shell::toast::{Toast, ToastKind};
use crate::state::timeline::Entry;
use crate::state::{Bucket, Session, Tool};

/// A fork's conversation context, waiting to ride along with the new session's first message.
#[derive(Debug, Clone, PartialEq)]
pub struct ForkDraft {
    /// Chip label, e.g. "Forked conversation · 42 items".
    pub name: String,
    /// The `attachments[]` entry for `send_message`.
    pub context: Value,
}

thread_local! {
    static FORK_DRAFTS: RefCell<HashMap<String, ForkDraft>> = RefCell::new(HashMap::new());
}

/// Wired by the composer's initial attachments (slice 7b).
#[allow(dead_code)]
/// Takes the pending fork context for a new session (the composer's initial attachment).
pub fn take_fork_draft(agent_id: &str) -> Option<ForkDraft> {
    FORK_DRAFTS.with(|d| d.borrow_mut().remove(agent_id))
}

/// Builds a new session on the same checkout carrying this conversation as context.
pub async fn fork(session: &Session, boundary_message_id: Option<&str>) -> Result<String, String> {
    let app = crate::state::get();
    let c = app.conn.client().ok_or("Not connected to a host")?;
    let a = &session.agent;
    let ctx = c
        .build_agent_fork_context(&a.id, None, boundary_message_id)
        .await
        .map_err(|e| e.to_string())?;
    if let Some(e) = ctx.error {
        return Err(e);
    }
    if ctx.attachment.is_null() {
        return Err("Nothing to fork".into());
    }
    let mut config = json!({
        "provider": a.provider,
        "cwd": a.cwd,
        "title": format!("Fork of {}", a.title.clone().filter(|t| !t.trim().is_empty()).unwrap_or_else(|| "session".into())),
    });
    if let Some(m) = &a.model {
        config["model"] = m.clone().into();
    }
    if let Some(m) = a.raw.get("currentModeId").filter(|v| v.is_string()) {
        config["modeId"] = m.clone();
    }
    let mut req = json!({ "requestId": "", "config": config });
    if let Some(w) = a.raw.get("workspaceId").filter(|v| v.is_string()) {
        req["workspaceId"] = w.clone();
    }
    let req: inbound::CreateAgentRequest = crate::state::projects::build(req)?;
    let created = c.create_agent(&req).await.map_err(|e| e.to_string())?;
    let id = created["id"].as_str().unwrap_or_default().to_owned();
    FORK_DRAFTS.with(|d| {
        d.borrow_mut().insert(
            id.clone(),
            ForkDraft {
                name: format!("Forked conversation · {} items", ctx.item_count),
                context: ctx.attachment.clone(),
            },
        )
    });
    if let (Some(h), Some(s)) = (
        app.hosts.active_id.get_untracked(),
        Session::from_entry(&created, None),
    ) {
        let project = session.project.clone();
        app.agents.by_host.update(|m| {
            m.entry(h)
                .or_default()
                .insert(id.clone(), Session { project, ..s });
        });
    }
    Ok(id)
}

/// The latest user message a rewind returns to, and what rewinding there undoes.
#[derive(Debug, Clone, PartialEq)]
pub struct Target {
    pub message_id: String,
    pub text: String,
    /// User and assistant messages from it on.
    pub removes: usize,
    /// Files edited from it on.
    pub files: usize,
}

pub fn last_user_message(entries: &[Entry]) -> Option<Target> {
    let i = entries
        .iter()
        .rposition(|e| e.kind() == "user_message" && e.str("messageId").is_some())?;
    let after = &entries[i..];
    Some(Target {
        message_id: entries[i].str("messageId")?.to_owned(),
        text: entries[i].text().to_owned(),
        removes: after
            .iter()
            .filter(|e| matches!(e.kind(), "user_message" | "assistant_message"))
            .count(),
        files: ops::edited_files(after.iter()),
    })
}

pub fn excerpt(t: &str, n: usize) -> String {
    let one = t.split_whitespace().collect::<Vec<_>>().join(" ");
    if one.chars().count() > n {
        format!("{}…", one.chars().take(n - 1).collect::<String>())
    } else {
        one
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Open {
    Rename,
    Archive,
    Rewind,
}

fn ok_toast(title: &str, detail: Option<String>) {
    let mut t = Toast::new(ToastKind::Done, title);
    if let Some(d) = detail {
        t = t.detail(d);
    }
    crate::state::get().toasts.push(t);
}

fn do_fork(session: Memo<Option<Session>>) {
    let Some(s) = session.get_untracked() else {
        return;
    };
    spawn_local(async move {
        match fork(&s, None).await {
            Ok(id) => {
                ok_toast(
                    "Forked",
                    Some("A new session carries this conversation".into()),
                );
                crate::state::get().ui.select(Some(id));
            }
            Err(e) => toast_err("Fork failed", e),
        }
    });
}

/// The ⋯ button and its menu and dialogs.
#[component]
pub fn SessionMenu(session: Memo<Option<Session>>, rows: Signal<Vec<Entry>>) -> impl IntoView {
    let app = crate::state::get();
    let menu = RwSignal::new(false);
    let open = RwSignal::new(None::<Open>);
    let target = Memo::new(move |_| rows.with(|r| last_user_message(r)));
    let items = move || {
        let s = session.get()?;
        let a = s.agent.clone();
        let id = a.id.clone();
        let running = a.status == "running";
        let caps = a.raw.get("capabilities").cloned().unwrap_or(Value::Null);
        let cap = |k: &str| caps.get(k).and_then(Value::as_bool) == Some(true);
        let can_rewind = has_feature("rewind")
            && (cap("supportsRewindBoth")
                || cap("supportsRewindConversation")
                || cap("supportsRewindFiles"));
        let op = ops::op_of(&id);
        let mut list =
            vec![MenuItem::new("Rename…", move || open.set(Some(Open::Rename))).icon(Ico::Pencil)];
        if has_feature("agentForkContext") {
            list.push(
                MenuItem::new("Fork session", move || do_fork(session))
                    .icon(Ico::GitFork)
                    .hint("New session with this context"),
            );
        }
        if can_rewind {
            let has_target = target.get().is_some();
            let enabled = has_target && !running;
            let mut item = MenuItem::new("Rewind…", move || {
                if enabled {
                    open.set(Some(Open::Rewind));
                }
            })
            .icon(Ico::Undo2);
            if !has_target {
                item = item.hint("Nothing to rewind yet");
            } else if running {
                item = item.hint("Wait for the turn to finish");
            }
            list.push(item);
        }
        if has_feature("agentCleanCut") {
            let enabled = !running && op.is_none();
            let cid = id.clone();
            let hint = match &op {
                Some(o) => format!("{}…", o.label),
                None if running => "Wait for the turn to finish".into(),
                None => "Summarise, continue in a fresh context".into(),
            };
            list.push(
                MenuItem::new("Clean cut", move || {
                    if enabled {
                        let id = cid.clone();
                        ops::run_session_op(
                            &id.clone(),
                            ops::cut_text(),
                            ops::clean_cut(id, Default::default()),
                        );
                    }
                })
                .icon(Ico::Scissors)
                .hint(hint),
            );
        }
        let is_child = a
            .raw
            .get("labels")
            .and_then(|l| l.get(PARENT_LABEL))
            .is_some();
        if is_child && has_feature("agentDetach") {
            let did = id.clone();
            list.push(
                MenuItem::new("Detach from parent", move || {
                    let id = did.clone();
                    spawn_local(async move {
                        let Some(c) = super::client_or_toast() else {
                            return;
                        };
                        match c.detach_agent(&id).await {
                            Ok(()) => ok_toast(
                                "Detached",
                                Some("It now shows as a session of its own".into()),
                            ),
                            Err(e) => toast_err("Could not detach", e),
                        }
                    });
                })
                .icon(Ico::Unlink)
                .hint("List it as a session of its own"),
            );
        }
        if crate::native::is_tauri()
            && !app.viewport.phone()
            && crate::native::launch().popout.is_none()
        {
            let wid = id.clone();
            list.push(
                MenuItem::new("Open in new window", move || {
                    crate::native::open_session_window(
                        &wid,
                        app.hosts.active_id.get_untracked().as_deref(),
                    )
                })
                .icon(Ico::AppWindow)
                .hint("Pop this session out"),
            );
        }
        let cid = id.clone();
        list.push(
            MenuItem::new("Copy session ID", move || {
                let id = cid.clone();
                spawn_local(async move {
                    if crate::native::clipboard_write(&id).await.is_ok() {
                        ok_toast("Copied session ID", Some(id));
                    }
                });
            })
            .icon(Ico::Copy),
        );
        list.push(
            MenuItem::new("Archive session…", move || open.set(Some(Open::Archive)))
                .icon(Ico::Archive)
                .danger(),
        );
        Some(list)
    };
    let close = Callback::new(move |_| open.set(None));
    view! {
        <div class="sm-anchor">
            <button
                class="icon-btn sm-btn"
                aria-label="Session actions"
                on:click=move |_| menu.update(|m| *m = !*m)
            >
                <Icon ico=Ico::MoreHorizontal size=18.0 />
            </button>
            {move || {
                // Rebuilt when the session, its operation or the rewind target changes.
                items().map(|items| view! {
                    <Menu open=menu on_close=Callback::new(move |_| menu.set(false)) items=items align_right=true />
                })
            }}
        </div>
        <RenameDialog session=session open=Signal::derive(move || open.get() == Some(Open::Rename)) on_close=close />
        <ArchiveDialog session=session open=Signal::derive(move || open.get() == Some(Open::Archive)) on_close=close />
        <RewindDialog
            session=session
            target=target
            open=Signal::derive(move || open.get() == Some(Open::Rewind) && target.with(Option::is_some))
            on_close=close
        />
    }
}

#[component]
fn RenameDialog(
    session: Memo<Option<Session>>,
    open: Signal<bool>,
    on_close: Callback<()>,
) -> impl IntoView {
    let name = RwSignal::new(String::new());
    let busy = RwSignal::new(false);
    Effect::new(move |_| {
        if open.get() {
            busy.set(false);
            name.set(
                session
                    .get_untracked()
                    .and_then(|s| s.agent.title)
                    .unwrap_or_default(),
            );
        }
    });
    let save = move || {
        let t = name.get_untracked().trim().to_owned();
        let Some(id) = session.get_untracked().map(|s| s.agent.id) else {
            return;
        };
        if t.is_empty() || busy.get_untracked() {
            return;
        }
        busy.set(true);
        spawn_local(async move {
            match crate::state::projects::rename_session(&id, &t).await {
                Ok(()) => {
                    ok_toast("Renamed", Some(t));
                    on_close.run(());
                }
                Err(e) => {
                    busy.set(false);
                    toast_err("Rename failed", e);
                }
            }
        });
    };
    view! {
        <Dialog open=open on_close=on_close title="Rename session".to_string() width=420.0>
            <span class="t-label sm-eyebrow">"Session"</span>
            <TextInput value=name placeholder="Session title" autofocus=true on_enter=Callback::new(move |_| save()) />
            <div class="sheet-actions">
                <Button label="Cancel" on_press=on_close />
                <Button
                    label="Rename"
                    kind=ButtonKind::Primary
                    disabled=Signal::derive(move || busy.get() || name.get().trim().is_empty())
                    on_press=Callback::new(move |_| save())
                />
            </div>
        </Dialog>
    }
}

/// What a checkout would lose: uncommitted changes and unpushed commits.
#[derive(Debug, Clone, PartialEq)]
struct Risk {
    dirty: bool,
    unpushed: u64,
    branch: Option<String>,
}

fn risk_of(st: &Value) -> Option<Risk> {
    (st.get("isGit").and_then(Value::as_bool) == Some(true)).then(|| Risk {
        dirty: st.get("isDirty").and_then(Value::as_bool).unwrap_or(false),
        unpushed: st.get("aheadOfOrigin").and_then(Value::as_u64).unwrap_or(0),
        branch: st
            .get("currentBranch")
            .and_then(Value::as_str)
            .map(str::to_owned),
    })
}

#[component]
fn ArchiveDialog(
    session: Memo<Option<Session>>,
    open: Signal<bool>,
    on_close: Callback<()>,
) -> impl IntoView {
    let app = crate::state::get();
    // None = still checking; Some(Err) = the check failed; Some(Ok(None)) = not a git checkout.
    let risk = RwSignal::new(None::<Result<Option<Risk>, ()>>);
    let busy = RwSignal::new(false);
    Effect::new(move |_| {
        if !open.get() {
            return;
        }
        risk.set(None);
        busy.set(false);
        let Some(cwd) = session.get_untracked().map(|s| s.agent.cwd) else {
            return;
        };
        let Some(c) = app.conn.client() else {
            risk.set(Some(Err(())));
            return;
        };
        spawn_local(async move {
            let r = c.get_checkout_status(&cwd).await.map(|v| {
                let st = v
                    .get("payload")
                    .filter(|p| p.get("isGit").is_some())
                    .unwrap_or(&v)
                    .clone();
                risk_of(&st)
            });
            let _ = risk.try_set(Some(r.map_err(|_| ())));
        });
    });
    let unsaved = Memo::new(move |_| {
        risk.with(|r| match r {
            Some(Ok(Some(r))) => r.dirty || r.unpushed > 0,
            _ => false,
        })
    });
    let go = move || {
        let Some(s) = session.get_untracked() else {
            return;
        };
        busy.set(true);
        let id = s.agent.id.clone();
        let title = s.agent.title.clone();
        spawn_local(async move {
            match crate::state::projects::archive_session(&id).await {
                Ok(()) => {
                    ok_toast("Archived", title);
                    on_close.run(());
                    if app.ui.selected.get_untracked().as_deref() == Some(id.as_str()) {
                        app.ui.select(None);
                    }
                }
                Err(e) => {
                    busy.set(false);
                    toast_err("Archive failed", e);
                }
            }
        });
    };
    let title = move || {
        session
            .get()
            .map(|s| format!("Archive “{}”?", s.agent.title_or_untitled()))
            .unwrap_or_default()
    };
    view! {
        <Dialog open=open on_close=on_close title="Archive session".to_string()>
            <span class="t-display sheet-sub">{title}</span>
            <span class="sheet-muted">
                "The agent stops and the session leaves your lists. Files on disk stay as they are; you can restore from History."
            </span>
            {move || match risk.get() {
                None => view! { <span class="t-label">"checking for unsaved work…"</span> }.into_any(),
                Some(Err(())) => view! {
                    <span class="sm-mut">"Could not check for unsaved work. Review the checkout before archiving."</span>
                }
                .into_any(),
                Some(Ok(Some(r))) if r.dirty || r.unpushed > 0 => view! {
                    <div class="sm-warn">
                        <span class="sm-warn-head">"Not saved anywhere else"</span>
                        {r.dirty.then(|| view! {
                            <div class="sm-ck"><StatusGlyph bucket=Bucket::Needs size=7.0 /><span>"Uncommitted changes"</span></div>
                        })}
                        {(r.unpushed > 0).then(|| view! {
                            <div class="sm-ck">
                                <StatusGlyph bucket=Bucket::Needs size=7.0 />
                                <span>{format!(
                                    "{} unpushed commit{}{}",
                                    r.unpushed,
                                    if r.unpushed == 1 { "" } else { "s" },
                                    r.branch.as_ref().map(|b| format!(" on {b}")).unwrap_or_default(),
                                )}</span>
                            </div>
                        })}
                    </div>
                }
                .into_any(),
                Some(Ok(_)) => ().into_any(),
            }}
            <div class="sheet-actions">
                <Button label="Cancel" on_press=on_close />
                <Show when=move || unsaved.get()>
                    <Button
                        label="Review changes first"
                        on_press=Callback::new(move |_| {
                            on_close.run(());
                            app.ui.set_tool(Tool::Scm);
                        })
                    />
                </Show>
                <Button
                    label=Signal::derive(move || if unsaved.get() { "Archive anyway".to_string() } else { "Archive".to_string() })
                    kind=ButtonKind::Danger
                    disabled=Signal::derive(move || busy.get() || risk.with(Option::is_none))
                    on_press=Callback::new(move |_| go())
                />
            </div>
        </Dialog>
    }
}

const MODES: [(&str, &str, &str); 3] = [
    ("both", "Conversation and files", "supportsRewindBoth"),
    (
        "conversation",
        "Conversation only",
        "supportsRewindConversation",
    ),
    ("files", "Files only", "supportsRewindFiles"),
];

/// "Removes 2 messages and reverts 1 file. " for a mode.
pub fn rewind_summary(mode: &str, t: &Target) -> String {
    let mut parts = Vec::new();
    if mode != "files" {
        parts.push(format!(
            "removes {} message{}",
            t.removes,
            if t.removes == 1 { "" } else { "s" }
        ));
    }
    if mode != "conversation" && t.files > 0 {
        parts.push(format!(
            "reverts {} file{}",
            t.files,
            if t.files == 1 { "" } else { "s" }
        ));
    }
    if parts.is_empty() {
        return String::new();
    }
    let s = format!("{}. ", parts.join(" and "));
    let mut c = s.chars();
    c.next()
        .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
        .unwrap_or_default()
}

#[component]
fn RewindDialog(
    session: Memo<Option<Session>>,
    target: Memo<Option<Target>>,
    open: Signal<bool>,
    on_close: Callback<()>,
) -> impl IntoView {
    let allowed = Memo::new(move |_| {
        let caps = session
            .get()
            .and_then(|s| s.agent.raw.get("capabilities").cloned())
            .unwrap_or(Value::Null);
        MODES
            .iter()
            .filter(|(_, _, cap)| caps.get(*cap).and_then(Value::as_bool) == Some(true))
            .map(|(id, label, _)| (*id, *label))
            .collect::<Vec<_>>()
    });
    let mode = RwSignal::new("conversation");
    let busy = RwSignal::new(false);
    Effect::new(move |_| {
        if open.get() {
            busy.set(false);
            mode.set(
                allowed
                    .get_untracked()
                    .first()
                    .map(|m| m.0)
                    .unwrap_or("conversation"),
            );
        }
    });
    let go = move || {
        let (Some(s), Some(t)) = (session.get_untracked(), target.get_untracked()) else {
            return;
        };
        busy.set(true);
        let m = mode.get_untracked();
        spawn_local(async move {
            let Some(c) = super::client_or_toast() else {
                return;
            };
            match c.rewind_agent(&s.agent.id, &t.message_id, m).await {
                Ok(_) => {
                    ok_toast("Rewound", Some(excerpt(&t.text, 48)));
                    on_close.run(());
                    let host = crate::state::get()
                        .hosts
                        .active_id
                        .get_untracked()
                        .unwrap_or_default();
                    let tl = crate::state::timeline::get(&host, &s.agent.id);
                    crate::state::timeline::open(c, tl, s.agent.id.clone()).await;
                }
                Err(e) => {
                    busy.set(false);
                    toast_err("Rewind failed", e);
                }
            }
        });
    };
    let title = move || {
        target
            .get()
            .map(|t| format!("Rewind to “{}”?", excerpt(&t.text, 48)))
            .unwrap_or_default()
    };
    view! {
        <Dialog open=open on_close=on_close title="Rewind".to_string()>
            <span class="t-display sheet-sub">{title}</span>
            <div class="sm-choices" role="radiogroup">
                {move || allowed.get().into_iter().map(|(id, label)| view! {
                    <button
                        class="sm-choice"
                        class:on=move || mode.get() == id
                        role="radio"
                        aria-checked=move || (mode.get() == id).to_string()
                        on:click=move |_| mode.set(id)
                    >
                        <span class="sm-radio"></span>
                        <span>{label}</span>
                    </button>
                }).collect_view()}
            </div>
            <span class="sm-mut">
                {move || target.get().map(|t| rewind_summary(mode.get(), &t)).unwrap_or_default()}
                "This cannot be undone; fork first if unsure."
            </span>
            <div class="sheet-actions">
                <Show when=move || has_feature("agentForkContext")>
                    <Button
                        label="Fork instead"
                        on_press=Callback::new(move |_| {
                            on_close.run(());
                            do_fork(session);
                        })
                    />
                </Show>
                <Button label="Rewind" kind=ButtonKind::Danger disabled=busy on_press=Callback::new(move |_| go()) />
            </div>
        </Dialog>
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(item: Value) -> Entry {
        Entry {
            seq_start: 0,
            seq_end: 0,
            turn_id: None,
            timestamp: None,
            item,
        }
    }

    #[test]
    fn rewind_target_counts_what_goes() {
        let rows = vec![
            e(json!({"type":"user_message","text":"first","messageId":"m1"})),
            e(json!({"type":"assistant_message","text":"a"})),
            e(json!({"type":"user_message","text":"second   one","messageId":"m2"})),
            e(json!({"type":"tool_call","callId":"c1","detail":{"type":"write","filePath":"x"}})),
            e(json!({"type":"assistant_message","text":"b"})),
        ];
        let t = last_user_message(&rows).unwrap();
        assert_eq!(t.message_id, "m2");
        assert_eq!((t.removes, t.files), (2, 1));
        assert_eq!(
            rewind_summary("both", &t),
            "Removes 2 messages and reverts 1 file. "
        );
        assert_eq!(rewind_summary("files", &t), "Reverts 1 file. ");
        assert_eq!(excerpt(&t.text, 48), "second one");
        assert_eq!(excerpt("abcdef", 4), "abc…");
    }

    #[test]
    fn risk_reads_checkout_status() {
        let r =
            risk_of(&json!({"isGit":true,"isDirty":true,"aheadOfOrigin":2,"currentBranch":"b"}));
        assert_eq!(
            r,
            Some(Risk {
                dirty: true,
                unpushed: 2,
                branch: Some("b".into())
            })
        );
        assert_eq!(risk_of(&json!({"isGit":false})), None);
    }
}
