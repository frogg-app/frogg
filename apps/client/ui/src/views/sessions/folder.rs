//! Host folder browser (ui-next `FolderBrowser` in `sessions/sheets.tsx`). A tap selects a folder
//! (`picked`); tapping the selected one, an already-added project or a drive opens it. `cwd` holds
//! the listed folder so a picker can use it when nothing inside is selected. The path is
//! editable; on a Windows host, Up from a drive root lists the host's drives.

use leptos::prelude::*;
use leptos::task::spawn_local;

use crate::components::{Button, ButtonKind, Ico, Icon, SkeletonRows, TextInput};
use crate::state::projects::{self, DirEntry};
use crate::state::sessions::paths;

/// The listing above a Windows host's drive roots.
const DRIVES: &str = "";

#[component]
pub fn FolderBrowser(
    picked: RwSignal<Option<String>>,
    cwd: RwSignal<Option<String>>,
    /// The host to browse; the active host when None.
    host_id: Option<String>,
    /// A folder to start beside (its parent is listed); defaults to the first project's.
    #[prop(optional)]
    from: Option<String>,
    /// That host's project roots, marked "already added"; the active host's when omitted.
    #[prop(optional, into)]
    project_paths: Option<Signal<Vec<String>>>,
) -> impl IntoView {
    let app = crate::state::get();
    let d = projects::get();
    let host_id = StoredValue::new(host_id);
    let client = move || match host_id.get_value() {
        Some(h) => app
            .conn
            .client_of(&h)
            .ok_or_else(|| "Host offline".to_owned()),
        None => projects::need(),
    };
    let host_name = move || {
        match host_id.get_value() {
            Some(h) => app.hosts.find(&h).map(|x| x.name),
            None => app.conn.active_link().server_name,
        }
        .unwrap_or_else(|| "host".into())
    };
    let roots = Signal::derive(move || match project_paths {
        Some(p) => p.get(),
        None => d
            .projects
            .with(|ps| ps.iter().map(|p| p.project_root_path.clone()).collect()),
    });
    let start = from
        .or_else(|| roots.get_untracked().first().cloned())
        .map(|s| paths::parent(&s))
        .unwrap_or_else(|| "/".into());
    let dir = RwSignal::new(start.clone());
    let abs = RwSignal::new(start);
    let entries = RwSignal::new(None::<Vec<DirEntry>>);
    let err = RwSignal::new(None::<String>);
    let new_name = RwSignal::new(None::<String>);
    let new_text = RwSignal::new(String::new());
    let typed = RwSignal::new(None::<String>);
    let typed_text = RwSignal::new(String::new());
    let seq = StoredValue::new(0u32);
    let load = move |target: String, select: Option<String>| {
        entries.set(None);
        err.set(None);
        picked.set(select);
        cwd.set(None);
        seq.update_value(|s| *s += 1);
        let mine = seq.get_value();
        let c = match client() {
            Ok(c) => c,
            Err(e) => {
                entries.set(Some(Vec::new()));
                err.set(Some(e));
                return;
            }
        };
        spawn_local(async move {
            if target == DRIVES {
                let list = projects::list_drives(&c).await;
                if seq.try_get_value() == Some(mine) {
                    abs.set(DRIVES.into());
                    entries.set(Some(list));
                }
                return;
            }
            let res = projects::list_dir(&c, &target).await;
            if seq.try_get_value() != Some(mine) {
                return;
            }
            match res {
                Ok((path, list)) => {
                    abs.set(path.clone());
                    entries.set(Some(list));
                    cwd.set(Some(path));
                }
                Err(e) => {
                    entries.set(Some(Vec::new()));
                    err.set(Some(e));
                }
            }
        });
    };
    Effect::new(move |_| load(dir.get(), None));
    let drives = move || dir.get() == DRIVES;
    let can_up = move || {
        let a = abs.get();
        !drives() && (paths::is_windows(&a) || paths::parent(&a) != a)
    };
    let up = move || {
        let a = abs.get_untracked();
        if paths::is_windows(&a) && paths::is_drive_root(&a) {
            dir.set(DRIVES.into());
        } else {
            dir.set(paths::parent(&a));
        }
    };
    let create_dir = move || {
        let n = new_text.get_untracked().trim().to_owned();
        if n.is_empty() {
            return;
        }
        let Ok(c) = client() else { return };
        let parent = abs.get_untracked();
        spawn_local(async move {
            match projects::make_dir(&c, &parent, &n).await {
                Ok(()) => {
                    new_name.set(None);
                    // The new folder comes back selected, ready to use.
                    load(dir.get_untracked(), Some(paths::join(&parent, &n)));
                }
                Err(e) => err.set(Some(e)),
            }
        });
    };
    let go_typed = move || {
        let t = paths::typed(&typed_text.get_untracked());
        typed.set(None);
        if !t.is_empty() {
            dir.set(t);
        }
    };
    view! {
        <div class="browser">
            <div class="path-row">
                <Icon ico=Ico::Folder size=13.0 class="muted" />
                {move || {
                    if typed.get().is_none() {
                        view! {
                            <button class="t-mono path-press" aria-label="Type a path" on:click=move |_| {
                                typed_text.set(abs.get_untracked());
                                typed.set(Some(String::new()));
                            }>
                                {move || if drives() { format!("{}: drives", host_name()) } else { format!("{}:{}", host_name(), paths::tilde(&abs.get())) }}
                            </button>
                        }
                        .into_any()
                    } else {
                        view! {
                            <div class="path-input">
                                <TextInput value=typed_text mono=true autofocus=true placeholder="/home/you or D:\\" on_enter=Callback::new(move |_| go_typed()) />
                            </div>
                        }
                        .into_any()
                    }
                }}
                <button class="link" disabled=move || !can_up() aria-label="Up one folder" on:click=move |_| up()>"Up"</button>
                <button class="icon-btn" aria-label="Refresh" on:click=move |_| load(dir.get_untracked(), None)>
                    <Icon ico=Ico::RotateCw size=12.0 />
                </button>
                <Show when=move || !drives()>
                    <button class="link" on:click=move |_| {
                        new_text.set(String::new());
                        new_name.set(Some(String::new()));
                    }>"New folder"</button>
                </Show>
            </div>
            <Show when=move || new_name.get().is_some() && !drives()>
                <div class="new-row">
                    <div class="grow1">
                        <TextInput value=new_text autofocus=true placeholder="New folder name" on_enter=Callback::new(move |_| create_dir()) />
                    </div>
                    <Button label="Cancel" on_press=Callback::new(move |_| new_name.set(None)) />
                    <Button
                        label="Create"
                        kind=ButtonKind::Primary
                        disabled=Signal::derive(move || new_text.get().trim().is_empty())
                        on_press=Callback::new(move |_| create_dir())
                    />
                </div>
            </Show>
            <Show when=move || entries.with(Option::is_none)>
                <SkeletonRows rows=5 />
            </Show>
            <div class="dir-list">
                {move || {
                    let list = entries.get().unwrap_or_default();
                    let is_drives = drives();
                    if entries.with(Option::is_some) && list.is_empty() && err.get().is_none() {
                        return view! { <span class="dir-meta">{if is_drives { "No drives found." } else { "No folders here." }}</span> }.into_any();
                    }
                    let added: Vec<String> = roots.get();
                    list.into_iter()
                        .map(|e| {
                            let is_added = added.contains(&e.path);
                            let p = e.path.clone();
                            let p2 = e.path.clone();
                            let on = Signal::derive(move || picked.get().as_deref() == Some(p2.as_str()));
                            view! {
                                <button
                                    class="dir-row"
                                    class:on=move || on.get()
                                    on:click=move |_| {
                                        if on.get_untracked() || is_added || is_drives {
                                            dir.set(p.clone());
                                        } else {
                                            picked.set(Some(p.clone()));
                                        }
                                    }
                                >
                                    <Icon ico=if is_drives { Ico::HardDrive } else { Ico::Folder } size=13.0 class="faint" />
                                    <span class="dir-body">
                                        <span class="dir-name">{e.name.clone()}</span>
                                        {is_added.then(|| view! { <span class="dir-meta">"already added"</span> })}
                                    </span>
                                </button>
                            }
                        })
                        .collect_view()
                        .into_any()
                }}
            </div>
            {move || err.get().map(|t| view! { <span class="t-mono sheet-err">{t}</span> })}
        </div>
    }
}
