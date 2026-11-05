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

use super::{client_or_toast, toast_err};
use crate::components::{Ico, Icon, Select, SelectOption};
use crate::native::PickedFile;
use crate::shell::toast::ToastKind;
use crate::state::Session;

/// Images up to this size go to the model inline; anything else uploads as a file.
const INLINE_IMAGE_MAX: u64 = 20 * 1024 * 1024;
const MAX_INPUT_PX: i32 = 240;

#[derive(Clone, Debug, PartialEq)]
pub enum AttKind {
    Image { mime: String, data: String },
    Uploading,
    File(Value),
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
}

thread_local! {
    /// Unsent drafts per session, so switching sessions keeps what was typed.
    static DRAFTS: RefCell<HashMap<String, Draft>> = RefCell::new(HashMap::new());
    static NEXT_ATT: std::cell::Cell<u64> = const { std::cell::Cell::new(1) };
    /// The host's provider snapshot (models per provider), loaded once per client.
    static PROVIDERS: RefCell<Option<Value>> = const { RefCell::new(None) };
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
            return;
        };
        atts.update(|a| {
            a.push(Att {
                id,
                name: f.name.clone(),
                kind: AttKind::Uploading,
            })
        });
        spawn_local(async move {
            let bytes = f.bytes;
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
                .upload_file_stream(FileUploadInput {
                    file_name: f.name.clone(),
                    mime_type: mime,
                    size: bytes.len() as u64,
                    modified_at: None,
                    chunk_size: None,
                    read: &read,
                    on_progress: None,
                })
                .await;
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
    client
        .send_message(
            agent_id,
            text,
            SendMessageOptions {
                images: (!images.is_empty()).then_some(Value::Array(images)),
                attachments: (!files.is_empty()).then_some(Value::Array(files)),
                ..Default::default()
            },
        )
        .await
        .map_err(|e| e.to_string())
}

#[derive(Clone, Debug, PartialEq)]
struct Command {
    name: String,
    description: String,
}

#[component]
pub fn Composer(
    agent_id: String,
    #[prop(into)] session: Signal<Option<Session>>,
    #[prop(into)] online: Signal<bool>,
    #[prop(into)] provider: Signal<String>,
    #[prop(optional)] compact: bool,
) -> impl IntoView {
    let draft = DRAFTS.with(|d| d.borrow().get(&agent_id).cloned().unwrap_or_default());
    let text = RwSignal::new(draft.text);
    let atts = RwSignal::new(draft.atts);
    let sending = RwSignal::new(false);
    let drop_over = RwSignal::new(false);
    let commands = RwSignal::new(None::<Vec<Command>>);
    let hi = RwSignal::new(0usize);
    let slash_closed = RwSignal::new(false);
    let input = NodeRef::<leptos::html::Textarea>::new();
    let id = StoredValue::new(agent_id.clone());

    // Keep the draft across remounts and session switches.
    Effect::new(move |_| {
        let d = Draft {
            text: text.get(),
            atts: atts.get(),
        };
        DRAFTS.with(|m| m.borrow_mut().insert(id.get_value(), d));
    });

    let running = Memo::new(move |_| {
        session
            .get()
            .map(|s| s.agent.status == "running")
            .unwrap_or(false)
    });
    let empty = move || text.with(|t| t.trim().is_empty()) && atts.with(Vec::is_empty);
    let uploading = move || atts.with(|a| a.iter().any(|x| x.kind == AttKind::Uploading));

    // Autosize the box to its text, up to a cap.
    let fit = move || {
        if let Some(el) = input.get_untracked() {
            let style = web_sys::HtmlElement::style(&el);
            let _ = style.set_property("height", "auto");
            let h = el.scroll_height().min(MAX_INPUT_PX);
            let _ = style.set_property("height", &format!("{h}px"));
        }
    };
    Effect::new(move |_| {
        text.track();
        request_animation_frame(fit);
    });

    let slash_query = Memo::new(move |_| {
        let t = text.get();
        let q = t.strip_prefix('/')?;
        (!q.contains(char::is_whitespace) && !slash_closed.get()).then(|| q.to_owned())
    });
    Effect::new(move |_| {
        if slash_query.get().is_none() || commands.with_untracked(Option::is_some) {
            return;
        }
        commands.set(Some(Vec::new()));
        let Some(c) = crate::state::get().conn.client() else {
            return;
        };
        let agent = id.get_value();
        spawn_local(async move {
            let list = c
                .list_commands(&agent, None)
                .await
                .ok()
                .and_then(|r| serde_json::to_value(r).ok())
                .and_then(|v| v.get("commands").cloned())
                .and_then(|v| v.as_array().cloned())
                .unwrap_or_default()
                .into_iter()
                .filter_map(|c| {
                    Some(Command {
                        name: c.get("name")?.as_str()?.to_owned(),
                        description: c
                            .get("description")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_owned(),
                    })
                })
                .collect();
            commands.set(Some(list));
        });
    });
    let matches = Memo::new(move |_| {
        let Some(q) = slash_query.get() else {
            return Vec::new();
        };
        let q = q.to_lowercase();
        let mut m: Vec<Command> = commands
            .get()
            .unwrap_or_default()
            .into_iter()
            .filter(|c| c.name.to_lowercase().contains(&q))
            .collect();
        m.sort_by_key(|c| !c.name.to_lowercase().starts_with(&q));
        m.truncate(40);
        m
    });
    let pick = move |c: Command| {
        text.set(format!("/{} ", c.name));
        slash_closed.set(true);
        if let Some(el) = input.get_untracked() {
            let _ = el.focus();
        }
    };

    let submit = move || {
        let t = text.get_untracked().trim().to_owned();
        let list = atts.get_untracked();
        if !online.get_untracked() || sending.get_untracked() || (t.is_empty() && list.is_empty()) {
            return;
        }
        if uploading() {
            crate::state::get().toasts.push(
                crate::shell::toast::Toast::new(ToastKind::Info, "Still uploading")
                    .detail("Send once the files finish uploading."),
            );
            return;
        }
        sending.set(true);
        let agent = id.get_value();
        spawn_local(async move {
            match send(&agent, &t, &list).await {
                Ok(()) => {
                    text.set(String::new());
                    atts.set(Vec::new());
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
            submit();
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
                        if commands.with(|c| c.as_ref().is_some_and(Vec::is_empty)) && m.is_empty() {
                            return view! { <div class="slash-empty t-label">"no commands"</div> }.into_any();
                        }
                        let h = hi.get().min(m.len().saturating_sub(1));
                        m.into_iter()
                            .enumerate()
                            .map(|(i, c)| {
                                let cc = c.clone();
                                view! {
                                    <button
                                        class="opt slash-opt"
                                        class:on=i == h
                                        on:mousedown=move |ev| {
                                            ev.prevent_default();
                                            pick(cc.clone());
                                        }
                                    >
                                        <span class="slash-name t-mono">"/"{c.name}</span>
                                        <span class="slash-desc">{c.description}</span>
                                    </button>
                                }
                            })
                            .collect_view()
                            .into_any()
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
                <Show when=move || !atts.with(Vec::is_empty)>
                    <div class="att-chips">
                        <For
                            each=move || atts.get()
                            key=|a| (a.id, matches!(a.kind, AttKind::Uploading))
                            children=move |a| {
                                let aid = a.id;
                                let ico = match a.kind {
                                    AttKind::Image { .. } => Ico::Image,
                                    _ => Ico::Paperclip,
                                };
                                let up = a.kind == AttKind::Uploading;
                                view! {
                                    <span class="att-chip m-enter" class:uploading=up>
                                        <Icon ico=ico size=12.0 />
                                        <span class="att-name t-mono">{a.name}</span>
                                        {up.then(|| view! { <span class="att-up t-label">"uploading"</span> })}
                                        <button
                                            class="att-x"
                                            aria-label="Remove"
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
                <div class="composer-bar">
                    <button class="icon-btn" aria-label="Attach files" title="Attach files" on:click=move |_| pick_files()>
                        <Icon ico=Ico::Plus size=16.0 />
                    </button>
                    <AgentControls session=session />
                    <span class="spacer"></span>
                    <ContextMeter session=session />
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
                            view! {
                                <button
                                    class="send cut"
                                    class:idle=idle
                                    style="--c:6px"
                                    aria-label=if running.get() { "Queue" } else { "Send" }
                                    title=if running.get() { "Queue behind the running turn" } else { "Send" }
                                    disabled=idle
                                    on:click=move |_| submit()
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

fn providers_snapshot(set: RwSignal<Option<Value>>) {
    if let Some(v) = PROVIDERS.with(|p| p.borrow().clone()) {
        set.set(Some(v));
        return;
    }
    let Some(c) = crate::state::get().conn.client() else {
        return;
    };
    spawn_local(async move {
        if let Ok(v) = c
            .get_providers_snapshot(None, None)
            .await
            .map(|r| serde_json::to_value(r).unwrap_or_default())
        {
            PROVIDERS.with(|p| *p.borrow_mut() = Some(v.clone()));
            set.set(Some(v));
        }
    });
}

/// Model, thinking and mode chips for the live session.
#[component]
fn AgentControls(#[prop(into)] session: Signal<Option<Session>>) -> impl IntoView {
    let snapshot = RwSignal::new(None::<Value>);
    providers_snapshot(snapshot);
    let agent = Memo::new(move |_| session.get().map(|s| s.agent));
    let models = Memo::new(move |_| {
        let provider = agent.with(|a| a.as_ref().map(|a| a.provider.clone()))?;
        snapshot.with(|s| {
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
    let model_chip = move || {
        let a = agent.get()?;
        let current = a
            .runtime_info
            .as_ref()
            .and_then(|r| r.get("model"))
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or(a.model.clone())
            .unwrap_or_default();
        let mut options: Vec<SelectOption> = models
            .get()
            .unwrap_or_default()
            .iter()
            .filter_map(|m| {
                Some(SelectOption {
                    value: m.get("id")?.as_str()?.to_owned(),
                    label: m
                        .get("label")
                        .and_then(Value::as_str)
                        .or(m.get("id")?.as_str())?
                        .to_owned(),
                    hint: m
                        .get("description")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                })
            })
            .collect();
        if !current.is_empty() && !options.iter().any(|o| o.value == current) {
            options.insert(0, SelectOption::new(current.clone(), current.clone()));
        }
        let id = a.id.clone();
        Some(view! {
            <Select
                options=options
                value=current
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
    let mode_chip = move || {
        let a = agent.get()?;
        let modes = a.raw.get("availableModes")?.as_array()?.clone();
        if modes.is_empty() {
            return None;
        }
        let options: Vec<SelectOption> = modes
            .iter()
            .filter_map(|m| {
                Some(SelectOption {
                    value: m.get("id")?.as_str()?.to_owned(),
                    label: m.get("label")?.as_str()?.to_owned(),
                    hint: m
                        .get("description")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                })
            })
            .collect();
        let current = a
            .raw
            .get("currentModeId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let id = a.id.clone();
        Some(view! {
            <Select
                options=options
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
        {model_chip}
        {mode_chip}
    }
}

/// How full the context window is, from the agent's last usage.
#[component]
fn ContextMeter(#[prop(into)] session: Signal<Option<Session>>) -> impl IntoView {
    let pct = Memo::new(move |_| {
        let s = session.get()?;
        let u = s.agent.raw.get("lastUsage")?;
        let used = u.get("contextWindowUsedTokens")?.as_f64()?;
        let max = u.get("contextWindowMaxTokens")?.as_f64()?;
        (max > 0.0).then(|| (used / max * 100.0).clamp(0.0, 100.0))
    });
    move || {
        pct.get().map(|p| {
            let tone = if p >= 85.0 {
                "hot"
            } else if p >= 60.0 {
                "warm"
            } else {
                ""
            };
            view! {
                <span class=format!("ctx-meter {tone}") title=format!("Context {p:.0}% used")>
                    <span class="ctx-track"><span class="ctx-fill" style=format!("width:{p:.0}%")></span></span>
                    <span class="t-mono">{format!("{p:.0}%")}</span>
                </span>
            }
        })
    }
}
