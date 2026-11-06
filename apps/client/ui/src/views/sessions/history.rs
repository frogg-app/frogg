//! History scope (ui-next `sessions/history.tsx`): archived sessions from the daemon, searchable,
//! grouped by calendar age, restorable, paged.

use leptos::prelude::*;
use leptos::task::spawn_local;

use crate::components::{SkeletonRows, StatusGlyph};
use crate::state::projects::{self, HistoryEntry};
use crate::state::sessions::{age_group, ago, paths};
use crate::state::Bucket;

#[component]
pub fn HistoryList() -> impl IntoView {
    let q = RwSignal::new(String::new());
    let rows = RwSignal::new(None::<Vec<HistoryEntry>>);
    let next = RwSignal::new(None::<String>);
    let err = RwSignal::new(None::<String>);
    let seq = StoredValue::new(0u32);
    let load = move |search: String, cursor: Option<String>| {
        err.set(None);
        seq.update_value(|s| *s += 1);
        let mine = seq.get_value();
        let more = cursor.is_some();
        spawn_local(async move {
            let res = projects::fetch_history(&search, cursor).await;
            if seq.try_get_value() != Some(mine) {
                return;
            }
            match res {
                Ok((entries, n)) => {
                    rows.update(|r| match (r.as_mut(), more) {
                        (Some(r), true) => r.extend(entries),
                        _ => *r = Some(entries),
                    });
                    next.set(n);
                }
                Err(e) => {
                    rows.update(|r| {
                        r.get_or_insert_with(Vec::new);
                    });
                    err.set(Some(e));
                }
            }
        });
    };
    // Debounced search.
    let timer = StoredValue::new(None::<TimeoutHandle>);
    Effect::new(move |_| {
        let text = q.get().trim().to_owned();
        if let Some(h) = timer.get_value() {
            h.clear();
        }
        let delay = if text.is_empty() { 0 } else { 250 };
        timer.set_value(
            set_timeout_with_handle(
                move || load(text.clone(), None),
                std::time::Duration::from_millis(delay),
            )
            .ok(),
        );
    });
    let groups = move || {
        let mut out: Vec<(String, Vec<HistoryEntry>)> = Vec::new();
        for e in rows.get().unwrap_or_default() {
            let at = e
                .str("archivedAt")
                .or_else(|| e.str("updatedAt"))
                .unwrap_or_default();
            let name = age_group(&at).to_owned();
            match out.last_mut() {
                Some((n, l)) if *n == name => l.push(e),
                _ => out.push((name, vec![e])),
            }
        }
        out
    };
    view! {
        <div class="history">
            <div class="slist-filter cut" style="--c:5px">
                <input
                    class="slist-filter-in"
                    placeholder="Search history"
                    spellcheck="false"
                    prop:value=move || q.get()
                    on:input=move |ev| q.set(event_target_value(&ev))
                />
            </div>
            <div class="panel-scroll">
                <Show when=move || rows.with(Option::is_none)>
                    <SkeletonRows rows=6 />
                </Show>
                <Show when=move || rows.with(|r| r.as_ref().is_some_and(Vec::is_empty)) && err.get().is_none()>
                    <span class="slist-none">
                        {move || if q.get().is_empty() { "No archived sessions yet." } else { "No archived sessions match." }}
                    </span>
                </Show>
                {move || err.get().map(|e| view! { <span class="t-mono sheet-err pad">{e}</span> })}
                {move || {
                    groups()
                        .into_iter()
                        .map(|(name, list)| {
                            let n = list.len();
                            view! {
                                <div class="sgroup-head">
                                    <span class="t-label">{name}</span>
                                    <span class="t-mono group-count">{n}</span>
                                </div>
                                {list.into_iter().map(|e| view! { <HistoryRow entry=e rows=rows /> }).collect_view()}
                            }
                        })
                        .collect_view()
                }}
                <Show when=move || next.with(Option::is_some)>
                    <button class="history-more" on:click=move |_| load(q.get_untracked().trim().to_owned(), next.get_untracked())>
                        "Load more"
                    </button>
                </Show>
            </div>
        </div>
    }
}

#[component]
fn HistoryRow(entry: HistoryEntry, rows: RwSignal<Option<Vec<HistoryEntry>>>) -> impl IntoView {
    let app = crate::state::get();
    let busy = RwSignal::new(false);
    let err = RwSignal::new(None::<String>);
    let title = entry
        .str("title")
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| "Untitled session".into());
    let project = entry
        .project
        .as_ref()
        .and_then(|p| p.get("projectName"))
        .and_then(|v| v.as_str())
        .map(str::to_owned)
        .unwrap_or_else(|| paths::base_name(&entry.str("cwd").unwrap_or_default()));
    let when = ago(&entry.str("archivedAt").unwrap_or_default());
    let provider = entry.str("provider").unwrap_or_default();
    let entry = StoredValue::new(entry);
    let restore = move |_| {
        busy.set(true);
        err.set(None);
        spawn_local(async move {
            let e = entry.get_value();
            match projects::restore_session(&e).await {
                Ok(()) => {
                    let id = e.id();
                    rows.update(|r| {
                        if let Some(r) = r {
                            r.retain(|x| x.id() != id);
                        }
                    });
                    app.ui.select(Some(id));
                }
                Err(x) => err.set(Some(x)),
            }
            busy.set(false);
        });
    };
    view! {
        <div class="srow2 history-row">
            <div class="srow2-top">
                <span class="srow2-glyph"><StatusGlyph bucket=Bucket::Idle still=true /></span>
                <span class="srow2-title">{title}</span>
                <span class="t-mono srow2-time">{when}</span>
            </div>
            <div class="srow2-meta">
                <span class="srow2-proj">{project}</span>
                <span class="t-mono srow2-branch">{provider}</span>
                <span class="spacer"></span>
                <button class="link" disabled=move || busy.get() on:click=restore>
                    {move || if busy.get() { "Restoring…" } else { "Restore" }}
                </button>
            </div>
            {move || err.get().map(|e| view! { <span class="t-mono srow2-error">{e}</span> })}
        </div>
    }
}
