//! Session-list dialogs (ui-next `sessions/sheets.tsx`): labels, rename, archive, import and add
//! project. One `Sheet` per kind, open while `SessionList::sheet` names it.

use std::collections::{HashMap, HashSet};

use leptos::prelude::*;
use leptos::task::spawn_local;

use super::folder::FolderBrowser;
use super::menus::Toggle;
use crate::components::{Button, ButtonKind, Ico, Icon, Sheet as Dialog, SkeletonRows, TextInput};
use crate::state::projects::{self, Importable, LabelDef};
use crate::state::sessions::{self as list, ago, paths, SessionExt, Sheet};

/// Daemon label colours mapped onto the palette (ui-next `sessions/labels.ts`).
pub fn label_hue(c: Option<&str>) -> &'static str {
    match c {
        Some("violet") | Some("indigo") => "var(--violet)",
        Some("sky") | Some("blue") => "var(--cyan2)",
        Some("emerald") => "var(--mint)",
        Some("orange") | Some("amber") => "var(--amber)",
        Some("pink") | Some("red") => "var(--coral)",
        Some("teal") => "var(--cyan)",
        _ => "var(--muted)",
    }
}

#[component]
pub fn LabelChip(#[prop(into)] name: String, color: Option<String>) -> impl IntoView {
    let hue = label_hue(color.as_deref());
    view! {
        <span class="label-chip t-mono" style=format!("--hue:{hue}")>{name}</span>
    }
}

fn err_line(e: RwSignal<Option<String>>) -> impl IntoView {
    move || {
        e.get()
            .map(|t| view! { <span class="t-mono sheet-err">{t}</span> })
    }
}

/// Renders whichever session-list dialog is open. Mount once, next to the list.
#[component]
pub fn SessionSheets() -> impl IntoView {
    view! {
        // Each dialog's `Sheet` portals itself to <body>.
        <LabelsDialog />
        <RenameDialog />
        <ArchiveDialog />
        <ImportDialog />
        <AddProjectDialog />
    }
}

fn sheet_agent(f: fn(&Sheet) -> Option<&String>) -> Memo<Option<String>> {
    let l = list::get();
    Memo::new(move |_| l.sheet.with(|s| s.as_ref().and_then(f).cloned()))
}

#[component]
fn LabelsDialog() -> impl IntoView {
    let app = crate::state::get();
    let d = projects::get();
    let l = list::get();
    let agent = sheet_agent(|s| match s {
        Sheet::Labels(id) => Some(id),
        _ => None,
    });
    let open = Signal::derive(move || agent.get().is_some());
    let q = RwSignal::new(String::new());
    let err = RwSignal::new(None::<String>);
    let ws_id = Memo::new(move |_| {
        let id = agent.get()?;
        let host = app.active_host()?;
        app.agents.get(&host, &id)?.workspace_id()
    });
    let assigned = move || -> HashSet<String> {
        d.workspace(ws_id.get().as_deref())
            .map(|w| w.labels.into_iter().collect())
            .unwrap_or_default()
    };
    let counts = move || {
        let mut m = HashMap::<String, usize>::new();
        d.workspaces.with(|ws| {
            for w in ws.values() {
                for x in &w.labels {
                    *m.entry(x.clone()).or_default() += 1;
                }
            }
        });
        m
    };
    let toggle = move |label: LabelDef, on: bool| {
        let Some(w) = ws_id.get_untracked() else {
            return;
        };
        err.set(None);
        spawn_local(async move {
            if let Err(e) = d.set_label(&w, label, on).await {
                err.set(Some(e));
            }
        });
    };
    let can_create = move || {
        let n = q.get().trim().to_lowercase();
        !n.is_empty()
            && !d
                .labels
                .with(|ls| ls.iter().any(|x| x.name.to_lowercase() == n))
    };
    let create = move || {
        if !can_create() {
            return;
        }
        toggle(
            LabelDef {
                name: q.get_untracked().trim().to_owned(),
                color: "sky".into(),
            },
            true,
        );
        q.set(String::new());
    };
    let host = move || app.conn.active_link().server_name.unwrap_or_default();
    view! {
        <Dialog open=open on_close=Callback::new(move |_| l.close()) title="Labels".to_string() width=440.0>
            <span class="t-label">{move || if host().is_empty() { "Session labels".to_string() } else { format!("Session labels · {}", host()) }}</span>
            <Show when=move || ws_id.get().is_none()>
                <span class="sheet-muted">"This session has no workspace, so it cannot carry labels."</span>
            </Show>
            <TextInput value=q placeholder="Search or create a label" autofocus=true on_enter=Callback::new(move |_| create()) />
            <div class="label-list">
                {move || {
                    let n = q.get().trim().to_lowercase();
                    let on = assigned();
                    let c = counts();
                    let shown: Vec<LabelDef> = d
                        .labels
                        .get()
                        .into_iter()
                        .filter(|x| n.is_empty() || x.name.to_lowercase().contains(&n))
                        .collect();
                    let empty = shown.is_empty();
                    let rows = shown
                        .into_iter()
                        .map(|x| {
                            let is_on = on.contains(&x.name);
                            let k = c.get(&x.name).copied().unwrap_or(0);
                            let x2 = x.clone();
                            view! {
                                <button class="label-row" class:on=is_on role="checkbox" aria-checked=is_on.to_string() on:click=move |_| toggle(x2.clone(), !is_on)>
                                    <LabelChip name=x.name.clone() color=Some(x.color.clone()) />
                                    <span class="sheet-muted">{if k == 1 { "1 session".to_string() } else { format!("{k} sessions") }}</span>
                                    {is_on.then(|| view! { <Icon ico=Ico::Check size=12.0 class="muted" /> })}
                                </button>
                            }
                        })
                        .collect_view();
                    view! {
                        {rows}
                        {can_create().then(|| view! {
                            <button class="label-row" on:click=move |_| create()>
                                <span class="sheet-muted">{format!("Create label “{}”", q.get_untracked().trim())}</span>
                            </button>
                        })}
                        {(empty && !can_create()).then(|| view! { <span class="sheet-muted">"No labels yet. Type to create one."</span> })}
                    }
                }}
            </div>
            {err_line(err)}
            <div class="sheet-actions">
                <Button label="Done" kind=ButtonKind::Primary on_press=Callback::new(move |_| l.close()) />
            </div>
        </Dialog>
    }
}

#[component]
fn RenameDialog() -> impl IntoView {
    let app = crate::state::get();
    let l = list::get();
    let agent = sheet_agent(|s| match s {
        Sheet::Rename(id) => Some(id),
        _ => None,
    });
    let open = Signal::derive(move || agent.get().is_some());
    let name = RwSignal::new(String::new());
    let err = RwSignal::new(None::<String>);
    Effect::new(move |_| {
        if let Some(id) = agent.get() {
            let t = app
                .active_host()
                .and_then(|h| app.agents.get(&h, &id))
                .and_then(|s| s.agent.title)
                .unwrap_or_default();
            name.set(t);
            err.set(None);
        }
    });
    let save = move || {
        let (Some(id), n) = (
            agent.get_untracked(),
            name.get_untracked().trim().to_owned(),
        ) else {
            return;
        };
        if n.is_empty() {
            return;
        }
        spawn_local(async move {
            match projects::rename_session(&id, &n).await {
                Ok(()) => l.close(),
                Err(e) => err.set(Some(e)),
            }
        });
    };
    view! {
        <Dialog open=open on_close=Callback::new(move |_| l.close()) title="Rename session".to_string()>
            <TextInput value=name placeholder="Session title" autofocus=true on_enter=Callback::new(move |_| save()) />
            {err_line(err)}
            <div class="sheet-actions">
                <Button label="Cancel" on_press=Callback::new(move |_| l.close()) />
                <Button
                    label="Rename"
                    kind=ButtonKind::Primary
                    disabled=Signal::derive(move || name.get().trim().is_empty())
                    on_press=Callback::new(move |_| save())
                />
            </div>
        </Dialog>
    }
}

#[component]
fn ArchiveDialog() -> impl IntoView {
    let app = crate::state::get();
    let l = list::get();
    let agent = sheet_agent(|s| match s {
        Sheet::Archive(id) => Some(id),
        _ => None,
    });
    let open = Signal::derive(move || agent.get().is_some());
    let err = RwSignal::new(None::<String>);
    let busy = RwSignal::new(false);
    let title = move || {
        agent
            .get()
            .and_then(|id| app.active_host().and_then(|h| app.agents.get(&h, &id)))
            .and_then(|s| s.agent.title)
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_else(|| "this session".into())
    };
    let go = move || {
        let Some(id) = agent.get_untracked() else {
            return;
        };
        if app.ui.selected.get_untracked().as_deref() == Some(id.as_str()) {
            app.ui.select(None);
        }
        busy.set(true);
        err.set(None);
        spawn_local(async move {
            match projects::archive_session(&id).await {
                Ok(()) => l.close(),
                Err(e) => err.set(Some(e)),
            }
            busy.set(false);
        });
    };
    view! {
        <Dialog open=open on_close=Callback::new(move |_| l.close()) title="Archive session".to_string()>
            <span class="t-display sheet-sub">{move || format!("Archive {}?", title())}</span>
            <span class="sheet-muted">"The agent stops and the session moves to History. You can restore it from there."</span>
            {err_line(err)}
            <div class="sheet-actions">
                <Button label="Cancel" on_press=Callback::new(move |_| l.close()) />
                <Button
                    label=Signal::derive(move || if busy.get() { "Archiving…".to_string() } else { "Archive".to_string() })
                    kind=ButtonKind::Danger
                    disabled=busy
                    on_press=Callback::new(move |_| go())
                />
            </div>
        </Dialog>
    }
}

#[component]
fn ImportDialog() -> impl IntoView {
    let app = crate::state::get();
    let l = list::get();
    let open = Signal::derive(move || l.sheet.with(|s| s == &Some(Sheet::Import)));
    let rows = RwSignal::new(None::<Vec<Importable>>);
    let hidden_n = RwSignal::new(0u64);
    let provider = RwSignal::new("all".to_string());
    let picked = RwSignal::new(HashSet::<String>::new());
    let err = RwSignal::new(None::<String>);
    let busy = RwSignal::new(false);
    let load = move || {
        rows.set(None);
        err.set(None);
        spawn_local(async move {
            match projects::fetch_importable().await {
                Ok((r, h)) => {
                    rows.set(Some(r));
                    hidden_n.set(h);
                }
                Err(e) => {
                    rows.set(Some(Vec::new()));
                    err.set(Some(e));
                }
            }
        });
    };
    Effect::new(move |_| {
        if open.get() {
            picked.set(HashSet::new());
            provider.set("all".into());
            load();
        }
    });
    let run = move || {
        busy.set(true);
        err.set(None);
        spawn_local(async move {
            let mut last = None;
            let chosen: Vec<Importable> = rows
                .get_untracked()
                .unwrap_or_default()
                .into_iter()
                .filter(|r| picked.with_untracked(|p| p.contains(&r.provider_handle_id)))
                .collect();
            let mut failed = None;
            for r in &chosen {
                match projects::import_session(r).await {
                    Ok(id) => last = Some(id),
                    Err(e) => {
                        failed = Some(e);
                        break;
                    }
                }
            }
            busy.set(false);
            match failed {
                Some(e) => err.set(Some(e)),
                None => {
                    l.close();
                    if let Some(id) = last {
                        app.ui.select(Some(id));
                    }
                }
            }
        });
    };
    let host = move || {
        app.conn
            .active_link()
            .server_name
            .unwrap_or_else(|| "this host".into())
    };
    view! {
        <Dialog open=open on_close=Callback::new(move |_| l.close()) title="Import conversations".to_string() width=740.0>
            <div class="import-tabs-row">
                <div class="import-tabs">
                    {move || {
                        let mut tabs = vec![("all".to_string(), format!("From {}", host()))];
                        let mut seen = HashSet::new();
                        for r in rows.get().unwrap_or_default() {
                            if seen.insert(r.provider_id.clone()) {
                                tabs.push((r.provider_id.clone(), r.provider_label.clone()));
                            }
                        }
                        tabs.into_iter()
                            .map(|(id, label)| {
                                let id2 = id.clone();
                                view! {
                                    <button class="import-tab" class:on=move || provider.get() == id on:click=move |_| provider.set(id2.clone())>
                                        {label}
                                    </button>
                                }
                            })
                            .collect_view()
                    }}
                </div>
                <button class="import-refresh" on:click=move |_| load()>
                    <Icon ico=Ico::RotateCw size=12.0 />
                    <span>"Refresh"</span>
                </button>
            </div>
            <Show when=move || rows.with(Option::is_none)>
                <SkeletonRows rows=4 />
            </Show>
            <div class="import-list">
                {move || {
                    let p = provider.get();
                    let shown: Vec<Importable> = rows
                        .get()
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|r| p == "all" || r.provider_id == p)
                        .collect();
                    if rows.with(Option::is_some) && shown.is_empty() && err.get().is_none() {
                        return view! { <span class="sheet-muted">{format!("No conversations on {} that are not already in Frogg.", host())}</span> }.into_any();
                    }
                    shown
                        .into_iter()
                        .map(|r| {
                            let id = r.provider_handle_id.clone();
                            let id2 = id.clone();
                            let on = Signal::derive(move || picked.with(|p| p.contains(&id)));
                            let flip = Callback::new(move |_: bool| {
                                picked.update(|p| {
                                    if !p.remove(&id2) {
                                        p.insert(id2.clone());
                                    }
                                })
                            });
                            let title = r
                                .title
                                .clone()
                                .filter(|t| !t.is_empty())
                                .or(r.first_prompt_preview.clone())
                                .unwrap_or_else(|| "untitled".into());
                            view! {
                                <div class="import-row" on:click=move |_| flip.run(true)>
                                    <Toggle value=on on_change=flip />
                                    <span class="import-body">
                                        <span class="import-title">{title}</span>
                                        <span class="import-meta">
                                            {format!("{} · {} · {} ago", r.provider_label, paths::tilde(&r.cwd), ago(&r.last_activity_at))}
                                        </span>
                                    </span>
                                </div>
                            }
                        })
                        .collect_view()
                        .into_any()
                }}
            </div>
            <Show when=move || { hidden_n.get() > 0 }>
                <span class="sheet-muted">
                    {move || {
                        let n = hidden_n.get();
                        format!("Already imported: {n} conversation{} hidden.", if n == 1 { " is" } else { "s are" })
                    }}
                </span>
            </Show>
            {err_line(err)}
            <div class="sheet-actions">
                <span class="sheet-foot">"Provider sessions stay resumable."</span>
                <Button label="Cancel" on_press=Callback::new(move |_| l.close()) />
                <Button
                    label=Signal::derive(move || {
                        if busy.get() {
                            "Importing…".to_string()
                        } else {
                            let n = picked.with(HashSet::len);
                            if n > 0 { format!("Import {n}") } else { "Import".into() }
                        }
                    })
                    kind=ButtonKind::Primary
                    disabled=Signal::derive(move || busy.get() || picked.with(HashSet::is_empty))
                    on_press=Callback::new(move |_| run())
                />
            </div>
        </Dialog>
    }
}

#[component]
fn AddProjectDialog() -> impl IntoView {
    let app = crate::state::get();
    let l = list::get();
    let open = Signal::derive(move || l.sheet.with(|s| s == &Some(Sheet::AddProject)));
    let picked = RwSignal::new(None::<String>);
    let cwd = RwSignal::new(None::<String>);
    let err = RwSignal::new(None::<String>);
    // Nothing selected inside the listed folder means the listed folder itself.
    let target = move || picked.get().or_else(|| cwd.get());
    let add = move || {
        let Some(t) = target() else { return };
        let Ok(c) = projects::need() else { return };
        spawn_local(async move {
            match projects::add_project(&c, &t).await {
                Ok(()) => l.close(),
                Err(e) => err.set(Some(e)),
            }
        });
    };
    let host = move || {
        app.conn
            .active_link()
            .server_name
            .unwrap_or_else(|| "host".into())
    };
    view! {
        <Dialog open=open on_close=Callback::new(move |_| l.close()) title="Add a project".to_string() width=740.0>
            {move || open.get().then(|| view! {
                <FolderBrowser picked=picked cwd=cwd host_id=None />
            })}
            {err_line(err)}
            <div class="sheet-actions">
                <span class="sheet-foot">{move || format!("Host: {}", host())}</span>
                <Button label="Cancel" on_press=Callback::new(move |_| l.close()) />
                <Button
                    label=Signal::derive(move || {
                        target()
                            .map(|t| format!("Add {}", Some(paths::base_name(&t)).filter(|b| !b.is_empty()).unwrap_or(t)))
                            .unwrap_or_else(|| "Add project".into())
                    })
                    kind=ButtonKind::Primary
                    disabled=Signal::derive(move || target().is_none())
                    on_press=Callback::new(move |_| add())
                />
            </div>
        </Dialog>
    }
}
