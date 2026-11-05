//! Search (ui-next `SearchPanel.tsx`): every session on the host, archived ones included, by
//! title, branch or project, as you type.

use std::time::Duration;

use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::{json, Value};

use super::util::ago;
use crate::components::{Ico, Icon, StatusGlyph};
use crate::shell::panel_head::{GroupHead, PanelHead};
use crate::state::{self, bucket_of, Session, Tool};

#[derive(Clone)]
struct Hit {
    session: Session,
    ranges: Vec<(usize, usize)>,
}

fn to_hit(e: &Value) -> Option<Hit> {
    let session = Session::from_entry(&e["agent"], e.get("project"))?;
    let ranges = e["searchMatches"]
        .as_array()
        .and_then(|m| m.iter().find(|m| m["field"] == "title"))
        .and_then(|m| m["ranges"].as_array())
        .map(|r| {
            r.iter()
                .filter_map(|r| {
                    Some((
                        r["start"].as_u64()? as usize,
                        r["length"].as_u64()? as usize,
                    ))
                })
                .collect()
        })
        .unwrap_or_default();
    Some(Hit { session, ranges })
}

#[component]
pub fn SearchPanel() -> impl IntoView {
    let app = state::get();
    let q = RwSignal::new(String::new());
    let hits = RwSignal::new(None::<Vec<Hit>>);
    let truncated = RwSignal::new(false);
    let error = RwSignal::new(None::<String>);
    let loading = RwSignal::new(false);
    let seq = StoredValue::new(0u64);
    let input = NodeRef::<leptos::html::Input>::new();
    Effect::new(move |_| {
        if let Some(i) = input.get() {
            let _ = i.focus();
        }
    });
    Effect::new(move |_| {
        let text = q.get().trim().to_owned();
        app.hosts.active_id.track();
        seq.update_value(|s| *s += 1);
        let mine = seq.get_value();
        error.set(None);
        hits.set(None);
        truncated.set(false);
        loading.set(!text.is_empty());
        if text.is_empty() {
            return;
        }
        set_timeout(
            move || {
                if seq.try_get_value() != Some(mine) {
                    return;
                }
                let Some(c) = app.conn.client() else {
                    error.set(Some("Host is not connected.".into()));
                    loading.set(false);
                    return;
                };
                spawn_local(async move {
                    let req = serde_json::from_value(json!({
                        "requestId": "", "search": text, "page": { "limit": 50 }
                    }));
                    let res = match req {
                        Ok(r) => c
                            .fetch_agent_history(&r)
                            .await
                            .map_err(|e| e.to_string())
                            .and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string())),
                        Err(e) => Err(e.to_string()),
                    };
                    if seq.try_get_value() != Some(mine) {
                        return;
                    }
                    match res {
                        Ok(v) => {
                            truncated.set(v["searchTruncated"].as_bool().unwrap_or(false));
                            hits.set(Some(
                                v["entries"]
                                    .as_array()
                                    .into_iter()
                                    .flatten()
                                    .filter_map(to_hit)
                                    .collect(),
                            ));
                        }
                        Err(e) => error.set(Some(e)),
                    }
                    loading.set(false);
                });
            },
            Duration::from_millis(160),
        );
    });
    view! {
        <div class="panel pn">
            <PanelHead title="Search" />
            <div class="pn-search-box cut" style="--c:6px">
                <input
                    node_ref=input
                    class="pn-search-input"
                    placeholder="Sessions by title, branch or project"
                    prop:value=move || q.get()
                    on:input=move |e| q.set(event_target_value(&e))
                />
            </div>
            <div class="panel-scroll">
                {move || error.get().map(|e| view! { <div class="pn-error">{e}</div> })}
                {move || loading.get().then(|| view! { <div class="pn-empty pn-muted">"Searching…"</div> })}
                {move || (hits.with(|h| h.is_none()) && !loading.get() && error.with(|e| e.is_none())).then(|| view! {
                    <div class="t-label pn-note-plain">"all sessions on this host, archived included"</div>
                })}
                {move || hits.get().map(|h| {
                    let n = h.len();
                    view! {
                        <GroupHead label="Sessions" count=Signal::derive(move || n) />
                        {(n == 0).then(|| view! { <div class="pn-sub">"No sessions match."</div> })}
                        {h.into_iter().map(|h| view! { <HitRow h=h /> }).collect_view()}
                    }
                })}
                {move || truncated.get().then(|| view! { <div class="t-label pn-note-plain">"more matches · narrow the query"</div> })}
            </div>
        </div>
    }
}

#[component]
fn HitRow(h: Hit) -> impl IntoView {
    let app = state::get();
    let a = h.session.agent.clone();
    let branch = h
        .session
        .project
        .as_ref()
        .filter(|p| p.checkout["isGit"] == true)
        .and_then(|p| p.checkout["currentBranch"].as_str().map(str::to_owned));
    let sub = [
        h.session.project.as_ref().map(|p| p.project_name.clone()),
        branch,
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" · ");
    let title = a.title_or_untitled();
    let marked = marked(&title, &h.ranges);
    let session = h.session.clone();
    let open = move |_| {
        let Some(host) = app.active_host() else {
            return;
        };
        let s = session.clone();
        let id = s.agent.id.clone();
        app.agents.by_host.update(|m| {
            m.entry(host).or_default().entry(id.clone()).or_insert(s);
        });
        app.ui.set_tool(Tool::Sessions);
        app.ui.select(Some(id));
    };
    let bucket = bucket_of(&a);
    view! {
        <div class="pn-hit" role="button" on:click=open>
            <div class="pn-hit-head">
                {if a.archived_at.is_some() {
                    view! { <Icon ico=Ico::Archive size=11.0 class="faint" /> }.into_any()
                } else {
                    view! { <StatusGlyph bucket=bucket size=8.0 /> }.into_any()
                }}
                <span class="pn-hit-title">{marked}</span>
                <span class="t-mono pn-when">{ago(&a.updated_at)}</span>
            </div>
            <span class="t-mono pn-hit-sub">{sub}</span>
        </div>
    }
}

/// The title with matched ranges (UTF-16 offsets from the daemon) highlighted.
fn marked(text: &str, ranges: &[(usize, usize)]) -> AnyView {
    if ranges.is_empty() {
        return text.to_owned().into_any();
    }
    let units: Vec<u16> = text.encode_utf16().collect();
    let slice = |a: usize, b: usize| {
        String::from_utf16_lossy(&units[a.min(units.len())..b.min(units.len())])
    };
    let mut sorted = ranges.to_vec();
    sorted.sort();
    let mut out: Vec<AnyView> = Vec::new();
    let mut at = 0;
    for (start, len) in sorted {
        if start > at {
            out.push(slice(at, start).into_any());
        }
        out.push(view! { <span class="pn-mark-hit">{slice(start, start + len)}</span> }.into_any());
        at = at.max(start + len);
    }
    out.push(slice(at, units.len()).into_any());
    out.into_any()
}
