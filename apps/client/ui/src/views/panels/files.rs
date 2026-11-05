//! Files (ui-next `Files.tsx`, `tools/FileViewer.tsx`): a lazily listed tree under the
//! session's checkout or a typed folder, with change letters from source control, entry actions,
//! downloads, and a tabbed viewer (frogg-render `Code`, images, binaries).

use std::collections::HashMap;

use frogg_render::Code;
use leptos::prelude::*;
use leptos::task::spawn_local;

use super::util::{download_bytes, human_size, Ask, Confirm, Prompt, PromptSpec};
use crate::components::{Brackets, Ico, Icon, Menu, MenuItem, SkeletonRows};
use crate::shell::panel_head::PanelHead;
use crate::shell::toast::{Toast, ToastKind};
use crate::state::checkout::{base_name, online, session_cwd};
use crate::state::files::{parent_of, store, Entry, Listing};
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
            <div class="panel-scroll">
                {move || cwd.get().map(|_| view! { <Dir path=".".to_string() depth=0 ask=ask prompt=prompt /> })}
            </div>
            <Confirm ask=ask />
            <Prompt spec=prompt />
        </div>
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
    let items = entry_menu(&e, mark.get_untracked().is_some(), ask, prompt);
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
                <Menu open=menu on_close=Callback::new(move |_| menu.set(false)) items=items align_right=true />
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

/// The open file: tabs, a breadcrumb head and the content.
#[component]
pub fn FileViewer(
    path: String,
    #[prop(optional_no_strip)] on_back: Option<Callback<()>>,
) -> impl IntoView {
    let app = state::get();
    let f = store();
    // Single click previews; the tab bar lists every open file.
    f.preview_tab(&path);
    let tabs = move || {
        f.tabs
            .get()
            .into_iter()
            .map(|t| {
                let on = app.ui.file_path.get().as_deref() == Some(t.as_str());
                let preview = f.preview.get().as_deref() == Some(t.as_str());
                let (t1, t2, t3) = (t.clone(), t.clone(), t.clone());
                view! {
                    <div class="pn-tab" class:on=on>
                        <button
                            class="pn-tab-name"
                            class:preview=preview
                            on:click=move |_| app.ui.open_file(Some(t1.clone()))
                            on:dblclick=move |_| f.pin_tab(&t2)
                        >
                            <Icon ico=Ico::File size=12.0 class=if on { "cyan2" } else { "faint" } />
                            <span>{base_name(&t)}</span>
                        </button>
                        <button
                            class="icon-btn"
                            aria-label="Close tab"
                            on:click=move |_| {
                                let next = f.tabs.with_untracked(|ts| {
                                    let i = ts.iter().position(|x| *x == t3);
                                    i.and_then(|i| ts.get(i + 1).or_else(|| i.checked_sub(1).and_then(|j| ts.get(j))).cloned())
                                });
                                f.close_tabs(std::slice::from_ref(&t3));
                                if on {
                                    app.ui.open_file(next);
                                }
                            }
                        >
                            <Icon ico=Ico::X size=11.0 class="faint" />
                        </button>
                    </div>
                }
            })
            .collect_view()
    };
    let doc = LocalResource::new({
        let path = path.clone();
        move || {
            let path = path.clone();
            f.root.track();
            async move { store().read(path).await }
        }
    });
    let crumbs = {
        let parent = parent_of(&path);
        if parent == "." {
            String::new()
        } else {
            parent.replace('/', " / ")
        }
    };
    let name = base_name(&path);
    let p_dl = path.clone();
    let p_copy = path.clone();
    view! {
        <div class="detail pn-viewer">
            {on_back.is_none().then(|| view! { <div class="pn-tabs">{tabs}</div> })}
            <div class="pn-viewer-head">
                <div class="pn-viewer-titles">
                    {(!crumbs.is_empty()).then(|| view! { <span class="pn-crumbs t-mono">{crumbs.clone()}</span> })}
                    <div class="pn-viewer-title-row">
                        {on_back.map(|b| view! {
                            <button class="icon-btn" aria-label="Back" on:click=move |_| b.run(())>
                                <Icon ico=Ico::ChevronLeft size=18.0 class="cyan2" />
                            </button>
                        })}
                        <span class="t-display pn-viewer-title">{name}</span>
                        {move || {
                            doc.get()
                                .and_then(|d| d.ok())
                                .map(|d| view! { <span class="t-mono faint pn-viewer-size">{human_size(d.size)}</span> })
                        }}
                    </div>
                </div>
                <span class="spacer"></span>
                <button class="icon-btn" aria-label="Copy path" on:click=move |_| frogg_render::code::copy_text(&p_copy)>
                    <Icon ico=Ico::Copy size=14.0 class="faint" />
                </button>
                <button class="icon-btn" aria-label="Download" on:click=move |_| download_entry(p_dl.clone(), false)>
                    <Icon ico=Ico::Download size=14.0 class="faint" />
                </button>
                <button class="icon-btn" aria-label="Reload" on:click=move |_| doc.refetch()>
                    <Icon ico=Ico::RefreshCw size=14.0 class="faint" />
                </button>
            </div>
            <div class="pn-viewer-body">
                {move || match doc.get() {
                    None => view! { <SkeletonRows rows=10 icon=false /> }.into_any(),
                    Some(Err(e)) => view! { <div class="pn-error t-mono">{e}</div> }.into_any(),
                    Some(Ok(d)) => render_doc(&path, d).into_any(),
                }}
            </div>
        </div>
    }
}

fn render_doc(path: &str, d: crate::state::files::Doc) -> impl IntoView {
    if let Some(text) = d.text {
        let lang = path.to_owned();
        return view! { <Code code=text lang=lang line_numbers=true /> }.into_any();
    }
    if d.kind == "image" {
        let url = blob_url(&d.bytes, &d.mime);
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
