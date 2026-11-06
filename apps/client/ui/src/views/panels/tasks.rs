//! Tasks (ui-next `TasksPanel.tsx`, `tasks/*`): the host's project to-dos as a filtered list in
//! the panel and a board by status in the main pane (phones switch between them), with a new
//! to-do sheet and a detail sheet.

use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::json;

use super::util::Sheet;
use super::util::{Ask, Confirm};
use crate::components::{
    Brackets, Button, ButtonKind, Ico, Icon, Seg, Select, SelectOption, TextInput,
};
use crate::shell::panel_head::{GroupHead, PanelHead};
use crate::shell::toast::{Toast, ToastKind};
use crate::state::checkout::online;
use crate::state::tasks::{status_label, store, supported, Todo, PRIORITIES, STATUSES};
use crate::state::{self};
use crate::theme::layout::FormFactor;

/// List order: what needs a person first, finished work last.
const LIST_ORDER: [&str; 7] = [
    "review",
    "blocked",
    "in_progress",
    "claimed",
    "ready",
    "backlog",
    "done",
];
const ALL: &str = "__all";

/// A starting point for a new to-do (ui-next `tasks/templates.ts`). The description is what an
/// agent reads when it claims the item, so each is a prompt skeleton.
struct Template {
    id: &'static str,
    label: &'static str,
    category: &'static str,
    priority: &'static str,
    title: &'static str,
    description: &'static str,
}

const TEMPLATES: [Template; 6] = [
    Template {
        id: "blank",
        label: "Blank",
        category: "",
        priority: "medium",
        title: "",
        description: "",
    },
    Template {
        id: "bug",
        label: "Bug fix",
        category: "bug",
        priority: "high",
        title: "Fix: ",
        description: "## What happens\n\n## What should happen\n\n## Steps to reproduce\n1. \n\n## Done when\n- The steps above no longer reproduce it\n- A test covers the case",
    },
    Template {
        id: "feature",
        label: "Feature",
        category: "feature",
        priority: "medium",
        title: "",
        description: "## Goal\n\n## Scope\n- \n\n## Out of scope\n- \n\n## Done when\n- \n- Typecheck and tests pass",
    },
    Template {
        id: "refactor",
        label: "Refactor",
        category: "refactor",
        priority: "low",
        title: "Refactor: ",
        description: "## What to change\n\n## Why\n\n## Constraints\n- No behaviour change\n\n## Done when\n- Existing tests pass unchanged",
    },
    Template {
        id: "investigate",
        label: "Investigate",
        category: "research",
        priority: "medium",
        title: "Investigate: ",
        description: "## Question\n\n## Where to look\n- \n\n## Report back\n- Findings with file and line references\n- A recommended next step",
    },
    Template {
        id: "docs",
        label: "Docs",
        category: "docs",
        priority: "low",
        title: "Document ",
        description: "## Page or file\n\n## What it should cover\n- \n\n## Done when\n- The page matches the code",
    },
];

/// Most urgent first; the daemon's order (most recently touched) breaks ties (ui-next
/// `TodoBoard.tsx` `byUrgency`).
fn by_urgency(mut items: Vec<(String, Todo)>) -> Vec<(String, Todo)> {
    let rank = |p: &str| match p {
        "urgent" => 0,
        "high" => 1,
        "medium" => 2,
        _ => 3,
    };
    items.sort_by_key(|(_, t)| rank(&t.priority));
    items
}

fn toast_err(title: String, e: String) {
    state::get()
        .toasts
        .push(Toast::new(ToastKind::Error, title).detail(e));
}

/// A move the user made (board arrows, the detail's column): a toast names the column with an
/// Undo, so a card leaving the view is never unexplained (ui-next `tasks/moves.ts`).
async fn move_todo(project: String, id: String, title: String, from: String, to: String) {
    if from == to {
        return;
    }
    if let Err(e) = store()
        .set_status(project.clone(), id.clone(), to.clone())
        .await
    {
        toast_err(format!("Couldn't move “{title}”"), e);
        return;
    }
    let undo = move || {
        let (p, i, back) = (project.clone(), id.clone(), from.clone());
        spawn_local(async move {
            if let Err(e) = store().set_status(p, i, back).await {
                toast_err("Couldn't undo the move".into(), e);
            }
        });
    };
    state::get().toasts.push(
        Toast::new(ToastKind::Ok, format!("Moved to {}", status_label(&to)))
            .detail(title)
            .action("Undo", undo),
    );
}

fn status_tint(s: &str) -> &'static str {
    match s {
        "ready" => "var(--cyan)",
        "claimed" => "var(--violet)",
        "in_progress" => "var(--cyan2)",
        "review" => "var(--amber)",
        "done" => "var(--mint)",
        "blocked" => "var(--coral)",
        _ => "var(--faint)",
    }
}

fn priority_tint(p: &str) -> &'static str {
    match p {
        "low" => "var(--faint)",
        "high" => "var(--amber)",
        "urgent" => "var(--coral)",
        _ => "var(--cyan)",
    }
}

/// Loads projects and their to-dos while the host is online.
fn use_loader() {
    let t = store();
    Effect::new(move |_| {
        if online() && supported() {
            t.load_projects();
        }
    });
}

#[component]
pub fn TasksPanel() -> impl IntoView {
    use_loader();
    let app = state::get();
    let t = store();
    let creating = RwSignal::new(false);
    let view_mode = RwSignal::new("list".to_owned());
    let ok = Memo::new(move |_| online() && supported());
    let phone = move || app.viewport.form_factor.get() == FormFactor::Phone;
    let query = RwSignal::new(String::new());
    Effect::new(move |_| t.query.set(query.get()));
    // "Clear filters" clears the store; mirror it back into the field.
    Effect::new(move |_| {
        let q = t.query.get();
        if q != query.get_untracked() {
            query.set(q);
        }
    });
    view! {
        <div class="panel pn">
            <PanelHead title="Tasks">
                <button class="icon-btn" aria-label="Refresh to-dos" disabled=move || !ok.get() on:click=move |_| t.refresh()>
                    <Icon ico=Ico::RefreshCw size=14.0 class="faint" />
                </button>
                <button class="icon-btn" aria-label="New to-do" disabled=move || !ok.get() on:click=move |_| creating.set(true)>
                    <Icon ico=Ico::Plus size=17.0 class="faint" />
                </button>
            </PanelHead>
            {move || (!ok.get()).then(|| view! {
                <div class="pn-empty pn-muted">
                    {if online() {
                        "This host doesn't support project to-dos. Update its daemon to use Tasks."
                    } else {
                        "Connect to the host to load its to-dos."
                    }}
                </div>
            })}
            <Show when=move || ok.get()>
                <div class="pn-filters">
                    {move || {
                        let mut opts = vec![SelectOption::new(ALL, "All projects")];
                        for p in t.projects.get().unwrap_or_default() {
                            let mut o = SelectOption::new(p.project_id, p.project_display_name);
                            o.hint = Some(p.project_root_path);
                            opts.push(o);
                        }
                        view! {
                            <Select
                                options=opts
                                value=Signal::derive(move || t.scope.get().unwrap_or_else(|| ALL.into()))
                                on_change=Callback::new(move |v: String| t.scope.set((v != ALL).then_some(v)))
                            />
                        }
                    }}
                    <div class="pn-search">
                        <Icon ico=Ico::Search size=13.0 class="faint" />
                        <TextInput value=query placeholder="Filter by title, description or category" />
                    </div>
                </div>
                <FilterNote />
                {move || {
                    if phone() {
                        view! {
                            <div class="pn-views">
                                <Seg
                                    options=vec![("list".into(), "List".into()), ("board".into(), "Board".into())]
                                    value=view_mode
                                    on_change=Callback::new(move |v| view_mode.set(v))
                                />
                            </div>
                        }
                        .into_any()
                    } else {
                        view! {
                            <div class="pn-caption">
                                "The board beside this shows the same to-dos by column. Filters apply to both; select one to edit it."
                            </div>
                        }
                        .into_any()
                    }
                }}
                {move || t.errors.get().into_values().map(|e| view! { <div class="pn-error t-mono">{e}</div> }).collect_view()}
                {move || {
                    if phone() && view_mode.get() == "board" {
                        view! { <Board /> }.into_any()
                    } else {
                        view! { <TodoList on_new=Callback::new(move |_| creating.set(true)) /> }.into_any()
                    }
                }}
            </Show>
            <TodoDetailSheet />
            <NewTodoSheet open=creating />
        </div>
    }
}

#[component]
fn FilterNote() -> impl IntoView {
    let t = store();
    // Says what the filters hide: the project and the text match, how many are left, and Clear
    // (ui-next `tasks/FilterNote.tsx`).
    move || {
        let (shown, total) = t.summary();
        let scope = t.scope.get();
        let query = t.query.get().trim().to_owned();
        if scope.is_none() && query.is_empty() {
            return None;
        }
        let project = scope.as_ref().map(|s| {
            t.project_name(s)
                .unwrap_or_else(|| "one project".to_owned())
        });
        let why = [project, (!query.is_empty()).then(|| format!("“{query}”"))]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" · ");
        Some(view! {
            <div class="pn-filter-note pn-filter-note-on">
                <Icon ico=Ico::Filter size=12.0 class="cyan2" />
                <span class="pn-filter-why">{format!("Showing {shown} of {total} · {why}")}</span>
                <button class="pn-link" on:click=move |_| {
                    t.scope.set(None);
                    t.query.set(String::new());
                }>"Clear filters"</button>
            </div>
        })
    }
}

#[component]
fn TodoList(on_new: Callback<()>) -> impl IntoView {
    let t = store();
    move || {
        let items = by_urgency(t.filtered());
        let multi = t.scope.get().is_none();
        if items.is_empty() {
            let loading = t.loading();
            let query = !t.query.get().trim().is_empty();
            return view! {
                <div class="pn-empty">
                    <span class="pn-muted">
                        {if loading {
                            "Loading to-dos…"
                        } else if query {
                            "Nothing matches the filter."
                        } else {
                            "No to-dos yet. Write one down and agents on this host can claim it."
                        }}
                    </span>
                    {(!loading && !query).then(|| view! {
                        <Button kind=ButtonKind::Primary label="New to-do" on_press=on_new />
                    })}
                </div>
            }
            .into_any();
        }
        view! {
            <div class="panel-scroll">
                {LIST_ORDER
                    .iter()
                    .filter_map(|k| {
                        let col: Vec<_> = items.iter().filter(|(_, x)| x.status == *k).cloned().collect();
                        if col.is_empty() {
                            return None;
                        }
                        let n = col.len();
                        Some(view! {
                            <div class="pn-group m-enter">
                                <GroupHead label=status_label(k) count=Signal::derive(move || n) />
                                <div class="pn-cards">
                                    {col
                                        .into_iter()
                                        .map(|(pid, todo)| {
                                            let name = multi.then(|| t.project_name(&pid)).flatten();
                                            view! { <TodoCard project=pid todo=todo project_name=name moves=false /> }
                                        })
                                        .collect_view()}
                                </div>
                            </div>
                        })
                    })
                    .collect_view()}
            </div>
        }
        .into_any()
    }
}

#[component]
fn TodoCard(
    project: String,
    todo: Todo,
    project_name: Option<String>,
    moves: bool,
) -> impl IntoView {
    let t = store();
    let app = state::get();
    let (pid, id) = (project.clone(), todo.id.clone());
    let on = Signal::derive(move || t.open.get().is_some_and(|(p, x)| p == pid && x == id));
    let at = STATUSES
        .iter()
        .position(|x| x.0 == todo.status)
        .unwrap_or(0);
    let step = {
        let (pid, id, title) = (project.clone(), todo.id.clone(), todo.title.clone());
        let from = todo.status.clone();
        move |by: i32| {
            let next = at as i32 + by;
            let Some(next) = (next >= 0).then(|| STATUSES.get(next as usize)).flatten() else {
                return;
            };
            spawn_local(move_todo(
                pid.clone(),
                id.clone(),
                title.clone(),
                from.clone(),
                next.0.into(),
            ));
        }
    };
    let step2 = step.clone();
    let claim = todo.claims.first().map(|c| {
        let title = app
            .active_host()
            .and_then(|h| app.agents.get_untracked(&h, &c.agent_id))
            .map(|s| s.agent.title_or_untitled())
            .unwrap_or_else(|| c.agent_id.chars().take(8).collect());
        let more = if todo.claims.len() > 1 {
            format!(" +{}", todo.claims.len() - 1)
        } else {
            String::new()
        };
        (
            format!(
                "{title}{more}{}",
                if c.stale { " · agent stopped" } else { "" }
            ),
            c.stale,
        )
    });
    let desc: String = todo
        .description
        .lines()
        .map(|l| l.trim_start_matches('#').trim())
        .collect::<Vec<_>>()
        .join(" ");
    let note = todo
        .last_progress
        .as_ref()
        .and_then(|p| p["note"].as_str().map(str::to_owned));
    let (pid, id) = (project.clone(), todo.id.clone());
    view! {
        <div
            class="pn-card cut"
            class:on=move || on.get()
            style="--c:8px"
            role="button"
            aria-label=todo.title.clone()
            on:click=move |_| t.open.set(Some((pid.clone(), id.clone())))
        >
            <Brackets on=on />
            <div class="pn-card-top">
                <span class="pn-pri" style=format!("background:{}", priority_tint(&todo.priority))></span>
                <span class="pn-card-title">{todo.title.clone()}</span>
            </div>
            {(!desc.is_empty()).then(|| view! { <div class="pn-card-desc">{desc}</div> })}
            <div class="pn-card-meta t-mono">
                <span style=format!("color:{}", priority_tint(&todo.priority))>{todo.priority.clone()}</span>
                {todo.category.clone().map(|c| view! { <span>{format!("· {c}")}</span> })}
                {project_name.map(|n| view! { <span>{format!("· {n}")}</span> })}
            </div>
            {claim.map(|(text, stale)| view! {
                <div class="pn-card-claim t-mono">
                    <Icon ico=Ico::Bot size=11.0 class=if stale { "faint" } else { "violet" } />
                    <span>{text}</span>
                </div>
            })}
            {note.map(|n| view! { <div class="pn-card-note t-mono">{n}</div> })}
            {moves.then(|| view! {
                <div class="pn-moves">
                    <button class="icon-btn" aria-label="Move to previous column" disabled={at == 0}
                        on:click=move |e| { e.stop_propagation(); step(-1) }>
                        <Icon ico=Ico::ChevronLeft size=13.0 />
                    </button>
                    <button class="icon-btn" aria-label="Move to next column" disabled={at + 1 >= STATUSES.len()}
                        on:click=move |e| { e.stop_propagation(); step2(1) }>
                        <Icon ico=Ico::ChevronRight size=13.0 />
                    </button>
                </div>
            })}
        </div>
    }
}

/// The board in the main pane (wide layouts) or the panel's Board tab (phones).
#[component]
fn Board() -> impl IntoView {
    let t = store();
    move || {
        let items = by_urgency(t.filtered());
        let multi = t.scope.get().is_none();
        view! {
            <div class="pn-board">
                {STATUSES
                    .iter()
                    .map(|(k, label, hint)| {
                        let col: Vec<_> = items.iter().filter(|(_, x)| x.status == *k).cloned().collect();
                        let n = col.len();
                        view! {
                            <div class="pn-col">
                                <div class="pn-col-head" title=*hint>
                                    <span class="pn-col-dot" style=format!("background:{}", status_tint(k))></span>
                                    <span class="t-label">{*label}</span>
                                    <span class="t-mono group-count">{n}</span>
                                </div>
                                <div class="pn-col-cards">
                                    {col
                                        .into_iter()
                                        .map(|(pid, todo)| {
                                            let name = multi.then(|| t.project_name(&pid)).flatten();
                                            view! { <TodoCard project=pid todo=todo project_name=name moves=true /> }
                                        })
                                        .collect_view()}
                                </div>
                            </div>
                        }
                    })
                    .collect_view()}
            </div>
        }
    }
}

/// The main pane on wide layouts: the board.
#[component]
pub fn TodoBoard() -> impl IntoView {
    use_loader();
    view! {
        <div class="detail pn-board-pane">
            <div class="pn-board-head">
                <span class="t-label">"tasks · board"</span>
                <span class="t-display pn-viewer-title">"To-dos by status"</span>
            </div>
            <Board />
        </div>
    }
}

#[component]
fn NewTodoSheet(open: RwSignal<bool>) -> impl IntoView {
    let t = store();
    let title = RwSignal::new(String::new());
    let desc = RwSignal::new(String::new());
    let priority = RwSignal::new("medium".to_owned());
    let status = RwSignal::new("backlog".to_owned());
    let project = RwSignal::new(String::new());
    let error = RwSignal::new(None::<String>);
    let busy = RwSignal::new(false);
    let template = RwSignal::new("blank".to_owned());
    let category = RwSignal::new(String::new());
    let pick = move |id: &str| {
        let Some(x) = TEMPLATES.iter().find(|x| x.id == id) else {
            return;
        };
        template.set(x.id.into());
        title.set(x.title.into());
        desc.set(x.description.into());
        category.set(x.category.into());
        priority.set(x.priority.into());
    };
    Effect::new(move |_| {
        if open.get() {
            let first = t
                .scope
                .get_untracked()
                .or_else(|| {
                    t.projects
                        .get_untracked()
                        .and_then(|p| p.first().map(|p| p.project_id.clone()))
                })
                .unwrap_or_default();
            project.set(first);
            pick("blank");
            status.set("backlog".into());
            error.set(None);
        }
    });
    let submit = Callback::new(move |_| {
        let ti = title.get_untracked().trim().to_owned();
        let pid = project.get_untracked();
        if ti.is_empty() || pid.is_empty() || busy.get_untracked() {
            return;
        }
        busy.set(true);
        spawn_local(async move {
            let cat = category.get_untracked().trim().to_owned();
            let r = t
                .create_with(
                    pid,
                    json!({
                        "title": ti,
                        "description": desc.get_untracked(),
                        "priority": priority.get_untracked(),
                        "status": status.get_untracked(),
                        "category": (!cat.is_empty()).then_some(cat),
                    }),
                )
                .await;
            busy.set(false);
            match r {
                Ok(()) => open.set(false),
                Err(e) => error.set(Some(e)),
            }
        });
    });
    view! {
        <Sheet open=open on_close=Callback::new(move |_| open.set(false)) title="New to-do".to_string() width=480.0>
            <div class="pn-form">
                {move || {
                    let opts: Vec<SelectOption> = t
                        .projects
                        .get()
                        .unwrap_or_default()
                        .into_iter()
                        .map(|p| SelectOption::new(p.project_id, p.project_display_name))
                        .collect();
                    view! { <Select options=opts value=project on_change=Callback::new(move |v| project.set(v)) placeholder="Project" /> }
                }}
                <span class="t-label">"Template"</span>
                <Select
                    options=TEMPLATES.iter().map(|x| SelectOption::new(x.id, x.label)).collect()
                    value=template
                    on_change=Callback::new(move |v: String| pick(&v))
                />
                <TextInput value=title placeholder="Title" autofocus=true on_enter=submit />
                <textarea
                    class="pn-msg"
                    placeholder="Description (markdown)"
                    prop:value=move || desc.get()
                    on:input=move |e| desc.set(event_target_value(&e))
                ></textarea>
                <span class="t-label">"Category"</span>
                <TextInput value=category placeholder="e.g. bug, feature, docs" />
                <div class="pn-form-row">
                    <Select
                        options=PRIORITIES.iter().map(|(v, l)| SelectOption::new(*v, *l)).collect()
                        value=priority
                        on_change=Callback::new(move |v| priority.set(v))
                        chip=true
                    />
                    <Select
                        options=STATUSES.iter().map(|(v, l, _)| SelectOption::new(*v, *l)).collect()
                        value=status
                        on_change=Callback::new(move |v| status.set(v))
                        chip=true
                    />
                </div>
                {move || error.get().map(|e| view! { <span class="pn-error-inline t-mono">{e}</span> })}
                <div class="pn-confirm-row">
                    <Button label="Cancel" on_press=Callback::new(move |_| open.set(false)) />
                    <Button
                        kind=ButtonKind::Primary
                        label="Create to-do"
                        disabled=Signal::derive(move || busy.get() || title.get().trim().is_empty())
                        on_press=submit
                    />
                </div>
            </div>
        </Sheet>
    }
}

/// An agent holding a to-do: its session title, heartbeat or stale note, and a link to it.
#[component]
fn ClaimRow(claim: crate::state::tasks::Claim) -> impl IntoView {
    let app = state::get();
    let session = app
        .active_host()
        .and_then(|h| app.agents.get_untracked(&h, &claim.agent_id));
    let title = session
        .as_ref()
        .map(|s| s.agent.title_or_untitled())
        .unwrap_or_else(|| claim.agent_id.clone());
    let sub = if claim.stale {
        "agent stopped · claim is stale".to_owned()
    } else {
        let at = claim
            .last_heartbeat
            .as_deref()
            .map(super::util::ago)
            .unwrap_or_default();
        format!("heartbeat {at}")
    };
    let id = claim.agent_id.clone();
    view! {
        <div class="pn-claim">
            <Icon ico=Ico::Bot size=13.0 class=if claim.stale { "faint" } else { "violet" } />
            <div class="pn-claim-text">
                <span class="pn-claim-title">{title}</span>
                <span class="t-mono faint pn-small">{sub}</span>
            </div>
            {session.is_some().then(|| view! {
                <button class="pn-link t-mono" on:click=move |_| {
                    store().open.set(None);
                    app.ui.set_tool(state::Tool::Sessions);
                    app.ui.select(Some(id.clone()));
                }>"Open session"</button>
            })}
        </div>
    }
}

#[component]
fn TodoDetailSheet() -> impl IntoView {
    let t = store();
    let ask = RwSignal::new(None::<Ask>);
    let open = Signal::derive(move || t.open.with(|o| o.is_some()));
    let current = Memo::new(move |_| {
        let (p, id) = t.open.get()?;
        t.find(&p, &id).map(|todo| (p, todo))
    });
    let title = RwSignal::new(String::new());
    let desc = RwSignal::new(String::new());
    let category = RwSignal::new(String::new());
    let error = RwSignal::new(None::<String>);
    Effect::new(move |prev: Option<Option<String>>| {
        let id = t.open.get().map(|(_, id)| id);
        if prev.as_ref() != Some(&id) {
            if let Some((_, todo)) = current.get_untracked() {
                title.set(todo.title);
                desc.set(todo.description);
                category.set(todo.category.unwrap_or_default());
            }
            error.set(None);
        }
        id
    });
    let save = move || {
        let Some((pid, todo)) = current.get_untracked() else {
            return;
        };
        let (ti, de) = (title.get_untracked(), desc.get_untracked());
        let cat = category.get_untracked().trim().to_owned();
        let cat = (!cat.is_empty()).then_some(cat);
        if ti.trim().is_empty()
            || (ti == todo.title && de == todo.description && cat == todo.category)
        {
            return;
        }
        spawn_local(async move {
            if let Err(e) = t
                .update(
                    pid,
                    todo.id,
                    json!({ "title": ti.trim(), "description": de, "category": cat }),
                )
                .await
            {
                error.set(Some(e));
            }
        });
    };
    view! {
        <Sheet open=open on_close=Callback::new(move |_| t.open.set(None)) width=520.0>
            {move || current.get().map(|(pid, todo)| {
                let (p1, id1, ti1, from1) =
                    (pid.clone(), todo.id.clone(), todo.title.clone(), todo.status.clone());
                let (p2, id2, ti2) = (pid.clone(), todo.id.clone(), todo.title.clone());
                let (p3, id3) = (pid.clone(), todo.id.clone());
                view! {
                    <div class="pn-form">
                        <span class="t-label">{format!("{} · {}", t.project_name(&pid).unwrap_or_default(), todo.id)}</span>
                        <input
                            class="input pn-todo-title"
                            prop:value=move || title.get()
                            on:input=move |e| title.set(event_target_value(&e))
                            on:blur=move |_| save()
                        />
                        <textarea
                            class="pn-msg pn-todo-desc"
                            placeholder="Description"
                            prop:value=move || desc.get()
                            on:input=move |e| desc.set(event_target_value(&e))
                            on:blur=move |_| save()
                        ></textarea>
                        <span class="t-label">"Category"</span>
                        <input
                            class="input"
                            aria-label="Category"
                            placeholder="e.g. bug, feature, docs"
                            prop:value=move || category.get()
                            on:input=move |e| category.set(event_target_value(&e))
                            on:blur=move |_| save()
                        />
                        <div class="pn-form-row">
                            <Select
                                options=STATUSES.iter().map(|(v, l, _)| SelectOption::new(*v, *l)).collect()
                                value=todo.status.clone()
                                on_change=Callback::new(move |v: String| {
                                    spawn_local(move_todo(
                                        p1.clone(),
                                        id1.clone(),
                                        ti1.clone(),
                                        from1.clone(),
                                        v,
                                    ));
                                })
                                chip=true
                            />
                            <Select
                                options=PRIORITIES.iter().map(|(v, l)| SelectOption::new(*v, *l)).collect()
                                value=todo.priority.clone()
                                on_change=Callback::new(move |v: String| {
                                    let (p, id) = (p3.clone(), id3.clone());
                                    spawn_local(async move {
                                        if let Err(e) = store().update(p, id, json!({ "priority": v })).await {
                                            error.set(Some(e));
                                        }
                                    });
                                })
                                chip=true
                            />
                            <span class="spacer"></span>
                            <Button
                                kind=ButtonKind::Danger
                                label="Delete"
                                icon=Ico::X
                                on_press=Callback::new(move |_| {
                                    let (p, id) = (p2.clone(), id2.clone());
                                    ask.set(Some(Ask::new(
                                        format!("Delete “{ti2}”?"),
                                        "Removes the to-do for every agent on this host.",
                                        "Delete",
                                        move || {
                                            let (p, id) = (p.clone(), id.clone());
                                            spawn_local(async move {
                                                if let Err(e) = store().delete(p, id).await {
                                                    toast_err("Couldn't delete the to-do".into(), e);
                                                }
                                            });
                                        },
                                    ).danger()))
                                })
                            />
                        </div>
                        <span class="t-label">"Agents"</span>
                        {todo.claims.is_empty().then(|| view! {
                            <span class="pn-muted pn-small-text">
                                "Unclaimed. Agents on this host pick up Ready items through the to-do tools."
                            </span>
                        })}
                        {todo.claims.iter().cloned().map(|c| view! { <ClaimRow claim=c /> }).collect_view()}
                        {todo.last_progress.clone().map(|p| {
                            let n = todo.progress_count.map(|n| format!(" · {n}")).unwrap_or_default();
                            let at = p["at"].as_str().map(super::util::ago).unwrap_or_default();
                            view! {
                                <span class="t-label">{format!("Latest progress{n}")}</span>
                                <span class="pn-muted pn-small-text">
                                    {p["note"].as_str().unwrap_or_default().to_owned()}
                                    <span class="t-mono faint pn-small">{format!("  {at}")}</span>
                                </span>
                            }
                        })}
                        {move || error.get().map(|e| view! { <span class="pn-error-inline t-mono">{e}</span> })}
                    </div>
                }
            })}
        </Sheet>
        <Confirm ask=ask />
    }
}
