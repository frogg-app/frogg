//! One timeline row (ui-next `chat/TimelineItem.tsx`, `chat/UserMessage.tsx`): a user bubble, an
//! assistant reply in markdown, reasoning, a tool call, a todo list, an error or a compaction.

use frogg_render::Markdown;
use leptos::prelude::*;
use serde_json::Value;

use super::tool::ToolCall;
use crate::components::{Ico, Icon};
use crate::state::timeline::Entry;

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
        "user_message" => view! { <UserBubble text=text /> }.into_any(),
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

/// The user's own turn: plain text (line breaks kept), right-aligned, cyan edge.
#[component]
fn UserBubble(#[prop(into)] text: Signal<String>) -> impl IntoView {
    view! { <div class="tl-user m-enter">{move || text.get()}</div> }
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
