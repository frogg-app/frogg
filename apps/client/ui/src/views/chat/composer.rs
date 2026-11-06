//! The message box (ui-next `Composer.tsx`, `chat/Attach.tsx`, `chat/SlashMenu.tsx`,
//! `chat/AgentControls.tsx`, `chat/ContextMeter.tsx`): Enter sends, Shift+Enter breaks the line,
//! `/` opens the session's commands, files attach from the picker, a paste or a drop. While a
//! turn runs an empty box offers Stop; a typed message is sent and the daemon queues it behind
//! the running turn.

use std::cell::RefCell;
use std::collections::HashMap;

use frogg_client_core::{FileUploadInput, SendMessageOptions};
use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::{json, Value};
use wasm_bindgen::JsCast;

use super::chips::{AccountChip, ProviderChip};
use super::{client_or_toast, composer_size, session_menu, session_state, toast_err};
use crate::components::{Ico, Icon, Select, SelectOption};
use crate::native::PickedFile;
use crate::shell::toast::ToastKind;
use crate::state::timeline::{sent, Entry};
use crate::state::Session;

/// Images up to this size go to the model inline; anything else uploads as a file.
const INLINE_IMAGE_MAX: u64 = 20 * 1024 * 1024;

fn window_height() -> f64 {
    web_sys::window()
        .and_then(|w| w.inner_height().ok())
        .and_then(|h| h.as_f64())
        .unwrap_or(800.0)
}

#[derive(Clone, Debug, PartialEq)]
pub enum AttKind {
    Image {
        mime: String,
        data: String,
    },
    /// Streaming to the host; the signal is the fraction sent (0..=1).
    Uploading(RwSignal<f64>),
    File(Value),
    /// A fork's conversation context (`buildAgentForkContext`), sent as an attachment.
    Fork(Value),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Att {
    pub id: u64,
    pub name: String,
    pub kind: AttKind,
}

#[derive(Clone, Default)]
struct Draft {
    text: String,
    atts: Vec<Att>,
    /// A draft set aside with Ctrl+S; it comes back after the next send.
    stash: Option<Stash>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Stash {
    pub text: String,
    pub atts: Vec<Att>,
}

/// Uploads stream into the live composer only: a saved draft keeps what has landed.
fn settled(atts: &[Att]) -> Vec<Att> {
    atts.iter()
        .filter(|a| !matches!(a.kind, AttKind::Uploading(_)))
        .cloned()
        .collect()
}

/// "Stashed “first line” · back after you send · Ctrl+S to restore now".
pub fn stash_note(s: &Stash) -> String {
    let first = s.text.lines().next().unwrap_or("").trim();
    let what = if first.is_empty() {
        let n = s.atts.len();
        format!("{n} attachment{}", if n == 1 { "" } else { "s" })
    } else if first.chars().count() > 48 {
        format!("“{}…”", first.chars().take(48).collect::<String>())
    } else {
        format!("“{first}”")
    };
    format!("Stashed {what} · back after you send · Ctrl+S to restore now")
}

/// A `!cmd` typed (the host runs it as a shell command).
pub fn is_shell_escape(text: &str) -> bool {
    let mut t = text.trim_start().chars();
    t.next() == Some('!') && t.next().is_some_and(|c| !c.is_whitespace())
}

thread_local! {
    /// Unsent drafts per session, so switching sessions keeps what was typed.
    static DRAFTS: RefCell<HashMap<String, Draft>> = RefCell::new(HashMap::new());
    static NEXT_ATT: std::cell::Cell<u64> = const { std::cell::Cell::new(1) };
}

fn next_att() -> u64 {
    NEXT_ATT.with(|n| {
        let v = n.get();
        n.set(v + 1);
        v
    })
}

fn base64(bytes: &[u8]) -> String {
    let bin: String = bytes.iter().map(|b| *b as char).collect();
    web_sys::window()
        .and_then(|w| w.btoa(&bin).ok())
        .unwrap_or_default()
}

/// Turns picked files into attachments: images inline, the rest uploaded to the host.
fn attach(files: Vec<PickedFile>, atts: RwSignal<Vec<Att>>) {
    for f in files {
        let id = next_att();
        if f.mime.starts_with("image/") && f.size <= INLINE_IMAGE_MAX {
            let data = base64(&f.bytes);
            atts.update(|a| {
                a.push(Att {
                    id,
                    name: f.name.clone(),
                    kind: AttKind::Image {
                        mime: f.mime.clone(),
                        data,
                    },
                })
            });
            continue;
        }
        let Some(client) = client_or_toast() else {
            continue;
        };
        let progress = RwSignal::new(0.0);
        atts.update(|a| {
            a.push(Att {
                id,
                name: f.name.clone(),
                kind: AttKind::Uploading(progress),
            })
        });
        spawn_local(async move {
            let bytes = f.bytes;
            // Removing the chip aborts the upload on the daemon (see `upload_file_stream_cancellable`).
            let gone = move || {
                atts.try_with_untracked(|a| !a.iter().any(|x| x.id == id))
                    .unwrap_or(true)
            };
            let read = |start: u64, end: u64| {
                let end = (end as usize).min(bytes.len());
                bytes[(start as usize).min(end)..end].to_vec()
            };
            let mime = if f.mime.is_empty() {
                "application/octet-stream".to_owned()
            } else {
                f.mime.clone()
            };
            let res = client
                .upload_file_stream_cancellable(
                    FileUploadInput {
                        file_name: f.name.clone(),
                        mime_type: mime,
                        size: bytes.len() as u64,
                        modified_at: None,
                        chunk_size: None,
                        read: &read,
                        on_progress: Some(&|sent: u64, total: u64| {
                            if total > 0 {
                                progress.try_set(sent as f64 / total as f64);
                            }
                        }),
                    },
                    &gone,
                )
                .await;
            if gone() {
                return;
            }
            let file = res
                .map_err(|e| e.to_string())
                .and_then(|r| match (r.file, r.error) {
                    (_, Some(e)) => Err(e),
                    (Value::Null, None) => Err("upload failed".into()),
                    (file, None) => Ok(file),
                });
            match file {
                Ok(v) => atts.update(|a| {
                    if let Some(x) = a.iter_mut().find(|x| x.id == id) {
                        x.kind = AttKind::File(v);
                    }
                }),
                Err(e) => {
                    atts.update(|a| a.retain(|x| x.id != id));
                    toast_err(&format!("Could not upload {}", f.name), e);
                }
            }
        });
    }
}

/// Reads the `File`s of a paste or drop (`DataTransfer.files`) into picks.
fn transfer_files(ev: &web_sys::Event, field: &str) -> Vec<web_sys::File> {
    let Ok(dt) = js_sys::Reflect::get(ev, &field.into()) else {
        return Vec::new();
    };
    let Ok(files) = js_sys::Reflect::get(&dt, &"files".into()) else {
        return Vec::new();
    };
    let Ok(list) = files.dyn_into::<web_sys::FileList>() else {
        return Vec::new();
    };
    (0..list.length()).filter_map(|i| list.get(i)).collect()
}

async fn read_files(files: Vec<web_sys::File>) -> Vec<PickedFile> {
    let mut out = Vec::new();
    for file in files {
        let Ok(buf) = wasm_bindgen_futures::JsFuture::from(file.array_buffer()).await else {
            continue;
        };
        out.push(PickedFile {
            name: file.name(),
            mime: file.type_(),
            size: file.size() as u64,
            bytes: js_sys::Uint8Array::new(&buf).to_vec(),
        });
    }
    out
}

/// Sends a message with its attachments: images inline, uploaded files and fork context as
/// `attachments[]`. Also the held-message send in `session_state`.
pub(super) async fn send(agent_id: &str, text: &str, atts: &[Att]) -> Result<(), String> {
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
            AttKind::File(v) | AttKind::Fork(v) => Some(v.clone()),
            _ => None,
        })
        .collect();
    // The id comes back on the user message, so its bubble can show what was attached.
    let message_id = sent::new_message_id();
    sent::remember(
        &message_id,
        atts.iter()
            .filter_map(|a| {
                let (kind, uri) = match &a.kind {
                    AttKind::Image { mime, data } => {
                        ("image", Some(format!("data:{mime};base64,{data}")))
                    }
                    AttKind::File(_) => ("file", None),
                    AttKind::Fork(_) => ("fork", None),
                    _ => return None,
                };
                Some(sent::SentAtt {
                    id: a.id.to_string(),
                    kind: kind.into(),
                    name: a.name.clone(),
                    uri,
                })
            })
            .collect(),
    );
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

#[derive(Clone, Debug, PartialEq)]
pub struct Command {
    pub name: String,
    pub description: String,
    pub argument_hint: Option<String>,
    pub skill: bool,
}

impl Command {
    fn from_value(c: &Value) -> Option<Self> {
        let s = |k: &str| c.get(k).and_then(Value::as_str);
        Some(Command {
            name: s("name")?.to_owned(),
            description: s("description").unwrap_or("").to_owned(),
            argument_hint: s("argumentHint")
                .filter(|h| !h.is_empty())
                .map(str::to_owned),
            skill: s("kind") == Some("skill"),
        })
    }
}

/// Prefix matches first, then name or description matches; commands before skills; at most 40.
pub fn match_commands(all: &[Command], q: &str) -> Vec<Command> {
    let q = q.to_lowercase();
    let mut scored: Vec<(u8, u8, &Command)> = all
        .iter()
        .filter_map(|c| {
            let n = c.name.to_lowercase();
            let rank = if n.starts_with(&q) {
                0
            } else if n.contains(&q) || c.description.to_lowercase().contains(&q) {
                1
            } else {
                return None;
            };
            Some((u8::from(c.skill), rank, c))
        })
        .collect();
    // Stable: equal keys keep the host's order.
    scored.sort_by_key(|(k, r, _)| (*k, *r));
    scored
        .into_iter()
        .take(40)
        .map(|(_, _, c)| c.clone())
        .collect()
}

#[component]
pub fn Composer(
    agent_id: String,
    session: Memo<Option<Session>>,
    /// The timeline, for the provider chip and whether a clean cut has anything to summarise.
    #[prop(into)]
    rows: Signal<Vec<Entry>>,
    #[prop(into)] online: Signal<bool>,
    #[prop(into)] provider: Signal<String>,
    #[prop(optional)] compact: bool,
    /// Set while a draft is written (presence "typing").
    #[prop(optional)]
    typing: Option<RwSignal<bool>>,
) -> impl IntoView {
    let mut draft = DRAFTS.with(|d| d.borrow().get(&agent_id).cloned().unwrap_or_default());
    // A fork's context waits to ride along with the new session's first message.
    if let Some(f) = session_menu::take_fork_draft(&agent_id) {
        draft.atts.insert(
            0,
            Att {
                id: next_att(),
                name: f.name,
                kind: AttKind::Fork(f.context),
            },
        );
    }
    let text = RwSignal::new(draft.text);
    let atts = RwSignal::new(draft.atts);
    let stash = RwSignal::new(draft.stash);
    let sending = RwSignal::new(false);
    let drop_over = RwSignal::new(false);
    let commands = RwSignal::new(None::<Vec<Command>>);
    let command_error = RwSignal::new(false);
    let hi = RwSignal::new(0usize);
    let slash_closed = RwSignal::new(false);
    let input = NodeRef::<leptos::html::Textarea>::new();
    let id = StoredValue::new(agent_id.clone());

    // Keep the draft across remounts and session switches.
    Effect::new(move |_| {
        let d = Draft {
            text: text.get(),
            atts: atts.with(|a| settled(a)),
            stash: stash.get(),
        };
        DRAFTS.with(|m| m.borrow_mut().insert(id.get_value(), d));
    });

    let running = Memo::new(move |_| {
        session
            .get()
            .map(|s| s.agent.status == "running")
            .unwrap_or(false)
    });
    if let Some(typing) = typing {
        Effect::new(move |_| typing.set(text.with(|t| !t.trim().is_empty())));
        on_cleanup(move || {
            typing.try_set(false);
        });
    }
    // The scissors send: a clean cut first, then this message goes to the fresh conversation.
    let can_cut = Memo::new(move |_| online.get() && session_state::has_feature("agentCleanCut"));
    let cut_blocked = Memo::new(move |_| {
        if running.get() {
            Some("Wait for the turn to finish to make a clean cut")
        } else if !rows.with(|r| r.iter().any(|e| e.kind() == "user_message")) {
            Some("Nothing to summarise yet")
        } else {
            None
        }
    });
    let empty = move || text.with(|t| t.trim().is_empty()) && atts.with(Vec::is_empty);
    let uploading =
        move || atts.with(|a| a.iter().any(|x| matches!(x.kind, AttKind::Uploading(_))));

    // The input's height: follows the text in auto (a hidden mirror wraps like the input and
    // gives the text's own height), glides between sizes, tracks a grip drag 1:1 and is
    // remembered per session.
    let min_h = if compact { 40.0 } else { 48.0 };
    let size = RwSignal::new(composer_size::load(&agent_id));
    let content = RwSignal::new(min_h);
    let win_h = RwSignal::new(window_height());
    let resize = window_event_listener(leptos::ev::resize, move |_| win_h.set(window_height()));
    on_cleanup(move || resize.remove());
    let drag = RwSignal::new(None::<f64>);
    let drag_start = StoredValue::new((0.0f64, 0.0f64));
    let mirror = NodeRef::<leptos::html::Div>::new();
    let bounds = move || composer_size::bounds(min_h, win_h.get());
    let height = Memo::new(move |_| {
        drag.get()
            .unwrap_or_else(|| composer_size::target_height(size.get(), content.get(), bounds()))
    });
    let set_size = move |s: composer_size::Size| {
        size.set(s);
        composer_size::save(&id.get_value(), s);
    };
    let measure = move || {
        if let Some(m) = mirror.get_untracked() {
            content.set(f64::from(m.offset_height()));
        }
    };
    Effect::new(move |_| {
        text.track();
        win_h.track();
        request_animation_frame(measure);
    });
    let expanded = move || size.get() != composer_size::Size::Auto;
    let toggle_size = move || {
        set_size(if size.get_untracked() == composer_size::Size::Auto {
            composer_size::Size::Expanded
        } else {
            composer_size::Size::Auto
        })
    };
    // After a send the big editor folds back; a height the user dragged to stays.
    let collapse = move || {
        if size.get_untracked() == composer_size::Size::Expanded {
            set_size(composer_size::Size::Auto);
        }
    };
    let grip_down = move |ev: leptos::ev::PointerEvent| {
        ev.prevent_default();
        if let Some(t) = ev
            .current_target()
            .and_then(|t| t.dyn_into::<web_sys::Element>().ok())
        {
            let _ = t.set_pointer_capture(ev.pointer_id());
        }
        let h = height.get_untracked();
        drag_start.set_value((f64::from(ev.client_y()), h));
        drag.set(Some(h));
    };
    let grip_move = move |ev: leptos::ev::PointerEvent| {
        if drag.get_untracked().is_none() {
            return;
        }
        let (y0, h0) = drag_start.get_value();
        let b = bounds();
        drag.set(Some(
            (h0 - (f64::from(ev.client_y()) - y0)).clamp(b.min, b.max),
        ));
    };
    let grip_up = move |_: leptos::ev::PointerEvent| {
        let Some(end) = drag.get_untracked() else {
            return;
        };
        drag.set(None);
        set_size(composer_size::settle_drag(
            end,
            content.get_untracked(),
            bounds(),
        ));
    };

    let slash_query = Memo::new(move |_| {
        let t = text.get();
        let q = t.strip_prefix('/')?;
        (!q.contains(char::is_whitespace) && !slash_closed.get()).then(|| q.to_owned())
    });
    let requested = StoredValue::new(false);
    Effect::new(move |_| {
        if slash_query.get().is_none() || requested.get_value() {
            return;
        }
        let Some(c) = crate::state::get().conn.client() else {
            return;
        };
        requested.set_value(true);
        let agent = id.get_value();
        spawn_local(async move {
            let res = c
                .list_commands(&agent, None)
                .await
                .map_err(|e| e.to_string())
                .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string()));
            let list = match res {
                Ok(v) if v.get("error").is_none_or(Value::is_null) => v
                    .get("commands")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().filter_map(Command::from_value).collect())
                    .unwrap_or_default(),
                _ => {
                    command_error.set(true);
                    Vec::new()
                }
            };
            commands.set(Some(list));
        });
    });
    let matches = Memo::new(move |_| {
        let Some(q) = slash_query.get() else {
            return Vec::new();
        };
        commands.with(|c| {
            c.as_deref()
                .map(|c| match_commands(c, &q))
                .unwrap_or_default()
        })
    });
    let pick = move |c: Command| {
        text.set(format!("/{} ", c.name));
        slash_closed.set(true);
        if let Some(el) = input.get_untracked() {
            let _ = el.focus();
        }
    };

    // A stashed draft comes back once the message it made way for has gone.
    let restore = move || {
        collapse();
        let s = stash.get_untracked();
        stash.set(None);
        match s {
            Some(s) => {
                text.set(s.text);
                atts.set(s.atts);
            }
            None => {
                text.set(String::new());
                atts.set(Vec::new());
            }
        }
    };
    // Ctrl+S, as in Claude Code: set the draft aside, or swap it with the one set aside. Files
    // still uploading stay put, since their upload lands on the composer's current list.
    let toggle_stash = move || {
        let t = text.get_untracked();
        let (uploading, keep): (Vec<Att>, Vec<Att>) = atts
            .get_untracked()
            .into_iter()
            .partition(|a| matches!(a.kind, AttKind::Uploading(_)));
        let cur = (!t.is_empty() || !keep.is_empty()).then_some(Stash {
            text: t,
            atts: keep,
        });
        let prev = stash.get_untracked();
        if cur.is_none() && prev.is_none() {
            return;
        }
        let (pt, mut pa) = prev.map(|p| (p.text, p.atts)).unwrap_or_default();
        pa.extend(uploading);
        text.set(pt);
        atts.set(pa);
        stash.set(cur);
        hi.set(0);
        slash_closed.set(false);
    };
    let submit = move |cut: bool| {
        let t = text.get_untracked().trim().to_owned();
        let list = atts.get_untracked();
        if !online.get_untracked() || sending.get_untracked() || (t.is_empty() && list.is_empty()) {
            return;
        }
        if cut && cut_blocked.get_untracked().is_some() {
            return;
        }
        if uploading() {
            crate::state::get().toasts.push(
                crate::shell::toast::Toast::new(ToastKind::Info, "Still uploading")
                    .detail("Send once the files finish uploading."),
            );
            return;
        }
        let agent = id.get_value();
        // A move or clean cut is rewriting the conversation: hold the message until it lands.
        if cut || session_state::busy(&agent) {
            session_state::queue_message(&agent, &t, list);
            restore();
            if cut && !session_state::busy(&agent) {
                let a = agent.clone();
                session_state::run_session_op(
                    &agent,
                    session_state::cut_text(),
                    session_state::clean_cut(a, serde_json::Map::new()),
                );
            }
            return;
        }
        sending.set(true);
        spawn_local(async move {
            match send(&agent, &t, &list).await {
                Ok(()) => {
                    restore();
                }
                Err(e) => toast_err("Message not sent", e),
            }
            sending.set(false);
        });
    };
    let stop = move || {
        let Some(c) = client_or_toast() else {
            return;
        };
        let agent = id.get_value();
        spawn_local(async move {
            if let Err(e) = c.cancel_agent(&agent).await {
                toast_err("Could not stop", e);
            }
        });
    };
    let pick_files = move || {
        spawn_local(async move {
            match crate::native::pick_files(true).await {
                Ok(files) => attach(files, atts),
                Err(e) => toast_err("Could not open files", e),
            }
        });
    };

    let on_key = move |ev: leptos::ev::KeyboardEvent| {
        let k = ev.key();
        if (ev.ctrl_key() || ev.meta_key())
            && !ev.alt_key()
            && !ev.shift_key()
            && k.eq_ignore_ascii_case("s")
        {
            ev.prevent_default();
            toggle_stash();
            return;
        }
        let m = matches.get_untracked();
        if slash_query.get_untracked().is_some() && !m.is_empty() {
            match k.as_str() {
                "ArrowDown" | "ArrowUp" => {
                    ev.prevent_default();
                    let n = m.len();
                    hi.update(|h| {
                        *h = if k == "ArrowDown" {
                            (*h + 1) % n
                        } else {
                            (*h + n - 1) % n
                        }
                    });
                    return;
                }
                "Tab" | "Enter" if !ev.shift_key() => {
                    ev.prevent_default();
                    pick(m[hi.get_untracked().min(m.len() - 1)].clone());
                    return;
                }
                _ => {}
            }
        }
        if k == "Escape" && slash_query.get_untracked().is_some() {
            slash_closed.set(true);
            return;
        }
        if k == "Enter" && !ev.shift_key() && !ev.is_composing() {
            ev.prevent_default();
            submit(false);
        }
    };
    let on_paste = move |ev: leptos::ev::ClipboardEvent| {
        let files = transfer_files(ev.as_ref(), "clipboardData");
        if files.is_empty() {
            return;
        }
        ev.prevent_default();
        spawn_local(async move { attach(read_files(files).await, atts) });
    };
    let on_drop = move |ev: leptos::ev::DragEvent| {
        ev.prevent_default();
        drop_over.set(false);
        let files = transfer_files(ev.as_ref(), "dataTransfer");
        if !files.is_empty() {
            spawn_local(async move { attach(read_files(files).await, atts) });
        }
    };

    let placeholder = move || format!("Message {} — / commands", provider.get());
    view! {
        <div class="composer" class:compact=compact>
            <Show when=move || slash_query.get().is_some()>
                <div class="slash floating up m-pop-up">
                    {move || {
                        let m = matches.get();
                        if commands.with(Option::is_none) {
                            return view! { <div class="slash-empty t-label">"loading commands…"</div> }.into_any();
                        }
                        if m.is_empty() {
                            let note = if command_error.get() {
                                "Commands unavailable; you can still type a command"
                            } else {
                                "No matching commands"
                            };
                            return view! { <div class="slash-empty t-label">{note}</div> }.into_any();
                        }
                        // Commands, then Skills; `match_commands` already orders them so.
                        let h = hi.get().min(m.len() - 1);
                        let mut out = Vec::new();
                        let mut group = None;
                        for (i, c) in m.into_iter().enumerate() {
                            if group != Some(c.skill) {
                                group = Some(c.skill);
                                let title = if c.skill { "Skills" } else { "Commands" };
                                out.push(view! { <div class="slash-head t-label">{title}</div> }.into_any());
                            }
                            let cc = c.clone();
                            out.push(view! {
                                <button
                                    class="opt slash-opt"
                                    class:on=i == h
                                    role="menuitem"
                                    on:mousedown=move |ev| {
                                        ev.prevent_default();
                                        pick(cc.clone());
                                    }
                                >
                                    <span class="slash-name t-mono">
                                        "/"{c.name}
                                        {c.argument_hint.map(|a| view! { <span class="slash-arg">{format!(" {a}")}</span> })}
                                    </span>
                                    {(!c.description.is_empty()).then(|| view! { <span class="slash-desc">{c.description}</span> })}
                                </button>
                            }.into_any());
                        }
                        out.into_any()
                    }}
                </div>
            </Show>
            <div
                class="composer-box cut cut-stroke"
                class:drop=move || drop_over.get()
                style="--c:10px"
                on:dragover=move |ev: leptos::ev::DragEvent| {
                    ev.prevent_default();
                    drop_over.set(true);
                }
                on:dragleave=move |_| drop_over.set(false)
                on:drop=on_drop
            >
                {move || stash.get().map(|s| view! {
                    <div class="composer-note t-mono">{stash_note(&s)}</div>
                })}
                {move || {
                    let cwd = session.with(|s| s.as_ref().map(|s| s.agent.cwd.clone()))?;
                    (online.get()
                        && atts.with(Vec::is_empty)
                        && text.with(|t| is_shell_escape(t))
                        && session_state::has_feature("agentShellEscape"))
                    .then(|| view! {
                        <div class="composer-note shell t-mono">
                            {format!("Shell command · runs in {cwd}; the output goes to the agent with your next message")}
                        </div>
                    })
                }}
                <Show when=move || !atts.with(Vec::is_empty)>
                    <div class="att-chips">
                        <For
                            each=move || atts.get()
                            key=|a| (a.id, matches!(a.kind, AttKind::Uploading(_)))
                            children=move |a| {
                                let aid = a.id;
                                let ico = match a.kind {
                                    AttKind::Image { .. } => Ico::Image,
                                    _ => Ico::Paperclip,
                                };
                                let progress = match a.kind {
                                    AttKind::Uploading(p) => Some(p),
                                    _ => None,
                                };
                                let up = progress.is_some();
                                view! {
                                    <span class="att-chip m-enter" class:uploading=up>
                                        <Icon ico=ico size=12.0 />
                                        <span class="att-name t-mono">{a.name}</span>
                                        {progress.map(|p| view! {
                                            <span class="att-up t-label">
                                                {move || format!("{}%", (p.get() * 100.0).round() as u32)}
                                            </span>
                                            <span class="att-bar" style:width=move || format!("{:.1}%", p.get() * 100.0)></span>
                                        })}
                                        <button
                                            class="att-x"
                                            aria-label=if up { "Cancel upload" } else { "Remove" }
                                            on:click=move |_| atts.update(|l| l.retain(|x| x.id != aid))
                                        >
                                            <Icon ico=Ico::X size=11.0 />
                                        </button>
                                    </span>
                                }
                            }
                        />
                    </div>
                </Show>
                <div
                    class="composer-grip"
                    class:on=move || drag.get().is_some()
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="Drag to resize the message box"
                    on:pointerdown=grip_down
                    on:pointermove=grip_move
                    on:pointerup=grip_up
                    on:pointercancel=move |_| drag.set(None)
                >
                    <span class="composer-grip-bar"></span>
                </div>
                <div
                    class="composer-input-box"
                    class:dragging=move || drag.get().is_some()
                    style:height=move || format!("{}px", height.get())
                >
                <div class="composer-mirror" node_ref=mirror aria-hidden="true">
                    {move || text.with(|t| if t.is_empty() || t.ends_with('\n') { format!("{t} ") } else { t.clone() })}
                </div>
                <textarea
                    class="composer-input"
                    node_ref=input
                    rows="1"
                    placeholder=placeholder
                    prop:value=move || text.get()
                    disabled=move || sending.get()
                    on:input=move |ev| {
                        text.set(event_target_value(&ev));
                        hi.set(0);
                        slash_closed.set(false);
                    }
                    on:keydown=on_key
                    on:paste=on_paste
                ></textarea>
                </div>
                <div class="composer-bar">
                    <button class="icon-btn" aria-label="Attach files" title="Attach files" on:click=move |_| pick_files()>
                        <Icon ico=Ico::Plus size=16.0 />
                    </button>
                    <ProviderChip session=session rows=rows compact=compact />
                    <AgentControls session=session />
                    <AccountChip session=session />
                    <ContextMeter session=session />
                    <span class="spacer"></span>
                    <button
                        class="icon-btn composer-expand"
                        aria-label=move || if expanded() { "Shrink the message box" } else { "Expand the message box" }
                        title=move || if expanded() { "Shrink the message box" } else { "Expand the message box" }
                        on:click=move |_| toggle_size()
                    >
                        {move || if expanded() {
                            view! { <Icon ico=Ico::Minimize2 size=14.0 /> }
                        } else {
                            view! { <Icon ico=Ico::Maximize2 size=14.0 /> }
                        }}
                    </button>
                    {move || {
                        if running.get() && empty() {
                            view! {
                                <button class="send stop cut" style="--c:6px" aria-label="Stop" title="Stop" on:click=move |_| stop()>
                                    <span class="stop-sq"></span>
                                </button>
                            }
                            .into_any()
                        } else {
                            let idle = empty() || !online.get() || sending.get();
                            let cut_btn = can_cut.get().then(|| {
                                let blocked = cut_blocked.get();
                                let off = idle || blocked.is_some();
                                let tip = blocked.unwrap_or("Send with a clean cut");
                                view! {
                                    <span class="cut-send-wrap">
                                        <span class="cut-send-tip t-mono">{tip}</span>
                                        <button
                                            class="cut-send cut cut-stroke"
                                            class:idle=off
                                            style="--c:6px"
                                            aria-label="Send with a clean cut"
                                            aria-disabled=off.to_string()
                                            title=blocked.unwrap_or("Summarises the conversation into a fresh one, then sends")
                                            on:click=move |_| if !off { submit(true) }
                                        >
                                            <Icon ico=Ico::Scissors size=14.0 />
                                        </button>
                                    </span>
                                }
                            });
                            view! {
                                {cut_btn}
                                <button
                                    class="send cut"
                                    class:idle=idle
                                    style="--c:6px"
                                    aria-label=if running.get() { "Queue" } else { "Send" }
                                    title=if running.get() { "Queue behind the running turn" } else { "Send" }
                                    disabled=idle
                                    on:click=move |_| submit(false)
                                >
                                    <Icon ico=Ico::ArrowUp size=16.0 stroke=2.2 />
                                </button>
                            }
                            .into_any()
                        }
                    }}
                </div>
            </div>
        </div>
    }
}

fn opt_str(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(str::to_owned)
}

/// Options for a `Select` from `[{id, label, description}]`.
fn options_of(list: &[Value]) -> Vec<SelectOption> {
    list.iter()
        .filter_map(|m| {
            let id = opt_str(m, "id")?;
            Some(SelectOption {
                label: opt_str(m, "label").unwrap_or_else(|| id.clone()),
                value: id,
                hint: opt_str(m, "description"),
            })
        })
        .collect()
}

/// The model definition a session runs: its own model (or an alias of it), else the provider's
/// default when none is set.
pub fn model_def<'a>(defs: &'a [Value], model: Option<&str>) -> Option<&'a Value> {
    match model.filter(|m| !m.is_empty()) {
        Some(m) => defs.iter().find(|d| {
            d.get("id").and_then(Value::as_str) == Some(m)
                || d.get("aliases")
                    .and_then(Value::as_array)
                    .is_some_and(|a| a.iter().any(|x| x.as_str() == Some(m)))
        }),
        None => defs
            .iter()
            .find(|d| d.get("isDefault").and_then(Value::as_bool) == Some(true)),
    }
}

/// The selected thinking level: the session's choice, what the provider applied, else the
/// model's default.
pub fn thinking_id(agent: &Value, def: Option<&Value>) -> Option<String> {
    opt_str(agent, "thinkingOptionId")
        .or_else(|| opt_str(agent, "effectiveThinkingOptionId"))
        .or_else(|| def.and_then(|d| opt_str(d, "defaultThinkingOptionId")))
        .or_else(|| {
            def?.get("thinkingOptions")?
                .as_array()?
                .iter()
                .find(|o| o.get("isDefault").and_then(Value::as_bool) == Some(true))
                .and_then(|o| opt_str(o, "id"))
        })
}

fn info_toast(title: &str, detail: String) {
    crate::state::get()
        .toasts
        .push(crate::shell::toast::Toast::new(ToastKind::Info, title.to_owned()).detail(detail));
}

/// Model, thinking and mode pickers for the live session, fed by the host's provider snapshot.
#[component]
fn AgentControls(session: Memo<Option<Session>>) -> impl IntoView {
    let cfg = crate::state::config::get();
    Effect::new(move |_| {
        if cfg.providers.with(Option::is_none) && crate::state::get().conn.client().is_some() {
            cfg.load_providers();
        }
    });
    let agent = Memo::new(move |_| session.get().map(|s| s.agent));
    let defs = Memo::new(move |_| {
        let provider = agent.with(|a| a.as_ref().map(|a| a.provider.clone()))?;
        cfg.providers.with(|s| {
            s.as_ref()?
                .get("entries")?
                .as_array()?
                .iter()
                .find(|e| e.get("provider").and_then(Value::as_str) == Some(provider.as_str()))?
                .get("models")?
                .as_array()
                .cloned()
        })
    });
    let model = Memo::new(move |_| {
        agent.with(|a| {
            let a = a.as_ref()?;
            a.runtime_info
                .as_ref()
                .and_then(|r| r.get("model"))
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or(a.model.clone())
                .filter(|m| !m.is_empty())
        })
    });
    let model_chip = move || {
        let a = agent.get()?;
        let defs = defs.get().unwrap_or_default();
        let mut options = options_of(&defs);
        // No model set: the label is the provider's default model.
        let shown = model
            .get()
            .or_else(|| model_def(&defs, None).and_then(|d| opt_str(d, "id")))
            .unwrap_or_default();
        if !shown.is_empty() && !options.iter().any(|o| o.value == shown) {
            options.insert(0, SelectOption::new(shown.clone(), shown.clone()));
        }
        let id = a.id.clone();
        Some(view! {
            <Select
                options=options
                value=shown
                placeholder="default model"
                chip=true
                mono=true
                on_change=Callback::new(move |v: String| {
                    let Some(c) = client_or_toast() else { return };
                    let id = id.clone();
                    spawn_local(async move {
                        if let Err(e) = c.set_agent_model(&id, Some(&v)).await {
                            toast_err("Could not change model", e);
                        }
                    });
                })
            />
        })
    };
    let thinking_chip = move || {
        let a = agent.get()?;
        let defs = defs.get().unwrap_or_default();
        let def = model_def(&defs, model.get().as_deref());
        let levels = def?.get("thinkingOptions")?.as_array()?.clone();
        if levels.is_empty() {
            return None;
        }
        let current = thinking_id(&a.raw, def).unwrap_or_default();
        let id = a.id.clone();
        Some(view! {
            <Select
                options=options_of(&levels)
                value=current
                placeholder="thinking"
                chip=true
                on_change=Callback::new(move |v: String| {
                    let Some(c) = client_or_toast() else { return };
                    let id = id.clone();
                    spawn_local(async move {
                        match c.set_agent_thinking_option(&id, Some(&v)).await {
                            Ok(notice) => {
                                if let Some(m) = notice
                                    .as_ref()
                                    .and_then(|n| n.get("message"))
                                    .and_then(Value::as_str)
                                {
                                    info_toast("Thinking level", m.to_owned());
                                }
                            }
                            Err(e) => toast_err("Could not change thinking level", e),
                        }
                    });
                })
            />
        })
    };
    let mode_chip = move || {
        let a = agent.get()?;
        let modes = a.raw.get("availableModes")?.as_array()?.clone();
        if modes.is_empty() {
            return None;
        }
        let current = opt_str(&a.raw, "currentModeId").unwrap_or_default();
        let id = a.id.clone();
        Some(view! {
            <Select
                options=options_of(&modes)
                value=current
                chip=true
                on_change=Callback::new(move |v: String| {
                    let Some(c) = client_or_toast() else { return };
                    let id = id.clone();
                    spawn_local(async move {
                        if let Err(e) = c.set_agent_mode(&id, &v).await {
                            toast_err("Could not change mode", e);
                        }
                    });
                })
            />
        })
    };
    view! {
        <span class="composer-ctl">
            {model_chip}
            {thinking_chip}
            {mode_chip}
        </span>
    }
}

/// "12K" from a thousand tokens up.
pub fn ktok(n: f64) -> String {
    if n >= 1000.0 {
        format!("{}K", (n / 1000.0).round())
    } else {
        format!("{}", n.round())
    }
}

const RING: f64 = 14.0;
const RING_STROKE: f64 = 2.0;

/// Context window fill for the last turn: a ring plus percentage, token counts on hover.
#[component]
fn ContextMeter(session: Memo<Option<Session>>) -> impl IntoView {
    let usage = Memo::new(move |_| {
        let s = session.get()?;
        let u = s.agent.raw.get("lastUsage")?;
        let used = u.get("contextWindowUsedTokens")?.as_f64()?;
        let max = u.get("contextWindowMaxTokens")?.as_f64()?;
        (max > 0.0).then_some((used, max))
    });
    move || {
        usage.get().map(|(used, max)| {
            let p = (used / max * 100.0).clamp(0.0, 100.0);
            let tone = if p >= 90.0 {
                "var(--coral)"
            } else if p >= 70.0 {
                "var(--amber)"
            } else {
                "var(--cyan)"
            };
            let r = (RING - RING_STROKE) / 2.0;
            let circ = 2.0 * std::f64::consts::PI * r;
            let c = RING / 2.0;
            let label = format!("Context {p:.0}% · {} of {} tokens", ktok(used), ktok(max));
            view! {
                <span class="ctx-meter" title=label.clone() aria-label=label>
                    <svg width=RING height=RING viewBox=format!("0 0 {RING} {RING}")>
                        <circle cx=c cy=c r=r fill="none" stroke="var(--line2)" stroke-width=RING_STROKE />
                        <circle
                            class="ctx-arc"
                            cx=c
                            cy=c
                            r=r
                            fill="none"
                            stroke=tone
                            stroke-width=RING_STROKE
                            stroke-linecap="round"
                            stroke-dasharray=circ
                            stroke-dashoffset=circ * (1.0 - p / 100.0)
                            transform=format!("rotate(-90 {c} {c})")
                        />
                    </svg>
                    <span class="t-mono ctx-pct" style=(p >= 70.0).then(|| format!("color:{tone}"))>
                        {format!("{p:.0}%")}
                    </span>
                </span>
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn model_def_falls_back_to_default() {
        let defs = vec![
            json!({"id":"a","aliases":["alpha"]}),
            json!({"id":"b","isDefault":true,"defaultThinkingOptionId":"hi"}),
        ];
        assert_eq!(model_def(&defs, Some("alpha")).unwrap()["id"], "a");
        assert_eq!(model_def(&defs, None).unwrap()["id"], "b");
        assert!(model_def(&defs, Some("zzz")).is_none());
        let def = model_def(&defs, None);
        assert_eq!(thinking_id(&json!({}), def).as_deref(), Some("hi"));
        assert_eq!(
            thinking_id(&json!({"thinkingOptionId":"lo"}), def).as_deref(),
            Some("lo")
        );
    }

    #[test]
    fn slash_matches_rank() {
        let c = |name: &str, desc: &str, skill: bool| Command {
            name: name.into(),
            description: desc.into(),
            argument_hint: None,
            skill,
        };
        let all = vec![
            c("review-pr", "", true),
            c("preview", "", false),
            c("reset", "clear the review", false),
            c("review", "", false),
        ];
        let names: Vec<_> = match_commands(&all, "rev")
            .into_iter()
            .map(|c| c.name)
            .collect();
        assert_eq!(names, ["review", "preview", "reset", "review-pr"]);
        assert!(match_commands(&all, "zzz").is_empty());
    }

    #[test]
    fn stash_and_shell_notes() {
        let s = Stash {
            text: "fix the bug\nmore".into(),
            atts: vec![],
        };
        assert_eq!(
            stash_note(&s),
            "Stashed “fix the bug” · back after you send · Ctrl+S to restore now"
        );
        let s = Stash {
            text: String::new(),
            atts: vec![Att {
                id: 1,
                name: "a.png".into(),
                kind: AttKind::File(Value::Null),
            }],
        };
        assert!(stash_note(&s).starts_with("Stashed 1 attachment ·"));
        assert!(is_shell_escape("  !ls -la"));
        assert!(!is_shell_escape("! ls"));
        assert!(!is_shell_escape("hi !ls"));
    }

    #[test]
    fn token_counts() {
        assert_eq!(ktok(950.0), "950");
        assert_eq!(ktok(12_400.0), "12K");
    }
}
