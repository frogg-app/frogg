//! Session list (wave 2, sessions stream). Until then: a plain live list of the active host's
//! sessions grouped by status, enough to open one and to see updates arrive.

use leptos::prelude::*;

use crate::components::{Brackets, SkeletonRows, StatusGlyph};
use crate::shell::panel_head::{GroupHead, PanelHead};
use crate::state::{bucket_of, Bucket, Conn};

fn group_label(b: Bucket) -> &'static str {
    match b {
        Bucket::Needs => "Needs you",
        Bucket::Failed => "Failed",
        Bucket::Review => "Review",
        Bucket::Working => "Working",
        Bucket::Idle => "Idle",
    }
}

#[component]
pub fn SessionList() -> impl IntoView {
    let app = crate::state::get();
    let sessions = Memo::new(move |_| app.sessions());
    let loading =
        move || sessions.with(Vec::is_empty) && app.conn.active_link().conn == Conn::Connecting;
    view! {
        <div class="panel">
            <PanelHead title="Sessions".to_string() />
            <div class="panel-scroll">
                <Show when=loading>
                    <SkeletonRows rows=6 />
                </Show>
                <Show when=move || !loading() && sessions.with(Vec::is_empty)>
                    <div class="stub-note"><span class="stub-text">"No sessions on this host yet."</span></div>
                </Show>
                {move || {
                    Bucket::ORDER
                        .iter()
                        .map(|b| {
                            let b = *b;
                            let rows: Vec<_> = sessions
                                .get()
                                .into_iter()
                                .filter(|s| bucket_of(&s.agent) == b)
                                .collect();
                            (!rows.is_empty()).then(|| {
                                let n = rows.len();
                                view! {
                                    <GroupHead label=group_label(b) count=Signal::derive(move || n) />
                                    {rows
                                        .into_iter()
                                        .map(|s| {
                                            let id = s.agent.id.clone();
                                            let id2 = id.clone();
                                            let on = Signal::derive(move || app.ui.selected.get().as_deref() == Some(id2.as_str()));
                                            view! {
                                                <button class="srow" class:on=move || on.get() on:click=move |_| app.ui.select(Some(id.clone()))>
                                                    <Brackets on=on />
                                                    <StatusGlyph bucket=b />
                                                    <span class="srow-text">
                                                        <span class="srow-title">{s.agent.title_or_untitled()}</span>
                                                        <span class="t-mono srow-meta">
                                                            {s.project.as_ref().map(|p| p.project_name.clone()).unwrap_or_else(|| s.agent.cwd.clone())}
                                                        </span>
                                                    </span>
                                                </button>
                                            }
                                        })
                                        .collect_view()}
                                }
                            })
                        })
                        .collect_view()
                }}
            </div>
        </div>
    }
}
