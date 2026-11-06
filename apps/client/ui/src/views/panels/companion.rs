//! Companion (ui-next `CompanionPanel.tsx`): the host companion's notebook of topics and tasks,
//! kept live, and a text line to it.

use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::Value;

use crate::components::{Ico, Icon, StatusGlyph};
use crate::shell::panel_head::{GroupHead, PanelHead};
use crate::state::checkout::online;
use crate::state::Bucket;
use crate::state::{self};

#[derive(Clone, PartialEq)]
struct Line {
    you: bool,
    text: String,
    id: u64,
}

fn bucket_of(status: &str) -> Bucket {
    match status {
        "done" => Bucket::Review,
        "active" => Bucket::Working,
        _ => Bucket::Idle,
    }
}

#[component]
pub fn CompanionPanel() -> impl IntoView {
    let app = state::get();
    let notebook = RwSignal::new(None::<Vec<Value>>);
    let lines = RwSignal::new(Vec::<Line>::new());
    let error = RwSignal::new(None::<String>);
    let seq = StoredValue::new(0u64);
    let draft = RwSignal::new(String::new());
    let push = move |you: bool, text: String| {
        seq.update_value(|s| *s += 1);
        let id = seq.get_value();
        lines.update(|l| l.push(Line { you, text, id }));
    };
    Effect::new(move |_| {
        app.hosts.active_id.track();
        if !online() {
            return;
        }
        let Some(c) = app.conn.client() else { return };
        notebook.set(None);
        lines.set(Vec::new());
        error.set(None);
        let c2 = c.clone();
        spawn_local(async move {
            match c2.fetch_companion_notebook().await {
                Ok(n) => notebook.set(Some(
                    serde_json::to_value(n)
                        .ok()
                        .and_then(|v| v["entries"].as_array().cloned())
                        .unwrap_or_default(),
                )),
                Err(e) => error.set(Some(e.to_string())),
            }
        });
        let id = c.subscribe(move |e| {
            let frogg_client_core::Event::Session(f) = e else {
                return;
            };
            match f.kind.as_str() {
                "companion.notebook.update" => {
                    if let Ok(p) = f.payload::<Value>() {
                        notebook.set(Some(
                            p["notebook"]["entries"]
                                .as_array()
                                .cloned()
                                .unwrap_or_default(),
                        ));
                    }
                }
                "companion.reply" => {
                    if let Ok(p) = f.payload::<Value>() {
                        if p["isFinal"] == true {
                            push(false, p["text"].as_str().unwrap_or_default().to_owned());
                        }
                    }
                }
                _ => {}
            }
        });
        let c = leptos::__reexports::send_wrapper::SendWrapper::new(c);
        on_cleanup(move || c.unsubscribe(id));
    });
    let input = NodeRef::<leptos::html::Textarea>::new();
    // Autosize to the text, up to a cap, like the session composer.
    let fit = move || {
        if let Some(el) = input.get_untracked() {
            let style = web_sys::HtmlElement::style(&el);
            let _ = style.set_property("height", "auto");
            let h = el.scroll_height().min(160);
            let _ = style.set_property("height", &format!("{h}px"));
        }
    };
    let send = move || {
        let text = draft.get_untracked().trim().to_owned();
        if text.is_empty() {
            return;
        }
        let Some(c) = app.conn.client().filter(|_| online()) else {
            error.set(Some("Host is not connected.".into()));
            return;
        };
        error.set(None);
        draft.set(String::new());
        fit();
        push(true, text.clone());
        spawn_local(async move {
            if let Err(e) = c.send_companion_message(&text).await {
                error.set(Some(e.to_string()));
            }
        });
    };
    view! {
        <div class="panel pn">
            <PanelHead title="Companion" />
            <div class="panel-scroll">
                <GroupHead label="Notebook" count=Signal::derive(move || notebook.with(|n| n.as_ref().map(|n| n.len()).unwrap_or(0))) />
                {move || (notebook.with(|n| n.is_none()) && error.with(|e| e.is_none())).then(|| view! { <div class="pn-sub pn-lh">"Loading notebook…"</div> })}
                {move || notebook.with(|n| n.as_ref().is_some_and(|n| n.is_empty())).then(|| view! {
                    <div class="pn-sub pn-lh pn-wrap">
                        "Talk to the companion about your work; it keeps topics and tasks here and can start agents for them."
                    </div>
                })}
                {move || notebook.get().unwrap_or_default().into_iter().map(|e| {
                    let status = e["status"].as_str().unwrap_or_default().to_owned();
                    view! {
                        <div class="pn-entry">
                            <span class="pn-entry-glyph"><StatusGlyph bucket=bucket_of(&status) size=8.0 /></span>
                            <span class="pn-entry-text" class:done=status == "done">{e["text"].as_str().unwrap_or_default().to_owned()}</span>
                            <span class="t-mono pn-small faint">{e["kind"].as_str().unwrap_or_default().to_owned()}</span>
                        </div>
                    }
                }).collect_view()}
                {move || (!lines.with(|l| l.is_empty())).then(|| view! { <GroupHead label="Conversation" /> })}
                <For each=move || lines.get() key=|l| l.id let:l>
                    <div class=if l.you { "pn-bubble you cut flip" } else { "pn-bubble cut" } style="--c:8px">
                        <div class="pn-who">
                            {(!l.you).then(|| view! { <Icon ico=Ico::Bot size=12.0 class="cyan2" /> })}
                            <span class="t-label">{if l.you { "you" } else { "companion" }}</span>
                        </div>
                        <span class="pn-line-body">{l.text}</span>
                    </div>
                </For>
                {move || error.get().map(|e| view! { <div class="pn-error t-mono">{e}</div> })}
            </div>
            // The compact composer's look (ui-next passes `compact` and no chips): the same box,
            // input and send button as a session's composer, without agent controls.
            <div class="pn-companion-composer">
                <div class="composer compact">
                    <div class="composer-box cut cut-stroke" style="--c:10px">
                        <textarea
                            class="composer-input"
                            node_ref=input
                            rows="1"
                            aria-label="Message the companion"
                            placeholder="Tell the companion…"
                            prop:value=move || draft.get()
                            on:input=move |e| {
                                draft.set(event_target_value(&e));
                                fit();
                            }
                            on:keydown=move |e: web_sys::KeyboardEvent| {
                                if e.key() == "Enter" && !e.shift_key() && !e.is_composing() {
                                    e.prevent_default();
                                    send();
                                }
                            }
                        ></textarea>
                        <div class="composer-bar">
                            <span class="spacer"></span>
                            {move || {
                                let idle = draft.with(|d| d.trim().is_empty()) || !online();
                                view! {
                                    <button
                                        class="send cut"
                                        class:idle=idle
                                        style="--c:6px"
                                        aria-label="Send"
                                        title="Send"
                                        disabled=idle
                                        on:click=move |_| send()
                                    >
                                        <Icon ico=Ico::ArrowUp size=16.0 stroke=2.2 />
                                    </button>
                                }
                            }}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    }
}
