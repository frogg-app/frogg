//! Inbox (ui-next `Inbox.tsx`): sessions that need you, failed or finished, with unread marks
//! and mark-all-read; the detail shows the pending permissions (approve / deny in place), the
//! failure and the last reply, and opens the session.

use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::Value;

use super::menus::toast_err;
use crate::components::{Brackets, Button, ButtonKind, Ico, Icon, StatusGlyph};
use crate::shell::panel_head::{GroupHead, PanelHead};
use crate::state::projects;
use crate::state::sessions::{ago, parse_ms, provider_label, SessionExt};
use crate::state::{bucket_of, Bucket, Session, Tool};

const GROUPS: [(Bucket, &str); 3] = [
    (Bucket::Needs, "Needs you"),
    (Bucket::Failed, "Failures"),
    (Bucket::Review, "Finished"),
];

fn summary(s: &Session) -> String {
    if let Some(p) = s.first_permission() {
        if p.get("kind").and_then(Value::as_str) == Some("plan") {
            return "Plan ready for review".into();
        }
        let what = p
            .get("title")
            .and_then(Value::as_str)
            .or_else(|| p.get("name").and_then(Value::as_str))
            .unwrap_or("a tool");
        return format!("{} wants to run {what}", provider_label(&s.agent.provider));
    }
    s.last_error()
        .unwrap_or_else(|| "Finished · ready to review".into())
}

fn bucketed(b: Bucket) -> Vec<Session> {
    let mut v: Vec<Session> = crate::state::get()
        .sessions()
        .into_iter()
        .filter(|s| bucket_of(&s.agent) == b)
        .collect();
    v.sort_by(|a, b| parse_ms(&b.agent.updated_at).total_cmp(&parse_ms(&a.agent.updated_at)));
    v
}

#[component]
pub fn InboxPanel() -> impl IntoView {
    let app = crate::state::get();
    let err = RwSignal::new(None::<String>);
    let total = move || {
        GROUPS
            .iter()
            .map(|(b, _)| bucketed(*b).len())
            .sum::<usize>()
    };
    let clear_all = move |_| {
        let ids: Vec<String> = GROUPS
            .iter()
            .flat_map(|(b, _)| bucketed(*b))
            .map(|s| s.agent.id)
            .collect();
        err.set(None);
        spawn_local(async move {
            if let Err(e) = projects::clear_attention(ids).await {
                err.set(Some(e));
            }
        });
    };
    view! {
        <div class="panel inbox">
            <PanelHead title="Inbox">
                <button class="icon-btn" aria-label="Mark all read" on:click=clear_all>
                    <Icon ico=Ico::CheckCheck size=15.0 />
                </button>
            </PanelHead>
            {move || err.get().map(|e| view! { <span class="t-mono sheet-err pad">{e}</span> })}
            <div class="panel-scroll">
                <Show when=move || total() == 0>
                    <span class="t-label inbox-empty">"nothing needs you"</span>
                </Show>
                {GROUPS
                    .iter()
                    .map(|(b, label)| {
                        let b = *b;
                        let list = Memo::new(move |_| bucketed(b));
                        view! {
                            <Show when=move || list.with(|l| !l.is_empty())>
                                <GroupHead label=*label count=Signal::derive(move || list.with(Vec::len)) />
                                <For
                                    each=move || list.get()
                                    key=|s| s.agent.id.clone()
                                    children=move |s| {
                                        let id = s.agent.id.clone();
                                        let id2 = id.clone();
                                        let live = Memo::new(move |_| {
                                            list.with(|l| l.iter().find(|x| x.agent.id == id2).cloned())
                                        });
                                        let s = StoredValue::new(s);
                                        let cur = move || live.get().unwrap_or_else(|| s.get_value());
                                        let id3 = id.clone();
                                        let on = Signal::derive(move || app.ui.inbox_id.get().as_deref() == Some(id3.as_str()));
                                        view! {
                                            <button class="srow2 inbox-row" class:on=move || on.get() on:click=move |_| app.ui.open_inbox(Some(id.clone()))>
                                                <Brackets on=on />
                                                <div class="srow2-top">
                                                    <span class="srow2-glyph"><StatusGlyph bucket=b /></span>
                                                    <span class="srow2-title strong">{move || cur().agent.title_or_untitled()}</span>
                                                    <span class="t-mono srow2-time">{move || ago(&cur().attention_at())}</span>
                                                    <Show when=move || cur().agent.requires_attention == Some(true)>
                                                        <span class="unread-dot"></span>
                                                    </Show>
                                                </div>
                                                <span class="t-mono inbox-summary">{move || summary(&cur())}</span>
                                            </button>
                                        }
                                    }
                                />
                            </Show>
                        }
                    })
                    .collect_view()}
            </div>
            <span class="t-mono inbox-foot">"Session approvals, failures, finished work and past toasts"</span>
        </div>
    }
}

#[component]
pub fn InboxDetail(
    id: String,
    #[prop(optional_no_strip)] on_back: Option<Callback<()>>,
) -> impl IntoView {
    let app = crate::state::get();
    let id = StoredValue::new(id);
    let s = Memo::new(move |_| {
        let host = app.active_host()?;
        app.agents.get(&host, &id.get_value())
    });
    let reply = RwSignal::new(None::<Option<String>>);
    // The last assistant reply, for context.
    Effect::new(move |_| {
        let agent = id.get_value();
        reply.set(None);
        let Ok(c) = projects::need() else { return };
        spawn_local(async move {
            let opts = frogg_client_core::FetchAgentTimelineOptions {
                direction: Some("tail".into()),
                limit: Some(40),
                ..Default::default()
            };
            let text = match c.fetch_agent_timeline(&agent, opts).await {
                Ok(r) => serde_json::to_value(&r).ok().and_then(|v| {
                    v["entries"].as_array().and_then(|es| {
                        es.iter().rev().find_map(|e| {
                            (e["item"]["type"].as_str() == Some("assistant_message"))
                                .then(|| e["item"]["text"].as_str().map(str::to_owned))
                                .flatten()
                        })
                    })
                }),
                Err(_) => None,
            };
            reply.set(Some(text));
        });
    });
    let open = move || {
        app.ui.set_tool(Tool::Sessions);
        app.ui.select(Some(id.get_value()));
    };
    view! {
        <div class="detail inbox-detail">
            {move || {
                let Some(s) = s.get() else {
                    return view! { <div></div> }.into_any();
                };
                let a = s.agent.clone();
                let bucket = bucket_of(&a);
                let place = [s.project.as_ref().map(|p| p.project_name.clone()), s.branch()]
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join(" / ");
                let perms = a.pending_permissions.clone();
                let error = s.last_error();
                view! {
                    <div class="inbox-head">
                        <div class="inbox-head-main">
                            <span class="t-label">
                                {format!("notification · {} ago · from {}", ago(&s.attention_at()), provider_label(&a.provider))}
                            </span>
                            <div class="inbox-title-row">
                                {on_back.map(|b| view! {
                                    <button class="icon-btn" aria-label="Back" on:click=move |_| b.run(())>
                                        <Icon ico=Ico::ChevronLeft size=18.0 />
                                    </button>
                                })}
                                <span class="t-display inbox-display">{a.title_or_untitled()}</span>
                            </div>
                            <div class="inbox-meta">
                                <StatusGlyph bucket=bucket size=7.0 />
                                <span>{place}</span>
                            </div>
                        </div>
                        <Button label="Open session" icon=Ico::ExternalLink on_press=Callback::new(move |_| open()) />
                    </div>
                    <div class="inbox-body">
                        {perms
                            .into_iter()
                            .map(|p| {
                                let pid = p.get("id").and_then(Value::as_str).unwrap_or("").to_owned();
                                let pid2 = pid.clone();
                                let aid = a.id.clone();
                                let aid2 = a.id.clone();
                                let kind = p.get("kind").and_then(Value::as_str).unwrap_or("tool").to_owned();
                                let title = p
                                    .get("title")
                                    .and_then(Value::as_str)
                                    .or_else(|| p.get("name").and_then(Value::as_str))
                                    .unwrap_or("Permission")
                                    .to_owned();
                                let detail = p
                                    .get("description")
                                    .and_then(Value::as_str)
                                    .map(str::to_owned)
                                    .or_else(|| p.get("input").map(|i| serde_json::to_string_pretty(i).unwrap_or_default()))
                                    .unwrap_or_default();
                                let simple = kind != "plan" && kind != "question";
                                view! {
                                    <div class="inbox-box perm cut cut-stroke flip" style="--c:10px">
                                        <span class="inbox-box-head amber">{if kind == "plan" { "Plan ready".to_string() } else { title }}</span>
                                        <pre class="t-mono inbox-pre">{detail}</pre>
                                        <div class="inbox-actions">
                                            {if simple {
                                                view! {
                                                    <Button label="Approve" kind=ButtonKind::Primary kbd="A" on_press=Callback::new(move |_| {
                                                        if let Err(e) = projects::answer_permission(&aid, &pid, true) { toast_err(e) }
                                                    }) />
                                                    <Button label="Deny" on_press=Callback::new(move |_| {
                                                        if let Err(e) = projects::answer_permission(&aid2, &pid2, false) { toast_err(e) }
                                                    }) />
                                                }
                                                .into_any()
                                            } else {
                                                view! { <Button label="Open to answer" kind=ButtonKind::Primary on_press=Callback::new(move |_| open()) /> }.into_any()
                                            }}
                                        </div>
                                    </div>
                                }
                            })
                            .collect_view()}
                        {error.map(|e| view! {
                            <div class="inbox-box fail cut cut-stroke flip" style="--c:10px">
                                <span class="inbox-box-head coral">"Failed"</span>
                                <span class="t-mono inbox-fail">{e}</span>
                                <div class="inbox-actions">
                                    <Button label="Open and retry" kind=ButtonKind::Primary on_press=Callback::new(move |_| open()) />
                                </div>
                            </div>
                        })}
                        <div class="inbox-box cut cut-stroke" style="--c:10px">
                            <span class="inbox-box-head">"Context"</span>
                            {move || match reply.get() {
                                None => view! { <span class="faint">"Loading…"</span> }.into_any(),
                                Some(None) => view! { <span class="faint">"No reply yet."</span> }.into_any(),
                                Some(Some(t)) => {
                                    let tail: String = {
                                        let chars: Vec<char> = t.chars().collect();
                                        chars[chars.len().saturating_sub(900)..].iter().collect()
                                    };
                                    view! { <div class="inbox-ctx"><frogg_render::Markdown text=tail /></div> }.into_any()
                                }
                            }}
                        </div>
                    </div>
                }
                .into_any()
            }}
        </div>
    }
}
