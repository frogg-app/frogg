//! The open session's chat (ui-next `components/Chat.tsx`): header, sub-work strip, the timeline
//! (windowed, bottom-anchored, with load-earlier), pending permissions, the live activity line
//! and the composer.

mod composer;
mod item;
mod permission;
mod subwork;
mod tool;

use frogg_client_core::DaemonClient;
use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::Value;

use crate::components::{Ico, Icon, StatusGlyph};
use crate::shell::toast::{Toast, ToastKind};
use crate::state::timeline::{self, Entry};
use crate::state::{bucket_of, Bucket, Conn};

pub use composer::Composer;
pub use item::TimelineItem;
pub use permission::PermissionCard;

/// Rows rendered at first; "Show earlier" widens the window before asking the host for more.
const WINDOW: usize = 120;
const WINDOW_STEP: usize = 100;
/// Within this distance of the bottom the view follows new content.
const PIN_PX: i32 = 48;

const PARENT_LABEL: &str = "frogg.parent-agent-id";

pub(crate) fn toast_err(title: &str, e: impl std::fmt::Display) {
    crate::state::get()
        .toasts
        .push(Toast::new(ToastKind::Error, title).detail(e.to_string()));
}

/// The active host's client, or a toast saying there is none.
pub(crate) fn client_or_toast() -> Option<DaemonClient> {
    let c = crate::state::get().conn.client();
    if c.is_none() {
        toast_err("Not connected", "Not connected to a host");
    }
    c
}

pub fn provider_label(p: &str) -> String {
    match p {
        "claude" => "Claude".into(),
        "codex" => "Codex".into(),
        "gemini" => "Gemini".into(),
        "opencode" => "OpenCode".into(),
        "copilot" => "Copilot".into(),
        "cursor" => "Cursor".into(),
        "amp" => "Amp".into(),
        other => {
            let mut c = other.chars();
            c.next()
                .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
                .unwrap_or_default()
        }
    }
}

fn bucket_text(b: Bucket) -> &'static str {
    match b {
        Bucket::Needs => "Needs you",
        Bucket::Failed => "Failed",
        Bucket::Review => "Ready to review",
        Bucket::Working => "Working",
        Bucket::Idle => "Idle",
    }
}

/// What the agent is doing now, from the last timeline row.
fn activity(last: Option<&Entry>, waiting: bool) -> String {
    if waiting {
        return "Waiting for you".into();
    }
    match last {
        Some(e) if e.kind() == "tool_call" && e.str("status") == Some("running") => {
            let d = e
                .item
                .get("detail")
                .and_then(|d| d.get("type"))
                .and_then(Value::as_str);
            match d {
                Some("shell") => "Running a command".into(),
                Some("read") => "Reading files".into(),
                Some("edit") => "Editing".into(),
                Some("write") => "Writing".into(),
                Some("search") => "Searching".into(),
                Some("fetch") => "Fetching".into(),
                Some("sub_agent") => "Running a subagent".into(),
                _ => format!("Using {}", e.str("name").unwrap_or("a tool")),
            }
        }
        Some(e) if e.kind() == "assistant_message" => "Writing".into(),
        _ => "Thinking".into(),
    }
}

/// The open session's chat. `agent_id` is on the active host.
#[component]
pub fn Chat(
    agent_id: String,
    #[prop(optional_no_strip)] on_back: Option<Callback<()>>,
) -> impl IntoView {
    let app = crate::state::get();
    let host = app.hosts.active_id.get_untracked().unwrap_or_default();
    let tl = timeline::get(&host, &agent_id);
    let id = StoredValue::new(agent_id.clone());

    let session = {
        let h = host.clone();
        Memo::new(move |_| app.agents.get(&h, &id.get_value()))
    };
    let online = Memo::new(move |_| app.conn.active_link().conn == Conn::Online);
    let provider = Memo::new(move |_| {
        session
            .get()
            .map(|s| provider_label(&s.agent.provider))
            .unwrap_or_default()
    });
    let running = Memo::new(move |_| session.get().is_some_and(|s| s.agent.status == "running"));
    let perms = Memo::new(move |_| {
        session
            .get()
            .map(|s| s.agent.pending_permissions)
            .unwrap_or_default()
    });
    let work = subwork::SubWork::new();

    // Subscribe and fetch the tail whenever the host is (back) online; drop the listeners on
    // close or before the next connection's.
    let listeners = StoredValue::new_local(None::<(DaemonClient, u64, u64)>);
    let drop_listeners = move || {
        if let Some((c, a, b)) = listeners.try_update_value(Option::take).flatten() {
            c.unsubscribe(a);
            c.unsubscribe(b);
        }
    };
    {
        let tl = tl.clone();
        let host = host.clone();
        Effect::new(move |_| {
            let on = online.get();
            drop_listeners();
            if !on {
                return;
            }
            let Some(client) = app.conn.client() else {
                return;
            };
            let agent = id.get_value();
            let a = timeline::listen(&client, tl.clone(), agent.clone());
            let b = subwork::listen(&client, host.clone(), agent.clone(), work);
            listeners.set_value(Some((client.clone(), a, b)));
            work.load(&client, &agent);
            spawn_local(timeline::open(client, tl.clone(), agent));
        });
    }
    on_cleanup(drop_listeners);
    // Opening a session clears its "needs review" mark.
    Effect::new(move |_| {
        let Some(s) = session.get() else { return };
        if s.agent.requires_attention == Some(true) && online.get() {
            if let Some(c) = app.conn.client() {
                let ids = vec![s.agent.id.clone()];
                spawn_local(async move {
                    let _ = c.clear_agent_attention(&ids).await;
                });
            }
        }
    });

    // Windowing: the newest `window` rows render; older ones wait behind "Show earlier".
    let window = RwSignal::new(WINDOW);
    let rows = tl.rows.clone();
    let visible = Signal::derive(move || {
        let w = window.get();
        rows.with(|r| r[r.len().saturating_sub(w)..].to_vec())
    });
    let rows = tl.rows.clone();
    let hidden = move || rows.with(Vec::len).saturating_sub(window.get());
    let rows = tl.rows.clone();
    let last_key = Memo::new(move |_| rows.with(|r| r.last().map(|x| x.uid)));

    // Bottom anchoring: follow new content while pinned; keep the view still when rows are
    // added above.
    let scroller = NodeRef::<leptos::html::Div>::new();
    let pinned = StoredValue::new(true);
    let restore_from_bottom = StoredValue::new(None::<i32>);
    let on_scroll = move |_| {
        if let Some(el) = scroller.get_untracked() {
            let gap = el.scroll_height() - el.scroll_top() - el.client_height();
            pinned.set_value(gap < PIN_PX);
        }
    };
    let keep_place = move || {
        if let Some(el) = scroller.get_untracked() {
            restore_from_bottom.set_value(Some(el.scroll_height() - el.scroll_top()));
        }
    };
    {
        let tick = tl.tick.clone();
        Effect::new(move |_| {
            tick.track();
            window.track();
            perms.track();
            running.track();
            request_animation_frame(move || {
                let Some(el) = scroller.get_untracked() else {
                    return;
                };
                if let Some(from_bottom) =
                    restore_from_bottom.try_update_value(Option::take).flatten()
                {
                    el.set_scroll_top(el.scroll_height() - from_bottom);
                } else if pinned.get_value() {
                    el.set_scroll_top(el.scroll_height());
                }
            });
        });
    }
    let show_earlier = {
        let tl = tl.clone();
        move || {
            keep_place();
            let total = tl.rows.with_untracked(Vec::len);
            if total > window.get_untracked() {
                window.update(|w| *w += WINDOW_STEP);
            } else if let Some(c) = app.conn.client() {
                window.update(|w| *w += timeline::PAGE_LIMIT as usize);
                timeline::load_older(c, tl.clone(), id.get_value());
            }
        }
    };
    let has_older = tl.has_older.clone();
    let loading_older = tl.loading_older.clone();
    let can_show_earlier = move || hidden() > 0 || has_older.get();

    let loaded = tl.loaded.clone();
    let rows = tl.rows.clone();
    let error = tl.error.clone();
    let empty_note = move || {
        (loaded.get() && rows.with(Vec::is_empty) && !running.get()).then(|| {
            view! { <div class="tl-empty t-label">"no messages yet · say what to do below"</div> }
        })
    };
    let loaded = tl.loaded.clone();
    let loading = move || {
        (!loaded.get()).then(|| {
            let text = if online.get() {
                "loading the conversation"
            } else {
                "connecting to the host"
            };
            view! {
                <div class="tl-loading">
                    <span class="t-label m-shimmer-text">{text}</span>
                    <div class="skel-row"></div>
                    <div class="skel-row short"></div>
                </div>
            }
        })
    };
    let rows = tl.rows.clone();
    let thinking = move || {
        (running.get() && online.get()).then(|| {
            let waiting = !perms.with(Vec::is_empty);
            let last = rows.with(|r| r.last().map(|x| x.entry.get()));
            let text = activity(last.as_ref(), waiting);
            view! {
                <div class="tl-thinking">
                    <StatusGlyph bucket=if waiting { Bucket::Needs } else { Bucket::Working } size=8.0 />
                    <span class=if waiting { "t-mono tl-waiting" } else { "t-mono m-shimmer-text" }>{text}</span>
                </div>
            }
        })
    };
    let last_error = move || {
        session.get().and_then(|s| {
            (s.agent.status == "error")
                .then(|| {
                    s.agent
                        .raw
                        .get("lastError")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
                .flatten()
        })
    };

    let phone = app.viewport.form_factor.get_untracked() == crate::theme::layout::FormFactor::Phone;
    let host_for_detail = host.clone();
    view! {
        <div class="chat" class:phone=phone>
            <ChatHead session=session on_back=on_back />
            {move || match work.detail.get() {
                Some(sub) => view! {
                    <subwork::SubWorkDetail
                        host=host_for_detail.clone()
                        parent=id.get_value()
                        id=sub
                        work=work
                        provider=provider
                    />
                }
                .into_any(),
                None => ().into_any(),
            }}
            <div class="chat-main" class:hidden=move || work.detail.with(Option::is_some)>
                <subwork::SubWorkStrip work=work />
                <div class="chat-scroll" node_ref=scroller on:scroll=on_scroll>
                    <div class="chat-body">
                        <Show when=can_show_earlier.clone()>
                            <button class="tl-earlier t-mono" on:click={
                                let f = show_earlier.clone();
                                move |_| f()
                            }>
                                {
                                    let loading_older = loading_older.clone();
                                    move || if loading_older.get() { "Loading…".to_owned() } else { "Show earlier messages".to_owned() }
                                }
                            </button>
                        </Show>
                        {loading}
                        {move || error.get().map(|e| view! { <div class="tl-error t-mono">{format!("Could not load the conversation: {e}")}</div> })}
                        {empty_note}
                        <For
                            each=move || visible.get()
                            key=|r| r.uid
                            children=move |r| {
                                let uid = r.uid;
                                let streaming = Signal::derive(move || {
                                    running.get() && last_key.get() == Some(uid)
                                });
                                view! { <TimelineItem entry=r.entry provider=provider streaming=streaming /> }
                            }
                        />
                        {move || {
                            let mode = session.get().and_then(|s| {
                                let cur = s.agent.raw.get("currentModeId")?.as_str()?.to_owned();
                                s.agent.raw.get("availableModes")?.as_array()?.iter()
                                    .find(|m| m.get("id").and_then(Value::as_str) == Some(cur.as_str()))?
                                    .get("label")?.as_str().map(str::to_owned)
                            });
                            perms
                                .get()
                                .into_iter()
                                .map(|p| {
                                    let mode = mode.clone();
                                    match mode {
                                        Some(m) => view! { <PermissionCard agent_id=id.get_value() p=p mode=m /> }.into_any(),
                                        None => view! { <PermissionCard agent_id=id.get_value() p=p /> }.into_any(),
                                    }
                                })
                                .collect_view()
                        }}
                        {move || last_error().map(|e| view! {
                            <div class="tl-state cut cut-stroke" style="--c:8px">
                                <StatusGlyph bucket=Bucket::Failed size=7.0 />
                                <span>{e}</span>
                            </div>
                        })}
                        {thinking}
                    </div>
                </div>
                <div class="chat-composer">
                    <Composer
                        agent_id=agent_id.clone()
                        session=session
                        online=online
                        provider=provider
                        compact=phone
                    />
                </div>
            </div>
        </div>
    }
}

#[component]
fn ChatHead(
    session: Memo<Option<crate::state::Session>>,
    on_back: Option<Callback<()>>,
) -> impl IntoView {
    let app = crate::state::get();
    let crumb = move || {
        session.get().map(|s| {
            let branch = s
                .project
                .as_ref()
                .filter(|p| p.checkout.get("isGit").and_then(Value::as_bool) == Some(true))
                .and_then(|p| p.checkout.get("currentBranch").and_then(Value::as_str))
                .map(str::to_owned);
            [s.project.as_ref().map(|p| p.project_name.clone()), branch]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" / ")
        })
    };
    let parent = move || {
        let s = session.get()?;
        let pid = s
            .agent
            .raw
            .get("labels")
            .and_then(|l| l.get(PARENT_LABEL))
            .and_then(Value::as_str)?
            .to_owned();
        let host = app.active_host()?;
        let title = app.agents.get(&host, &pid)?.agent.title_or_untitled();
        Some(view! {
            <button class="chat-parent" on:click=move |_| app.ui.select(Some(pid.clone()))>
                <Icon ico=Ico::CornerLeftUp size=11.0 />
                <span>{format!("Subagent of {title}")}</span>
            </button>
        })
    };
    let bucket = Memo::new(move |_| {
        session
            .get()
            .map(|s| bucket_of(&s.agent))
            .unwrap_or(Bucket::Idle)
    });
    view! {
        <div class="chat-head">
            <div class="chat-crumbs">
                <span class="t-mono chat-crumb">{crumb}</span>
                {parent}
            </div>
            <div class="chat-title-row">
                {on_back.map(|b| view! {
                    <button class="icon-btn" aria-label="Back" on:click=move |_| b.run(())>
                        <Icon ico=Ico::ArrowLeft size=18.0 />
                    </button>
                })}
                <span class="t-display chat-title">
                    {move || session.get().map(|s| s.agent.title_or_untitled()).unwrap_or_else(|| "Session".into())}
                </span>
            </div>
            <div class="chat-sub">
                <StatusGlyph bucket=bucket size=7.0 />
                <span class=move || format!("chat-bucket b-{}", bucket.get().id())>{move || bucket_text(bucket.get())}</span>
                <span class="faint">"·"</span>
                <span class="chat-sub-t">{move || session.get().map(|s| provider_label(&s.agent.provider))}</span>
                {move || session.get().map(|s| s.agent.model_label()).filter(|m| m != "default").map(|m| view! {
                    <span class="faint">"·"</span>
                    <span class="chat-sub-t">{m}</span>
                })}
            </div>
        </div>
    }
}
