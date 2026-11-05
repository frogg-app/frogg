//! Sub-work (ui-next `subwork/Strip.tsx`, `subwork/Detail.tsx`, `daemon/subwork.ts`, reduced to
//! provider subagents): a slim live strip under the chat header while subagents run, expanding to
//! the list; a row opens the subagent's own timeline in the chat pane.

use frogg_client_core::{DaemonClient, Event, SubagentTimelineOptions};
use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::Value;

use super::item::TimelineItem;
use crate::components::{Ico, Icon, StatusGlyph};
use crate::state::timeline::{self, Timeline};
use crate::state::Bucket;

#[derive(Debug, Clone, PartialEq)]
pub struct Sub {
    pub id: String,
    pub label: String,
    pub detail: Option<String>,
    /// `running` / `completed` / `failed` / `canceled`.
    pub status: String,
}

impl Sub {
    fn from_value(v: &Value) -> Option<Self> {
        let s = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_owned);
        let title = s("title").filter(|t| !t.trim().is_empty());
        let description = s("description");
        Some(Self {
            id: s("id")?,
            label: title
                .clone()
                .or(description.clone())
                .unwrap_or_else(|| "Subagent".into()),
            detail: if title.is_some() { description } else { None },
            status: s("status").unwrap_or_else(|| "running".into()),
        })
    }

    fn bucket(&self) -> Bucket {
        match self.status.as_str() {
            "running" => Bucket::Working,
            "failed" => Bucket::Failed,
            "completed" => Bucket::Review,
            _ => Bucket::Idle,
        }
    }
}

/// A session's subagents, kept live from the list call and `agent.provider_subagents.update`.
#[derive(Clone, Copy)]
pub struct SubWork {
    pub items: RwSignal<Vec<Sub>>,
    /// The subagent whose timeline fills the chat pane.
    pub detail: RwSignal<Option<String>>,
}

impl SubWork {
    pub fn new() -> Self {
        Self {
            items: RwSignal::new(Vec::new()),
            detail: RwSignal::new(None),
        }
    }

    pub fn load(&self, client: &DaemonClient, parent: &str) {
        if !client.has_feature("providerSubagents") {
            return;
        }
        let this = *self;
        let c = client.clone();
        let parent = parent.to_owned();
        spawn_local(async move {
            let Ok(r) = c.list_provider_subagents(&parent, None).await else {
                return;
            };
            let Ok(v) = serde_json::to_value(&r.subagents) else {
                return;
            };
            let list: Vec<Sub> = v
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Sub::from_value)
                .collect();
            let _ = this.items.try_set(list);
        });
    }

    /// Applies an `agent.provider_subagents.update` frame for `parent`; timeline rows go to the
    /// subagent's timeline when it is open.
    pub fn apply(&self, host: &str, parent: &str, p: &Value) {
        let kind = p.get("kind").and_then(Value::as_str);
        match kind {
            Some("upsert") => {
                let Some(sub) = p.get("subagent") else { return };
                if sub.get("parentAgentId").and_then(Value::as_str) != Some(parent) {
                    return;
                }
                let Some(s) = Sub::from_value(sub) else {
                    return;
                };
                self.items
                    .update(|l| match l.iter_mut().find(|x| x.id == s.id) {
                        Some(x) => *x = s,
                        None => l.push(s),
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
                    self.items.update(|l| l.retain(|x| x.id != id));
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
}

pub fn sub_timeline(host: &str, parent: &str, sub: &str) -> Timeline {
    timeline::get(host, &format!("sub:{parent}:{sub}"))
}

/// Routes subagent pushes of `parent` on this client into `work`.
pub fn listen(client: &DaemonClient, host: String, parent: String, work: SubWork) -> u64 {
    client.subscribe(move |event| {
        let Event::Session(frame) = event else { return };
        if frame.kind != "agent.provider_subagents.update" {
            return;
        }
        if let Ok(p) = frame.payload::<Value>() {
            work.apply(&host, &parent, &p);
        }
    })
}

#[component]
pub fn SubWorkStrip(work: SubWork) -> impl IntoView {
    let open = RwSignal::new(false);
    let running = Memo::new(move |_| {
        work.items
            .get()
            .into_iter()
            .filter(|s| s.status == "running")
            .collect::<Vec<_>>()
    });
    let visible = move || !work.items.with(Vec::is_empty);
    view! {
        <Show when=visible>
            <div class="subwork">
                <button class="subwork-bar" aria-expanded=move || open.get().to_string() on:click=move |_| open.update(|o| *o = !*o)>
                    <Show when=move || !running.with(Vec::is_empty)>
                        <span class="subwork-beam"></span>
                    </Show>
                    <span class="subwork-mark" class:live=move || !running.with(Vec::is_empty)></span>
                    {move || {
                        let r = running.get();
                        if r.is_empty() {
                            let n = work.items.with(Vec::len);
                            let failed = work.items.with(|l| l.iter().filter(|s| s.status == "failed").count());
                            let text = if failed > 0 {
                                format!("{failed} failed · {} finished", n - failed)
                            } else {
                                format!("{n} subagent{} finished", if n == 1 { "" } else { "s" })
                            };
                            view! { <span class="subwork-label" class:fail={failed > 0}>{text}</span> }.into_any()
                        } else {
                            let names: Vec<String> = r.iter().take(2).map(|s| s.label.clone()).collect();
                            let extra = r.len().saturating_sub(2);
                            view! {
                                <span class="subwork-n t-mono">{r.len()}</span>
                                <span class="subwork-label">"running"</span>
                                <span class="subwork-names">
                                    {names.join(", ")}
                                    {(extra > 0).then(|| format!(" +{extra}"))}
                                </span>
                            }
                            .into_any()
                        }
                    }}
                    <span class="spacer"></span>
                    <Icon ico=Ico::ChevronDown size=13.0 class="subwork-chev" />
                </button>
                <Show when=move || open.get()>
                    <div class="subwork-list m-enter">
                        <For
                            each=move || work.items.get()
                            key=|s| (s.id.clone(), s.status.clone(), s.label.clone())
                            children=move |s| {
                                let id = s.id.clone();
                                view! {
                                    <button class="subwork-row" on:click=move |_| work.detail.set(Some(id.clone()))>
                                        <StatusGlyph bucket=s.bucket() size=7.0 />
                                        <span class="subwork-row-label">{s.label.clone()}</span>
                                        {s.detail.clone().map(|d| view! { <span class="subwork-row-detail">{d}</span> })}
                                        <span class="spacer"></span>
                                        <Icon ico=Ico::ChevronRight size=12.0 class="faint" />
                                    </button>
                                }
                            }
                        />
                    </div>
                </Show>
            </div>
        </Show>
    }
}

/// A subagent's own timeline in the chat pane.
#[component]
pub fn SubWorkDetail(
    host: String,
    parent: String,
    id: String,
    work: SubWork,
    #[prop(into)] provider: Signal<String>,
) -> impl IntoView {
    let tl = sub_timeline(&host, &parent, &id);
    if let Some(c) = crate::state::get().conn.client() {
        let tl = tl.clone();
        let (parent, id) = (parent.clone(), id.clone());
        spawn_local(async move {
            let res = c
                .fetch_provider_subagent_timeline(
                    &parent,
                    &id,
                    SubagentTimelineOptions {
                        direction: Some("tail".into()),
                        limit: Some(200),
                        ..Default::default()
                    },
                )
                .await;
            match res.map(|r| serde_json::to_value(r).unwrap_or_default()) {
                Ok(v) => tl.reset_from(&v, "rows"),
                Err(e) => {
                    tl.error.set(Some(e.to_string()));
                    tl.loaded.set(true);
                }
            }
        });
    }
    let sid = id.clone();
    let sub = Memo::new(move |_| work.items.with(|l| l.iter().find(|s| s.id == sid).cloned()));
    let rows = tl.rows.clone();
    let loaded = tl.loaded.clone();
    let error = tl.error.clone();
    view! {
        <div class="subdetail">
            <div class="subdetail-head">
                <button class="icon-btn" aria-label="Back to the conversation" on:click=move |_| work.detail.set(None)>
                    <Icon ico=Ico::ArrowLeft size=16.0 />
                </button>
                {move || sub.get().map(|s| view! { <StatusGlyph bucket=s.bucket() size=7.0 /> })}
                <span class="subdetail-title">
                    {move || sub.get().map(|s| s.label).unwrap_or_else(|| "Subagent".into())}
                </span>
            </div>
            <div class="chat-scroll">
                <div class="chat-body">
                    {move || (!loaded.get()).then(|| view! { <div class="tl-loading t-label m-shimmer-text">"loading the subagent's activity"</div> })}
                    {move || error.get().map(|e| view! { <div class="tl-error t-mono">{e}</div> })}
                    <For
                        each=move || rows.get()
                        key=|r| r.uid
                        children=move |r| view! { <TimelineItem entry=r.entry provider=provider streaming=false /> }
                    />
                </div>
            </div>
        </div>
    }
}
