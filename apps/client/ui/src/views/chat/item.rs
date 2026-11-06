//! One timeline row (ui-next `chat/TimelineItem.tsx`, `chat/UserMessage.tsx`): a user bubble, an
//! assistant reply in markdown, reasoning, a tool call, a todo list, an error or a compaction.

use frogg_render::Markdown;
use leptos::prelude::*;
use serde_json::Value;

use super::relay::{parse_relay, resolve_sender, split_images, Piece, Relay};
use super::tool::ToolCall;
use crate::components::{Ico, Icon};
use crate::state::timeline::{sent, Entry};

/// Links in rendered markdown open outside the app.
pub fn on_link() -> Callback<String> {
    Callback::new(|href: String| crate::native::open_external(&href))
}

#[component]
pub fn TimelineItem(
    entry: ArcRwSignal<Entry>,
    #[prop(into)] provider: Signal<String>,
    /// The last row while the turn runs: the reply shows a live caret.
    #[prop(into)]
    streaming: Signal<bool>,
) -> impl IntoView {
    // The row's kind never changes; its content does (streamed text, a tool call settling).
    let kind = entry.with_untracked(|e| e.kind().to_owned());
    let e = entry.clone();
    let text = Signal::derive(move || e.with(|e| e.text().to_owned()));
    match kind.as_str() {
        "user_message" => {
            let message_id = entry.with_untracked(|e| e.str("messageId").map(str::to_owned));
            view! { <UserMessage text=text message_id=message_id /> }.into_any()
        }
        "assistant_message" => view! {
            <div class="tl-reply m-enter">
                <div class="tl-reply-head">
                    <span class="tl-diamond"></span>
                    <span class="tl-who">{move || provider.get()}</span>
                </div>
                <div class="tl-reply-body" class:streaming=move || streaming.get()>
                    <Markdown text=text on_link=on_link() />
                </div>
            </div>
        }
        .into_any(),
        "reasoning" => {
            let open = RwSignal::new(false);
            view! {
                <button
                    class="tl-reasoning"
                    class:open=move || open.get()
                    aria-expanded=move || open.get().to_string()
                    on:click=move |_| open.update(|o| *o = !*o)
                >
                    {move || text.get()}
                </button>
            }
            .into_any()
        }
        "tool_call" => view! { <ToolCall entry=entry /> }.into_any(),
        "todo" => {
            let items = Signal::derive(move || {
                entry.with(|e| {
                    e.item
                        .get("items")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default()
                })
            });
            view! { <TodoList items=items /> }.into_any()
        }
        "error" => {
            let msg = move || entry.with(|e| e.str("message").unwrap_or("").to_owned());
            view! { <div class="tl-error t-mono">{msg}</div> }.into_any()
        }
        "compaction" => {
            let label = move || {
                entry.with(|e| {
                    let item = &e.item;
                    if item.get("cleanCut").is_some_and(|c| !c.is_null()) {
                        "Clean cut · a fresh conversation, primed with a summary".to_owned()
                    } else if item.get("status").and_then(Value::as_str) == Some("loading") {
                        "Compacting the conversation…".to_owned()
                    } else {
                        let tokens = item
                            .get("preTokens")
                            .and_then(Value::as_f64)
                            .map(|t| format!(" · {}k tokens before", (t / 1000.0).round()))
                            .unwrap_or_default();
                        format!("Conversation compacted{tokens}")
                    }
                })
            };
            view! {
                <div class="tl-compaction">
                    <span class="tl-compaction-line"></span>
                    <span class="t-label">{label}</span>
                    <span class="tl-compaction-line"></span>
                </div>
            }
            .into_any()
        }
        _ => ().into_any(),
    }
}

/// A user turn: the user's own bubble, or a message relayed from another agent.
#[component]
fn UserMessage(#[prop(into)] text: Signal<String>, message_id: Option<String>) -> impl IntoView {
    let relay = Memo::new(move |_| text.with(|t| parse_relay(t)));
    let message_id = StoredValue::new(message_id);
    move || match relay.get() {
        Some(r) => view! { <RelayMessage relay=r /> }.into_any(),
        None => view! { <UserBubble text=text message_id=message_id.get_value() /> }.into_any(),
    }
}

/// The user's own turn: plain text (line breaks kept), right-aligned, cyan edge. Images written
/// into the text as markdown render inline; what this device attached shows under the text,
/// pictures first, the rest (and pictures after a reload) as name chips.
#[component]
fn UserBubble(#[prop(into)] text: Signal<String>, message_id: Option<String>) -> impl IntoView {
    let message_id = StoredValue::new(message_id);
    let sent = Memo::new(move |_| {
        message_id
            .get_value()
            .map(|id| sent::of(&id))
            .unwrap_or_default()
    });
    let pieces = Memo::new(move |_| text.with(|t| split_images(t)));
    let wide = move || {
        pieces.with(|p| p.iter().any(|x| matches!(x, Piece::Img { .. })))
            || sent.with(|s| s.iter().any(|x| x.uri.is_some()))
    };
    view! {
        <div class="tl-user m-enter" class:wide=wide>
            {move || {
                let wide = wide();
                pieces
                    .get()
                    .into_iter()
                    .map(|p| match p {
                        Piece::Text(t) => {
                            let t = if wide { t.trim().to_owned() } else { t };
                            (!t.trim().is_empty())
                                .then(|| view! { <span class="tl-user-t">{t}</span> })
                                .into_any()
                        }
                        Piece::Img { alt, src } => {
                            match frogg_render::markdown::resolve_image(&src, None) {
                                Some(frogg_render::markdown::ImageSource::Uri(u)) => {
                                    view! { <img class="tl-user-img" src=u alt=alt /> }.into_any()
                                }
                                _ => view! {
                                    <span class="tl-user-chip t-mono" title=src>
                                        <Icon ico=Ico::Image size=12.0 />
                                        <span>{if alt.is_empty() { "image".to_owned() } else { alt }}</span>
                                    </span>
                                }
                                .into_any(),
                            }
                        }
                    })
                    .collect_view()
            }}
            {move || {
                sent.get()
                    .into_iter()
                    .filter_map(|x| x.uri.clone().map(|u| (u, x.name)))
                    .map(|(u, name)| view! { <img class="tl-user-img" src=u alt=name /> })
                    .collect_view()
            }}
            {move || {
                let chips: Vec<_> = sent.get().into_iter().filter(|x| x.uri.is_none()).collect();
                (!chips.is_empty()).then(|| view! {
                    <div class="tl-user-chips">
                        {chips
                            .into_iter()
                            .map(|x| view! {
                                <span class="tl-user-chip t-mono">
                                    <Icon ico=if x.kind == "image" { Ico::Image } else { Ico::Paperclip } size=12.0 />
                                    <span>{x.name}</span>
                                </span>
                            })
                            .collect_view()}
                    </div>
                })
            }}
        </div>
    }
}

/// Another agent talking to this one: sender chip (opens that session when it is known).
#[component]
fn RelayMessage(relay: Relay) -> impl IntoView {
    let app = crate::state::get();
    let short = relay.id.clone();
    let sender = Memo::new(move |_| {
        let ids: Vec<String> = app.sessions().into_iter().map(|s| s.agent.id).collect();
        resolve_sender(&short, ids.iter().map(String::as_str))
    });
    let open = move |_| {
        if let Some(id) = sender.get_untracked() {
            app.ui.select(Some(id));
        }
    };
    let label = format!("From the {} agent", relay.name);
    view! {
        <div class="tl-relay m-enter">
            <button
                class="tl-relay-from"
                class:link=move || sender.with(Option::is_some)
                disabled=move || sender.with(Option::is_none)
                aria-label=move || if sender.with(Option::is_some) { format!("{label}, open its session") } else { label.clone() }
                on:click=open
            >
                <Icon ico=Ico::Bot size=13.0 class="tl-relay-bot" />
                <span class="tl-relay-label">"From"</span>
                <span class="tl-relay-name">{relay.name.clone()}</span>
                <span class="tl-relay-id t-mono">{relay.id.clone()}</span>
                {relay.place.clone().map(|w| view! { <span class="tl-relay-where t-mono">{w}</span> })}
                {move || sender.with(Option::is_some).then(|| view! { <Icon ico=Ico::ArrowUpRight size=13.0 class="tl-relay-go" /> })}
            </button>
            <div class="tl-relay-body">
                <Markdown text=relay.body.clone() on_link=on_link() />
            </div>
        </div>
    }
}

#[component]
pub fn TodoList(#[prop(into)] items: Signal<Vec<Value>>) -> impl IntoView {
    view! {
        <div class="tl-todo">
            {move || {
                items
                    .get()
                    .into_iter()
                    .map(|t| {
                        let done = t.get("completed").and_then(Value::as_bool).unwrap_or(false)
                            || t.get("status").and_then(Value::as_str) == Some("completed");
                        let active = t.get("status").and_then(Value::as_str) == Some("in_progress");
                        let text = t
                            .get("text")
                            .or_else(|| t.get("content"))
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_owned();
                        view! {
                            <div class="tl-todo-row t-mono" class:done=done class:active=active>
                                <span class="tl-todo-box">
                                    {done.then(|| view! { <Icon ico=Ico::Check size=10.0 stroke=2.4 /> })}
                                </span>
                                <span>{text}</span>
                            </div>
                        }
                    })
                    .collect_view()
            }}
        </div>
    }
}
