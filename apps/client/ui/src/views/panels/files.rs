//! Files (ui-next `Files.tsx`, `tools/FileViewer.tsx`): a lazily listed tree under the
//! session's checkout or a typed folder, with change letters from source control, entry actions,
//! downloads, and a tabbed viewer (frogg-render `Code`, images, binaries).

use std::collections::HashMap;

use frogg_render::Code;
use leptos::prelude::*;
use leptos::task::spawn_local;

use super::util::{download_bytes, human_size, Ask, Confirm, Prompt, PromptSpec};
use crate::components::{
    Brackets, Button, ButtonKind, Ico, Icon, Menu, MenuItem, Seg, SkeletonRows,
};
use crate::shell::panel_head::PanelHead;
use crate::shell::toast::{Toast, ToastKind};
use crate::state::checkout::{base_name, online, session_cwd};
use crate::state::files::{parent_of, store, Doc, Entry, Listing};
use crate::state::{self};

/// Double-click window that keeps a preview tab.
const DOUBLE_MS: f64 = 350.0;

/// Change letters (A / D / M) for files in the checkout's diff, keyed by path.
fn change_marks() -> HashMap<String, (&'static str, &'static str)> {
    let scm = crate::state::scm::store();
    scm.files.with(|f| {
        f.iter()
            .flatten()
            .map(|f| (f.path.clone(), f.mark()))
            .collect()
    })
}

fn toast_err(title: &str, e: String) {
    state::get()
        .toasts
        .push(Toast::new(ToastKind::Error, title.to_owned()).detail(e));
}

/// Downloads a file, or a folder as a zip.
pub fn download_entry(path: String, dir: bool) {
    spawn_local(async move {
        match store().fetch_download(path, dir).await {
            Ok((name, mime, bytes)) => {
                if let Err(e) = download_bytes(&name, &mime, &bytes) {
                    toast_err("Download failed", e);
                }
            }
            Err(e) => toast_err("Download failed", e),
        }
    });
}

fn new_entry_spec(parent: String, kind: &'static str) -> PromptSpec {
    let app = state::get();
    let what = if kind == "file" { "file" } else { "folder" };
    PromptSpec::new(
        if parent == "." {
            "Files".to_owned()
        } else {
            format!("Files · {parent}")
        },
        format!("New {what}"),
        "",
        format!("Create {what}"),
        move |name: String| {
            let parent = parent.clone();
            async move {
                let path = if parent == "." {
                    name.clone()
                } else {
                    format!("{parent}/{name}")
                };
                let f = store();
                let err = f.create(parent.clone(), name, kind).await;
                if err.is_none() {
                    if parent != "." {
                        f.expanded.update(|e| {
                            e.insert(parent);
                        });
                    }
                    if kind == "file" {
                        app.ui.open_file(Some(path));
                    }
                }
                err
            }
        },
    )
}

#[component]
pub fn FilesPanel() -> impl IntoView {
    let f = store();
    let checkout = Memo::new(move |_| session_cwd());
    // Opening another session goes back to its checkout.
    Effect::new(move |prev: Option<Option<String>>| {
        let c = checkout.get();
        if prev.is_some_and(|p| p != c) {
            f.browse.set(None);
        }
        c
    });
    let cwd = Memo::new(move |_| f.browse.get().or_else(|| checkout.get()));
    Effect::new(move |_| {
        if let (Some(c), true) = (cwd.get(), online()) {
            f.set_root(c);
        }
    });
    // Change letters need the checkout's diff watched.
    Effect::new(move |_| {
        if let (Some(c), true, None) = (checkout.get(), online(), f.browse.get()) {
            crate::state::scm::store().watch(c);
        }
    });
    let ask = RwSignal::new(None::<Ask>);
    let prompt = RwSignal::new(None::<PromptSpec>);
    let go_to = RwSignal::new(false);
    let searching = RwSignal::new(false);
    let query = RwSignal::new(String::new());
    let no_root = Signal::derive(move || cwd.get().is_none());
    let branch = Memo::new(move |_| {
        if f.browse.get().is_some() {
            return None;
        }
        crate::state::scm::store().branch()
    });
    view! {
        <div class="panel pn">
            <PanelHead title="Files">
                <button class="icon-btn" aria-label="Search files" disabled=no_root
                    class:pn-on=move || searching.get()
                    on:click=move |_| {
                        searching.update(|v| *v = !*v);
                        query.set(String::new());
                    }>
                    <Icon ico=Ico::Search size=14.0 />
                </button>
                <button class="icon-btn" aria-label="New file" disabled=no_root
                    on:click=move |_| prompt.set(Some(new_entry_spec(".".into(), "file")))>
                    <Icon ico=Ico::FilePlus size=14.0 class="faint" />
                </button>
                <button class="icon-btn" aria-label="New folder" disabled=no_root
                    on:click=move |_| prompt.set(Some(new_entry_spec(".".into(), "directory")))>
                    <Icon ico=Ico::FolderPlus size=14.0 class="faint" />
                </button>
                <button class="icon-btn" aria-label="Download folder as zip" disabled=no_root
                    on:click=move |_| download_entry(".".into(), true)>
                    <Icon ico=Ico::Download size=14.0 class="faint" />
                </button>
                <button class="icon-btn" aria-label="Refresh files" on:click=move |_| f.load_dir(".".into())>
                    <Icon ico=Ico::RefreshCw size=14.0 class="faint" />
                </button>
            </PanelHead>
            {move || {
                if go_to.get() {
                    view! { <PathField initial=cwd.get_untracked().unwrap_or_else(|| "~".into()) on_close=Callback::new(move |_| go_to.set(false)) /> }.into_any()
                } else {
                    let browsing = f.browse.get().is_some();
                    let label = match cwd.get() {
                        None => "open a session, or click to type a path".to_owned(),
                        Some(c) if browsing => c,
                        Some(c) => base_name(&c),
                    };
                    view! {
                        <div class="pn-root">
                            <button
                                class="pn-root-name"
                                class:t-mono=browsing
                                aria-label="Go to folder"
                                on:click=move |_| go_to.set(true)
                            >
                                {label}
                            </button>
                            {move || branch.get().map(|b| view! { <span class="pn-root-branch t-mono">{format!("⎇ {b}")}</span> })}
                            {browsing.then(|| view! {
                                <button class="icon-btn" aria-label="Back to the session's checkout" on:click=move |_| f.browse.set(None)>
                                    <Icon ico=Ico::X size=12.0 class="faint" />
                                </button>
                            })}
                        </div>
                    }
                    .into_any()
                }
            }}
            {move || searching.get().then(|| view! {
                <SearchField query=query on_close=Callback::new(move |_| { searching.set(false); query.set(String::new()); }) />
            })}
            <div class="panel-scroll">
                {move || {
                    if searching.get() && !query.get().trim().is_empty() {
                        return view! { <SearchResults query=query /> }.into_any();
                    }
                    cwd.get().map(|_| view! { <Dir path=".".to_string() depth=0 ask=ask prompt=prompt /> }).into_any()
                }}
            </div>
            <Confirm ask=ask />
            <Prompt spec=prompt />
        </div>
    }
}

const SEARCH_LIMIT: i64 = 100;

/// The search field under the Files header (ui-next `tools/FileSearch.tsx`). Esc clears, then
/// closes.
#[component]
fn SearchField(query: RwSignal<String>, on_close: Callback<()>) -> impl IntoView {
    let input = NodeRef::<leptos::html::Input>::new();
    Effect::new(move |_| {
        if let Some(i) = input.get() {
            let _ = i.focus();
        }
    });
    view! {
        <div class="pn-file-search">
            <Icon ico=Ico::Search size=13.0 class="faint" />
            <input
                node_ref=input
                class="pn-file-search-input"
                aria-label="Search files"
                placeholder="Search files by name"
                autocapitalize="off"
                autocomplete="off"
                spellcheck="false"
                prop:value=move || query.get()
                on:input=move |e| query.set(event_target_value(&e))
                on:keydown=move |e| {
                    if e.key() == "Escape" {
                        if query.get_untracked().is_empty() {
                            on_close.run(());
                        } else {
                            query.set(String::new());
                        }
                    }
                }
            />
            <button class="icon-btn" aria-label="Close search" on:click=move |_| on_close.run(())>
                <Icon ico=Ico::X size=13.0 class="faint" />
            </button>
        </div>
    }
}

/// Fuzzy file-name matches across the root, through the daemon's directory suggestions (the
/// protocol has no content search, so names only). Debounced.
#[component]
fn SearchResults(query: RwSignal<String>) -> impl IntoView {
    let app = state::get();
    let f = store();
    let hits = RwSignal::new(None::<Result<Vec<String>, String>>);
    let seq = StoredValue::new(0u64);
    Effect::new(move |_| {
        let q = query.get().trim().to_owned();
        f.root.track();
        seq.update_value(|s| *s += 1);
        let mine = seq.get_value();
        if q.is_empty() {
            hits.set(None);
            return;
        }
        set_timeout(
            move || {
                if seq.try_get_value() != Some(mine) {
                    return;
                }
                spawn_local(async move {
                    let r = store().search(q, SEARCH_LIMIT).await;
                    if seq.try_get_value() == Some(mine) {
                        hits.set(Some(r));
                    }
                });
            },
            std::time::Duration::from_millis(120),
        );
    });
    let last = StoredValue::new(0.0f64);
    move || {
        match hits.get() {
        None => view! { <SkeletonRows rows=5 indent=6.0 /> }.into_any(),
        Some(Err(e)) => view! { <div class="pn-error t-mono">{e}</div> }.into_any(),
        Some(Ok(list)) if list.is_empty() => view! {
            <div class="pn-empty pn-muted">{format!("No file names match “{}”.", query.get_untracked().trim())}</div>
        }
        .into_any(),
        Some(Ok(list)) => {
            let n = list.len();
            view! {
                <div class="t-label pn-search-count">
                    {if n as i64 == SEARCH_LIMIT { format!("first {SEARCH_LIMIT} matches") } else { format!("{n} matches") }}
                    " · names only"
                </div>
                {list
                    .into_iter()
                    .map(|p| {
                        let (name, dir) = match p.rfind('/') {
                            Some(i) => (p[i + 1..].to_owned(), p[..i].to_owned()),
                            None => (p.clone(), String::new()),
                        };
                        let p2 = p.clone();
                        let on = Memo::new(move |_| app.ui.file_path.get().as_deref() == Some(p2.as_str()));
                        view! {
                            <div
                                class="pn-node"
                                class:on=move || on.get()
                                role="button"
                                tabindex="0"
                                on:click=move |_| {
                                    let now = js_sys::Date::now();
                                    app.ui.open_file(Some(p.clone()));
                                    if now - last.get_value() < DOUBLE_MS {
                                        f.pin_tab(&p);
                                    }
                                    last.set_value(now);
                                }
                            >
                                <Brackets on=on len=6.0 />
                                <span class="pn-muted"><Icon ico=Ico::File size=14.0 /></span>
                                <span class="pn-node-name">{name}</span>
                                <span class="t-mono faint pn-hit-dir">{dir}</span>
                            </div>
                        }
                    })
                    .collect_view()}
            }
            .into_any()
        }
    }
    }
}

/// The typed-path field (ui-next `tools/FilePath.tsx`).
#[component]
fn PathField(initial: String, on_close: Callback<()>) -> impl IntoView {
    let app = state::get();
    let value = RwSignal::new(initial);
    let error = RwSignal::new(None::<String>);
    let input = NodeRef::<leptos::html::Input>::new();
    Effect::new(move |_| {
        if let Some(i) = input.get() {
            let _ = i.focus();
            i.select();
        }
    });
    let go = move || {
        let v = value.get_untracked();
        spawn_local(async move {
            match store().jump_to(v).await {
                Ok(file) => {
                    on_close.run(());
                    if let Some(name) = file {
                        app.ui.open_file(Some(name));
                    }
                }
                Err(e) => error.set(Some(e)),
            }
        });
    };
    view! {
        <div class="pn-path">
            <input
                node_ref=input
                class="input t-mono pn-path-input"
                placeholder="~/projects or C:/Users"
                prop:value=move || value.get()
                on:input=move |e| {
                    value.set(event_target_value(&e));
                    error.set(None);
                }
                on:keydown=move |e| match e.key().as_str() {
                    "Enter" => go(),
                    "Escape" => on_close.run(()),
                    _ => {}
                }
                on:blur=move |_| {
                    // Enter closes the field first; the blur that follows finds it disposed.
                    if error.try_get_untracked().is_some_and(|e| e.is_none()) {
                        on_close.run(());
                    }
                }
            />
            {move || error.get().map(|e| view! { <span class="pn-error-inline t-mono">{e}</span> })}
        </div>
    }
}

#[component]
fn Dir(
    path: String,
    depth: usize,
    ask: RwSignal<Option<Ask>>,
    prompt: RwSignal<Option<PromptSpec>>,
) -> impl IntoView {
    let f = store();
    let p = path.clone();
    let listing = Memo::new(move |_| f.dirs.with(|d| d.get(&p).cloned()));
    let indent = 16 + depth * 14;
    move || {
        match listing.get() {
        None | Some(Listing::Loading) => view! {
            <SkeletonRows rows=if depth == 0 { 7 } else { 3 } indent=(6 + depth * 14) as f64 />
        }
        .into_any(),
        Some(Listing::Error(e)) => view! {
            <div class="pn-error t-mono" style=format!("padding-left:{indent}px")>{e}</div>
        }
        .into_any(),
        Some(Listing::Entries(list)) if list.is_empty() => view! {
            <div class="t-label pn-empty-row" style=format!("padding-left:{indent}px")>"empty folder"</div>
        }
        .into_any(),
        Some(Listing::Entries(list)) => list
            .into_iter()
            .enumerate()
            .map(|(i, e)| view! { <Node e=e i=i depth=depth ask=ask prompt=prompt /> })
            .collect_view()
            .into_any(),
    }
    }
}

#[component]
fn Node(
    e: Entry,
    i: usize,
    depth: usize,
    ask: RwSignal<Option<Ask>>,
    prompt: RwSignal<Option<PromptSpec>>,
) -> impl IntoView {
    let app = state::get();
    let f = store();
    let dir = e.is_dir();
    let path = StoredValue::new(e.path.clone());
    let open = Memo::new(move |_| f.expanded.with(|x| path.with_value(|p| x.contains(p))));
    let on =
        Memo::new(move |_| app.ui.file_path.get().as_deref() == Some(path.get_value().as_str()));
    let mark = Memo::new(move |_| {
        if f.browse.get().is_some() {
            return None;
        }
        change_marks().get(&path.get_value()).copied()
    });
    let last = StoredValue::new(0.0f64);
    let press = move |_| {
        let p = path.get_value();
        if dir {
            f.toggle_dir(&p);
            return;
        }
        let now = js_sys::Date::now();
        app.ui.open_file(Some(p.clone()));
        if now - last.get_value() < DOUBLE_MS {
            f.pin_tab(&p);
        }
        last.set_value(now);
    };
    let menu = RwSignal::new(false);
    let entry = StoredValue::new(e.clone());
    let ico = Signal::derive(move || match (dir, open.get()) {
        (false, _) => Ico::File,
        (true, true) => Ico::FolderOpen,
        (true, false) => Ico::Folder,
    });
    let ico_class = move || match (dir, on.get()) {
        (true, _) => "pn-ico-dir",
        (false, true) => "cyan2",
        (false, false) => "pn-muted",
    };
    view! {
        <div class="pn-node-wrap" style=format!("animation-delay:{}ms", i.min(12) * 18)>
            <div
                class="pn-node"
                class:on=move || on.get()
                style=format!("padding-left:{}px", 6 + depth * 14)
                role="button"
                tabindex="0"
                on:click=press
                on:contextmenu=move |ev| {
                    ev.prevent_default();
                    menu.set(true);
                }
            >
                <Brackets on=on len=6.0 />
                {if dir {
                    view! {
                        <span class="pn-chev" class:open=move || open.get()>
                            <Icon ico=Ico::ChevronRight size=12.0 />
                        </span>
                    }
                    .into_any()
                } else {
                    view! { <span class="pn-chev-sp"></span> }.into_any()
                }}
                <span class=ico_class><Icon ico=ico size=14.0 /></span>
                <span class="pn-node-name">{e.name.clone()}</span>
                <button
                    class="icon-btn pn-hover"
                    aria-label=format!("{} actions", e.name)
                    on:click=move |ev| {
                        ev.stop_propagation();
                        menu.set(true);
                    }
                >
                    <Icon ico=Ico::MoreHorizontal size=13.0 class="faint" />
                </button>
                {move || mark.get().map(|(l, tint)| view! { <span class=format!("pn-mark t-mono {tint}")>{l}</span> })}
                // Built on open, so "Discard changes" follows the live diff.
                {move || menu.get().then(|| {
                    let items = entry.with_value(|e| entry_menu(e, mark.get_untracked().is_some(), ask, prompt));
                    view! { <Menu open=menu on_close=Callback::new(move |_| menu.set(false)) items=items align_right=true /> }
                })}
            </div>
            {move || (dir && open.get()).then(|| view! { <Dir path=path.get_value() depth=depth + 1 ask=ask prompt=prompt /> })}
        </div>
    }
}

/// The round-4 file menu, limited to what the daemon can do.
fn entry_menu(
    e: &Entry,
    changed: bool,
    ask: RwSignal<Option<Ask>>,
    prompt: RwSignal<Option<PromptSpec>>,
) -> Vec<MenuItem> {
    let app = state::get();
    let f = store();
    let dir = e.is_dir();
    let (path, name) = (e.path.clone(), e.name.clone());
    let abs = f
        .root
        .get_untracked()
        .map(|r| format!("{}/{}", r.trim_end_matches('/'), path))
        .unwrap_or_else(|| path.clone());
    let mut items = Vec::new();
    if dir {
        let p = path.clone();
        items.push(
            MenuItem::new("New file…", move || {
                prompt.set(Some(new_entry_spec(p.clone(), "file")))
            })
            .icon(Ico::FilePlus),
        );
        let p = path.clone();
        items.push(
            MenuItem::new("New folder…", move || {
                prompt.set(Some(new_entry_spec(p.clone(), "directory")))
            })
            .icon(Ico::FolderPlus),
        );
    } else {
        let p = path.clone();
        items.push(MenuItem::new("Open", move || app.ui.open_file(Some(p.clone()))).hint("↵"));
    }
    let p = path.clone();
    items.push(
        MenuItem::new(
            if dir { "Download as zip" } else { "Download" },
            move || download_entry(p.clone(), dir),
        )
        .icon(Ico::Download),
    );
    items.push(
        MenuItem::new("Copy path", move || frogg_render::code::copy_text(&abs)).icon(Ico::Copy),
    );
    let p = path.clone();
    items.push(MenuItem::new("Copy relative path", move || {
        frogg_render::code::copy_text(&p)
    }));
    let (p, n) = (path.clone(), name.clone());
    items.push(
        MenuItem::new("Rename…", move || {
            let parent = parent_of(&p);
            let p = p.clone();
            prompt.set(Some(PromptSpec::new(
                if parent == "." {
                    "Files".to_owned()
                } else {
                    format!("Files · {parent}")
                },
                format!("Rename {n}"),
                n.clone(),
                "Rename",
                move |name| {
                    let p = p.clone();
                    async move { store().rename(p, name).await }
                },
            )))
        })
        .hint("F2")
        .icon(Ico::Pencil),
    );
    let (p, n) = (path.clone(), name.clone());
    items.push(MenuItem::new("Duplicate…", move || {
        let p = p.clone();
        ask.set(Some(Ask::new(
            format!("Duplicate {n}?"),
            "Creates a copy beside the original.",
            "Duplicate",
            move || {
                let p = p.clone();
                spawn_local(async move {
                    if let Some(e) = store().duplicate(p).await {
                        toast_err("Could not duplicate", e);
                    }
                });
            },
        )))
    }));
    if changed {
        let (p, n) = (path.clone(), name.clone());
        items.push(
            MenuItem::new("Discard changes…", move || {
                let p = p.clone();
                ask.set(Some(
                    Ask::new(
                        format!("Discard changes to {n}?"),
                        "Restores the file to its last committed state. This cannot be undone.",
                        "Discard changes",
                        move || crate::state::scm::store().discard(vec![p.clone()]),
                    )
                    .danger(),
                ))
            })
            .danger(),
        );
    }
    let (p, n) = (path, name);
    items.push(
        MenuItem::new("Delete…", move || {
            let p = p.clone();
            ask.set(Some(
                Ask::new(
                    format!("Delete {n}?"),
                    if dir {
                        "Deletes the folder and everything in it from the checkout."
                    } else {
                        "Deletes the file from the checkout."
                    },
                    "Delete",
                    move || {
                        let p = p.clone();
                        spawn_local(async move {
                            match store().delete(p.clone()).await {
                                Some(e) => toast_err("Could not delete", e),
                                None => {
                                    if app.ui.file_path.get_untracked().as_deref() == Some(&p) {
                                        app.ui.open_file(None);
                                    }
                                }
                            }
                        });
                    },
                )
                .danger(),
            ))
        })
        .danger(),
    );
    items
}

/// An unsaved edit: the text and the doc it was made against (for conflict-checked saves).
#[derive(Clone)]
struct Draft {
    doc: Doc,
    text: String,
}

thread_local! {
    static DRAFTS: ArcRwSignal<HashMap<String, Draft>> = ArcRwSignal::new(HashMap::new());
}

/// Unsaved edits by `root:path` (ui-next `useFileDocument` drafts), kept across tab switches.
fn drafts() -> ArcRwSignal<HashMap<String, Draft>> {
    DRAFTS.with(Clone::clone)
}

fn draft_key(path: &str) -> String {
    format!(
        "{}:{path}",
        store().root.get_untracked().unwrap_or_default()
    )
}

/// Whether a file has unsaved edits.
fn has_draft(path: &str) -> bool {
    let k = draft_key(path);
    drafts().with_untracked(|d| d.contains_key(&k))
}

/// Closes tabs and, when the open one went, opens its neighbour.
fn close_and_pick(closing: Vec<String>, path: &str, on: bool) {
    let app = state::get();
    let f = store();
    let next = f.tabs.with_untracked(|ts| {
        let i = ts.iter().position(|x| x == path)?;
        let right = ts[i + 1..].iter().find(|p| !closing.contains(p));
        let left = ts[..i].iter().rev().find(|p| !closing.contains(p));
        right.or(left).cloned()
    });
    f.close_tabs(&closing);
    if on {
        app.ui.open_file(next);
    }
}

/// The open file's tab strip: tab menus (keep, copy, close variants) and "+" for a new entry.
#[component]
fn FileTabs(
    active: String,
    dirty: Signal<bool>,
    prompt: RwSignal<Option<PromptSpec>>,
) -> impl IntoView {
    let f = store();
    let plus = RwSignal::new(false);
    let parent = parent_of(&active);
    let plus_items = {
        let (p1, p2) = (parent.clone(), parent);
        vec![
            MenuItem::new("New file…", move || {
                prompt.set(Some(new_entry_spec(p1.clone(), "file")))
            })
            .icon(Ico::FilePlus),
            MenuItem::new("New folder…", move || {
                prompt.set(Some(new_entry_spec(p2.clone(), "directory")))
            })
            .icon(Ico::FolderPlus),
        ]
    };
    let active = StoredValue::new(active);
    // One tab menu for the strip, outside its scroller so it isn't clipped.
    let bar = NodeRef::<leptos::html::Div>::new();
    let tab_menu = RwSignal::new(None::<(Vec<MenuItem>, f64)>);
    let open_menu = Callback::new(move |(items, x): (Vec<MenuItem>, f64)| {
        let left = bar
            .get_untracked()
            .map(|b| b.get_bounding_client_rect().left())
            .unwrap_or(0.0);
        tab_menu.set(Some((items, (x - left).max(0.0))));
    });
    let menu_open = Signal::derive(move || tab_menu.with(Option::is_some));
    view! {
        <div class="pn-tabs" node_ref=bar>
            {move || tab_menu.get().map(|(items, x)| view! {
                <div class="pn-tab-menu" style=format!("left:{x}px")>
                    <Menu open=menu_open on_close=Callback::new(move |_| tab_menu.set(None)) items=items />
                </div>
            })}
            <div class="pn-tabs-in">
                {move || {
                    f.tabs
                        .get()
                        .into_iter()
                        .map(|t| {
                            let on = active.with_value(|a| *a == t);
                            let preview = f.preview.get().as_deref() == Some(t.as_str());
                            view! { <FileTab path=t on=on preview=preview dirty=Signal::derive(move || on && dirty.get()) open_menu=open_menu /> }
                        })
                        .collect_view()
                }}
            </div>
            <div class="pn-rel">
                <button class="icon-btn pn-tab-plus" aria-label="New tab" on:click=move |_| plus.set(true)>
                    <Icon ico=Ico::Plus size=13.0 class="faint" />
                </button>
                <Menu open=plus on_close=Callback::new(move |_| plus.set(false)) items=plus_items align_right=true />
            </div>
        </div>
    }
}

#[component]
fn FileTab(
    path: String,
    on: bool,
    preview: bool,
    dirty: Signal<bool>,
    open_menu: Callback<(Vec<MenuItem>, f64)>,
) -> impl IntoView {
    let app = state::get();
    let f = store();
    let el = NodeRef::<leptos::html::Div>::new();
    let path = StoredValue::new(path);
    let unsaved = Memo::new(move |_| {
        drafts().track();
        path.with_value(|p| has_draft(p))
    });
    let items = move || {
        let p = path.get_value();
        let tabs = f.tabs.get_untracked();
        let any_draft = tabs.iter().any(|t| has_draft(t));
        let idx = tabs.iter().position(|t| *t == p).unwrap_or(0);
        let abs = f
            .root
            .get_untracked()
            .map(|r| format!("{}/{}", r.trim_end_matches('/'), p))
            .unwrap_or_else(|| p.clone());
        let mut items = Vec::new();
        if preview {
            let p = p.clone();
            items.push(MenuItem::new("Keep open", move || f.pin_tab(&p)));
        }
        items.push(
            MenuItem::new("Copy path", move || frogg_render::code::copy_text(&abs)).icon(Ico::Copy),
        );
        let p2 = p.clone();
        items.push(MenuItem::new("Copy relative path", move || {
            frogg_render::code::copy_text(&p2)
        }));
        if !unsaved.get_untracked() {
            let p2 = p.clone();
            items.push(
                MenuItem::new("Close", move || close_and_pick(vec![p2.clone()], &p2, on))
                    .hint("⌘W"),
            );
        }
        if tabs.len() > 1 && !any_draft {
            let others: Vec<String> = tabs.iter().filter(|t| **t != p).cloned().collect();
            let p2 = p.clone();
            items.push(MenuItem::new("Close others", move || {
                f.close_tabs(&others);
                app.ui.open_file(Some(p2.clone()));
            }));
        }
        if idx + 1 < tabs.len() && !any_draft {
            let right: Vec<String> = tabs[idx + 1..].to_vec();
            let p2 = p.clone();
            items.push(MenuItem::new("Close tabs to the right", move || {
                f.close_tabs(&right);
                if !on {
                    app.ui.open_file(Some(p2.clone()));
                }
            }));
        }
        items
    };
    let show = move || {
        let x = el
            .get_untracked()
            .map(|e| e.get_bounding_client_rect().left())
            .unwrap_or(0.0);
        open_menu.run((items(), x));
    };
    let name = path.with_value(|p| base_name(p));
    view! {
        <div
            class="pn-tab"
            class:on=on
            node_ref=el
            on:contextmenu=move |ev| {
                ev.prevent_default();
                show();
            }
        >
            <button
                class="pn-tab-name"
                class:preview=preview
                on:click=move |_| app.ui.open_file(Some(path.get_value()))
                on:dblclick=move |_| f.pin_tab(&path.get_value())
            >
                <Icon ico=Ico::File size=12.0 class=if on { "cyan2" } else { "faint" } />
                <span>{name.clone()}</span>
            </button>
            {move || dirty.get().then(|| view! { <span class="pn-tab-dirty"></span> })}
            <button
                class="icon-btn pn-tab-more"
                aria-label=format!("{name} tab actions")
                on:click=move |_| show()
            >
                <Icon ico=Ico::MoreHorizontal size=12.0 class="faint" />
            </button>
            <button
                class="icon-btn"
                aria-label=format!("Close {name}")
                disabled=move || unsaved.get()
                on:click=move |_| {
                    let p = path.get_value();
                    close_and_pick(vec![p.clone()], &p, on);
                }
            >
                <Icon ico=Ico::X size=11.0 class="faint" />
            </button>
        </div>
    }
}

/// The open file: tabs, a breadcrumb head, Source/Edit modes with save and revert, and the
/// content (ui-next `tools/FileViewer.tsx`).
#[component]
pub fn FileViewer(
    path: String,
    #[prop(optional_no_strip)] on_back: Option<Callback<()>>,
) -> impl IntoView {
    let f = store();
    // Single click previews unless the user pins every opened file.
    f.preview_tab(&path);
    if state::get().prefs.get_untracked::<bool>("autoPinTabs") {
        f.pin_tab(&path);
    }
    let mode = RwSignal::new("source".to_owned());
    let generation = RwSignal::new(0u32);
    // Bumped by a revert: the editor's textarea is uncontrolled, so it rebuilds from the file.
    let reverted = RwSignal::new(0u32);
    let saving = RwSignal::new(false);
    let save_error = RwSignal::new(None::<String>);
    let ask = RwSignal::new(None::<Ask>);
    let prompt = RwSignal::new(None::<PromptSpec>);
    let more = RwSignal::new(false);
    let path_s = StoredValue::new(path.clone());
    let key = Memo::new(move |_| {
        format!(
            "{}:{}",
            f.root.get().unwrap_or_default(),
            path_s.get_value()
        )
    });
    let doc = LocalResource::new(move || {
        f.root.track();
        generation.track();
        let path = path_s.get_value();
        async move { store().read(path).await }
    });
    let draft = Memo::new(move |_| {
        let k = key.get();
        drafts().with(|d| d.get(&k).map(|x| x.text.clone()))
    });
    let dirty = Signal::derive(move || draft.with(Option::is_some));
    // Editing a preview keeps it.
    Effect::new(move |_| {
        if dirty.get() || mode.get() == "edit" {
            f.pin_tab(&path_s.get_value());
        }
    });
    let clear = move || {
        let k = key.get_untracked();
        drafts().update(|d| {
            d.remove(&k);
        });
        save_error.set(None);
    };
    let revert = move || {
        clear();
        reverted.update(|n| *n += 1);
    };
    let edit = move |text: String| {
        let k = key.get_untracked();
        let base = drafts()
            .with_untracked(|d| d.get(&k).map(|x| x.doc.clone()))
            .or_else(|| doc.get_untracked().and_then(|d| d.ok()));
        let Some(base) = base else { return };
        if base.text.as_deref() == Some(text.as_str()) {
            clear();
            return;
        }
        drafts().update(|d| {
            d.insert(k, Draft { doc: base, text });
        });
    };
    let save = move || {
        let k = key.get_untracked();
        let Some(d) = drafts().with_untracked(|m| m.get(&k).cloned()) else {
            return;
        };
        if saving.get_untracked() {
            return;
        }
        saving.set(true);
        save_error.set(None);
        spawn_local(async move {
            let r = store()
                .write(path_s.get_value(), d.text.clone(), d.doc)
                .await;
            saving.set(false);
            match r {
                Ok(written) => {
                    // Keep newer typing made while the write was in flight.
                    drafts().update(|m| {
                        let same = m.get(&k).map(|x| x.text == d.text);
                        match same {
                            Some(true) => {
                                m.remove(&k);
                            }
                            Some(false) => {
                                if let Some(x) = m.get_mut(&k) {
                                    x.doc = written;
                                }
                            }
                            None => {}
                        }
                    });
                    generation.update(|g| *g += 1);
                }
                Err(e) => save_error.set(Some(e)),
            }
        });
    };
    let discard = move || {
        ask.set(Some(
            Ask::new(
                "Discard unsaved edits?",
                "Your edits to this file will be removed from the editor.",
                "Discard edits",
                revert,
            )
            .danger(),
        ))
    };
    // ⌘S / Ctrl+S saves while there is something to save.
    let handle = window_event_listener(leptos::ev::keydown, move |ev| {
        if (ev.meta_key() || ev.ctrl_key())
            && ev.key().eq_ignore_ascii_case("s")
            && dirty.get_untracked()
        {
            ev.prevent_default();
            save();
        }
    });
    on_cleanup(move || handle.remove());
    let more_items = move || {
        let p = path_s.get_value();
        let p2 = p.clone();
        let mut items = vec![
            MenuItem::new("Download", move || download_entry(p.clone(), false)).icon(Ico::Download),
            MenuItem::new("Copy relative path", move || {
                frogg_render::code::copy_text(&p2)
            }),
        ];
        let busy = saving.get_untracked();
        if !dirty.get_untracked() && !busy {
            items.push(MenuItem::new("Reload from disk", move || {
                generation.update(|g| *g += 1)
            }));
        }
        if dirty.get_untracked() && !busy {
            items.push(MenuItem::new("Discard unsaved edits…", discard).danger());
        }
        items
    };
    let crumbs = {
        let parent = parent_of(&path);
        if parent == "." {
            String::new()
        } else {
            parent.replace('/', " / ")
        }
    };
    let name = base_name(&path);
    let text = Memo::new(move |_| doc.get().and_then(|d| d.ok()).and_then(|d| d.text));
    view! {
        <div class="detail pn-viewer">
            {on_back.is_none().then(|| view! { <FileTabs active=path.clone() dirty=dirty prompt=prompt /> })}
            <div class="pn-viewer-head">
                <div class="pn-viewer-titles">
                    {(!crumbs.is_empty()).then(|| view! { <span class="pn-crumbs t-mono">{crumbs.clone()}</span> })}
                    <div class="pn-viewer-title-row">
                        {on_back.map(|b| view! {
                            <button class="icon-btn" aria-label="Back" on:click=move |_| b.run(())>
                                <Icon ico=Ico::ChevronLeft size=18.0 class="cyan2" />
                            </button>
                        })}
                        <span class="t-display pn-viewer-title">{name.clone()}</span>
                        {move || {
                            doc.get()
                                .and_then(|d| d.ok())
                                .map(|d| view! { <span class="t-mono faint pn-viewer-size">{human_size(d.size)}</span> })
                        }}
                    </div>
                </div>
                <span class="spacer"></span>
                {move || text.with(Option::is_some).then(|| view! {
                    <Seg
                        options=vec![("source".into(), "Source".into()), ("edit".into(), "Edit".into())]
                        value=mode
                        on_change=Callback::new(move |v| mode.set(v))
                    />
                })}
                {move || dirty.get().then(|| view! {
                    <Button label="Revert" disabled=saving on_press=Callback::new(move |_| discard()) />
                })}
                {move || (mode.get() == "edit").then(|| view! {
                    <Button
                        kind=ButtonKind::Primary
                        label=Signal::derive(move || if saving.get() { "Saving…".to_owned() } else { "Save".to_owned() })
                        disabled=Signal::derive(move || !dirty.get() || saving.get())
                        on_press=Callback::new(move |_| save())
                    />
                })}
                <button class="icon-btn" aria-label="Download file" on:click=move |_| download_entry(path_s.get_value(), false)>
                    <Icon ico=Ico::Download size=15.0 class="faint" />
                </button>
                <div class="pn-rel">
                    <button class="icon-btn" aria-label="Editor actions" on:click=move |_| more.set(true)>
                        <Icon ico=Ico::MoreHorizontal size=16.0 class="faint" />
                    </button>
                    {move || more.get().then(|| view! {
                        <Menu open=more on_close=Callback::new(move |_| more.set(false)) items=more_items() align_right=true />
                    })}
                </div>
            </div>
            {move || save_error.get().map(|e| view! { <div class="pn-error t-mono pn-save-error">{e}</div> })}
            <div class="pn-viewer-body">
                {move || match (reverted.track(), doc.get()).1 {
                    None => view! { <SkeletonRows rows=10 icon=false /> }.into_any(),
                    Some(Err(e)) => view! { <div class="pn-error t-mono">{e}</div> }.into_any(),
                    Some(Ok(d)) if d.text.is_some() && mode.get() == "edit" => {
                        let initial = draft.get_untracked().or(d.text).unwrap_or_default();
                        view! {
                            <textarea
                                class="pn-editor t-mono"
                                spellcheck="false"
                                autocapitalize="off"
                                autocomplete="off"
                                aria-label="File contents"
                                prop:value=initial
                                on:input=move |e| edit(event_target_value(&e))
                            ></textarea>
                        }
                        .into_any()
                    }
                    Some(Ok(mut d)) => {
                        if let Some(t) = draft.get() {
                            d.text = Some(t);
                        }
                        render_doc(&path_s.get_value(), d).into_any()
                    }
                }}
            </div>
            <div class="pn-viewer-status">
                <span class="t-mono pn-mode-chip" class:edit=move || mode.get() == "edit">
                    {move || if mode.get() == "edit" { "EDIT" } else { "VIEW" }}
                </span>
                <span class="t-mono faint">
                    {move || {
                        draft
                            .get()
                            .or_else(|| text.get())
                            .map(|t| format!("{} lines", t.split('\n').count()))
                            .unwrap_or_default()
                    }}
                </span>
                <span class="spacer"></span>
                {move || dirty.get().then(|| view! {
                    <span class="t-mono pn-unsaved">"◆ Unsaved · save or revert before closing"</span>
                })}
            </div>
            <Confirm ask=ask />
            <Prompt spec=prompt />
        </div>
    }
}

fn render_doc(path: &str, d: Doc) -> impl IntoView {
    if let Some(text) = d.text {
        let lang = path.to_owned();
        return view! { <Code code=text lang=lang line_numbers=true /> }.into_any();
    }
    if d.kind == "image" {
        let url = blob_url(&d.bytes, &d.mime);
        // The blob lives only as long as the image on screen.
        let revoke = url.clone();
        on_cleanup(move || {
            let _ = web_sys::Url::revoke_object_url(&revoke);
        });
        return view! { <div class="pn-image"><img src=url alt=base_name(path) /></div> }
            .into_any();
    }
    let p = path.to_owned();
    let too_big = d.kind == "text";
    view! {
        <div class="detail-empty">
            <Icon ico=Ico::File size=26.0 stroke=1.4 class="faint" />
            <span class="detail-note">
                {if too_big {
                    format!("{} is too large to show here.", human_size(d.size))
                } else {
                    format!("Binary file · {}", human_size(d.size))
                }}
            </span>
            <button class="btn btn-ghost" on:click=move |_| download_entry(p.clone(), false)>"Download"</button>
        </div>
    }
    .into_any()
}

fn blob_url(bytes: &[u8], mime: &str) -> String {
    let arr = js_sys::Uint8Array::from(bytes);
    let parts = js_sys::Array::of1(&arr);
    let opts = web_sys::BlobPropertyBag::new();
    opts.set_type(mime);
    web_sys::Blob::new_with_u8_array_sequence_and_options(&parts, &opts)
        .ok()
        .and_then(|b| web_sys::Url::create_object_url_with_blob(&b).ok())
        .unwrap_or_default()
}
