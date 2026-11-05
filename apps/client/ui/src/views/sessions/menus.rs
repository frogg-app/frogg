//! Session-list menus (ui-next `sessions/menus.tsx`): the scope switcher, the display popover and
//! the row context menu. Each pops at a screen point (an anchor's corner or the pointer) in a
//! fixed layer, so it is never clipped by the scrolling list.

use leptos::prelude::*;
use wasm_bindgen::JsCast;

use crate::components::{Ico, Icon, Seg, Select, SelectOption};
use crate::state::projects::{self, Directory};
use crate::state::sessions::{self as list, SessionExt, Sheet};
use crate::state::Session;

/// Where a popover opens: left/top of its box in viewport px.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct At {
    pub x: f64,
    pub y: f64,
}

/// Below the event's element (left-aligned, or right-aligned to it when `right`).
pub fn below(ev: &web_sys::MouseEvent, right: bool, width: f64) -> At {
    let rect = ev
        .current_target()
        .and_then(|t| t.dyn_into::<web_sys::Element>().ok())
        .map(|e| e.get_bounding_client_rect());
    match rect {
        Some(r) if right => At {
            x: r.right() - width,
            y: r.bottom() + 4.0,
        },
        Some(r) => At {
            x: r.left(),
            y: r.bottom() + 4.0,
        },
        None => pointer(ev),
    }
}

pub fn pointer(ev: &web_sys::MouseEvent) -> At {
    At {
        x: ev.client_x() as f64,
        y: ev.client_y() as f64,
    }
}

/// Keeps a `width`-wide box inside the window.
fn clamp(at: At, width: f64) -> (f64, f64) {
    let (vw, vh) = web_sys::window()
        .map(|w| {
            (
                w.inner_width()
                    .ok()
                    .and_then(|v| v.as_f64())
                    .unwrap_or(1200.0),
                w.inner_height()
                    .ok()
                    .and_then(|v| v.as_f64())
                    .unwrap_or(800.0),
            )
        })
        .unwrap_or((1200.0, 800.0));
    let x = at.x.min(vw - width - 8.0).max(8.0);
    let y = at.y.min(vh - 120.0).max(8.0);
    (x, y)
}

#[derive(Clone)]
pub enum Entry {
    Head(String),
    Sep,
    Item {
        label: String,
        hint: Option<String>,
        icon: Option<Ico>,
        on: bool,
        danger: bool,
        run: Callback<()>,
    },
}

impl Entry {
    pub fn item(label: impl Into<String>, run: impl Fn() + Send + Sync + 'static) -> Self {
        Entry::Item {
            label: label.into(),
            hint: None,
            icon: None,
            on: false,
            danger: false,
            run: Callback::new(move |_| run()),
        }
    }
    pub fn hint(mut self, h: impl Into<String>) -> Self {
        if let Entry::Item { hint, .. } = &mut self {
            *hint = Some(h.into());
        }
        self
    }
    pub fn icon(mut self, i: Ico) -> Self {
        if let Entry::Item { icon, .. } = &mut self {
            *icon = Some(i);
        }
        self
    }
    pub fn on(mut self, v: bool) -> Self {
        if let Entry::Item { on, .. } = &mut self {
            *on = v;
        }
        self
    }
    pub fn danger(mut self) -> Self {
        if let Entry::Item { danger, .. } = &mut self {
            *danger = true;
        }
        self
    }
}

/// A fixed-layer popover at `at`; closes on a press outside or Escape.
#[component]
pub fn Pop(
    at: RwSignal<Option<At>>,
    #[prop(default = 260.0)] width: f64,
    #[prop(optional, into)] class: String,
    children: ChildrenFn,
) -> impl IntoView {
    let handle = window_event_listener(leptos::ev::keydown, move |ev| {
        if at.get_untracked().is_some() && ev.key() == "Escape" {
            at.set(None);
        }
    });
    on_cleanup(move || handle.remove());
    let children = StoredValue::new(children);
    let class = StoredValue::new(class);
    view! {
        <leptos::portal::Portal>
        <Show when=move || at.get().is_some()>
            <div class="floating-catch" on:click=move |_| at.set(None) on:contextmenu=move |ev| {
                ev.prevent_default();
                at.set(None);
            }></div>
            <div
                class=move || format!("pop m-pop-down {}", class.get_value())
                style=move || {
                    let (x, y) = clamp(at.get().unwrap_or(At { x: 0.0, y: 0.0 }), width);
                    format!("left:{x}px;top:{y}px;width:{width}px")
                }
            >
                {move || children.with_value(|c| c())}
            </div>
        </Show>
        </leptos::portal::Portal>
    }
}

/// A popover list of entries.
#[component]
pub fn PopMenu(
    at: RwSignal<Option<At>>,
    #[prop(into)] entries: Signal<Vec<Entry>>,
    #[prop(default = 260.0)] width: f64,
) -> impl IntoView {
    view! {
        <Pop at=at width=width class="menu">
            {move || {
                entries
                    .get()
                    .into_iter()
                    .map(|e| match e {
                        Entry::Head(h) => view! { <div class="t-label pop-head">{h}</div> }.into_any(),
                        Entry::Sep => view! { <div class="pop-sep"></div> }.into_any(),
                        Entry::Item { label, hint, icon, on, danger, run } => {
                            view! {
                                <button
                                    class="menu-item pop-item"
                                    class:danger=danger
                                    class:on=on
                                    on:click=move |_| {
                                        at.set(None);
                                        run.run(());
                                    }
                                >
                                    <span class="pop-ico">
                                        {icon.map(|ic| view! { <Icon ico=ic size=14.0 /> })}
                                    </span>
                                    <span class="pop-body">
                                        <span class="menu-label">{label}</span>
                                        {hint.map(|h| view! { <span class="pop-hint">{h}</span> })}
                                    </span>
                                    {on.then(|| view! { <Icon ico=Ico::Check size=13.0 class="opt-check" /> })}
                                </button>
                            }
                            .into_any()
                        }
                    })
                    .collect_view()
            }}
        </Pop>
    }
}

fn plural(n: usize, one: &str) -> String {
    format!("{n} {one}{}", if n == 1 { "" } else { "s" })
}

pub fn is_chat(s: &Session, d: &Directory) -> bool {
    let chats = d.chats_project_id.get();
    d.workspace(s.workspace_id().as_deref())
        .map(|w| w.chat == Some(true) || (chats.is_some() && w.project_id == chats))
        .unwrap_or(false)
}

pub fn project_id_of(s: &Session, d: &Directory) -> Option<String> {
    if let Some(w) = d.workspace(s.workspace_id().as_deref()) {
        return w.project_id;
    }
    let key = s.project.as_ref().map(|p| p.project_key.clone())?;
    d.projects.with(|ps| {
        ps.iter()
            .find(|p| p.project_key.as_deref() == Some(key.as_str()))
            .map(|p| p.project_id.clone())
    })
}

/// The "All projects ▾" switcher: every project with its session count, then chats and history.
#[component]
pub fn ScopeMenu(at: RwSignal<Option<At>>) -> impl IntoView {
    let app = crate::state::get();
    let d = projects::get();
    let l = list::get();
    let entries = Signal::derive(move || {
        let host = app
            .conn
            .active_link()
            .server_name
            .unwrap_or_else(|| "this host".into());
        let sessions = app.sessions();
        let scope = l.scope.get();
        let mut counts = std::collections::HashMap::<String, usize>::new();
        let mut all = 0;
        for s in &sessions {
            if is_chat(s, &d) {
                continue;
            }
            all += 1;
            if let Some(id) = project_id_of(s, &d) {
                *counts.entry(id).or_default() += 1;
            }
        }
        let set = move |v: String| move || l.scope.set(v.clone());
        let mut out = vec![
            Entry::Head("Scope".into()),
            Entry::item("All projects", set("all".into()))
                .hint(format!("{} · {host}", plural(all, "session")))
                .on(scope == "all"),
        ];
        for p in d.projects.get() {
            let n = counts.get(&p.project_id).copied().unwrap_or(0);
            out.push(
                Entry::item(p.name(), set(p.project_id.clone()))
                    .hint(format!("{} · {host}", plural(n, "session")))
                    .on(scope == p.project_id),
            );
        }
        out.extend([
            Entry::Sep,
            Entry::item("Chats", set("chats".into()))
                .hint("Project-less, read-only sandbox")
                .icon(Ico::MessageSquare)
                .on(scope == "chats"),
            Entry::item("History", set("archived".into()))
                .hint("Archived and past sessions")
                .icon(Ico::History)
                .on(scope == "archived"),
            Entry::Sep,
            Entry::item("Add project…", move || l.open(Sheet::AddProject)).icon(Ico::FolderPlus),
            Entry::item("Import conversations…", move || l.open(Sheet::Import)).icon(Ico::Upload),
        ]);
        out
    });
    view! { <PopMenu at=at entries=entries width=316.0 /> }
}

fn copy(text: String) {
    if let Some(w) = web_sys::window() {
        let _ = w.navigator().clipboard().write_text(&text);
    }
}

/// Right-click / long-press menu for one session row.
#[component]
pub fn SessionMenu(at: RwSignal<Option<At>>, agent: RwSignal<Option<String>>) -> impl IntoView {
    let app = crate::state::get();
    let d = projects::get();
    let l = list::get();
    let entries = Signal::derive(move || {
        let Some(id) = agent.get() else {
            return Vec::new();
        };
        let Some(host) = app.active_host() else {
            return Vec::new();
        };
        let Some(s) = app.agents.get(&host, &id) else {
            return Vec::new();
        };
        let ws = d.workspace(s.workspace_id().as_deref());
        let hidden = l.hidden.with(|h| h.contains(&id));
        let mut out = vec![{
            let id = id.clone();
            Entry::item("Rename…", move || l.open(Sheet::Rename(id.clone()))).icon(Ico::Pencil)
        }];
        if let Some(w) = ws {
            let id2 = id.clone();
            let pinned = w.pinned_at.is_some();
            let wid = w.id.clone();
            out.push(
                Entry::item("Labels", move || l.open(Sheet::Labels(id2.clone()))).icon(Ico::Tag),
            );
            out.push(
                Entry::item(if pinned { "Unpin" } else { "Pin to top" }, move || {
                    let wid = wid.clone();
                    leptos::task::spawn_local(async move {
                        if let Err(e) = d.set_pinned(&wid, !pinned).await {
                            toast_err(e);
                        }
                    });
                })
                .icon(Ico::Pin)
                .on(pinned),
            );
        }
        out.push(Entry::Sep);
        let cwd = s.agent.cwd.clone();
        out.push(Entry::item("Copy path", move || copy(cwd.clone())).icon(Ico::Copy));
        if let Some(b) = s.branch() {
            out.push(Entry::item("Copy branch", move || copy(b.clone())).icon(Ico::Copy));
        }
        let id3 = id.clone();
        out.push(Entry::item("Copy ID", move || copy(id3.clone())).icon(Ico::Copy));
        out.push(Entry::Sep);
        let id4 = id.clone();
        out.push(
            Entry::item(
                if hidden {
                    "Show in list"
                } else {
                    "Hide from list"
                },
                move || l.toggle_hidden(&id4),
            )
            .hint("On this device only")
            .icon(if hidden { Ico::Eye } else { Ico::EyeOff }),
        );
        let id5 = id.clone();
        out.push(
            Entry::item("Archive session…", move || {
                l.open(Sheet::Archive(id5.clone()))
            })
            .icon(Ico::Archive)
            .danger(),
        );
        out
    });
    view! { <PopMenu at=at entries=entries width=260.0 /> }
}

pub fn toast_err(e: String) {
    use crate::shell::toast::{Toast, ToastKind};
    crate::state::get()
        .toasts
        .push(Toast::new(ToastKind::Error, "Could not do that").detail(e));
}

/// The filter-icon popover: grouping, sort, row title, visible fields, label filter.
#[component]
pub fn DisplayMenu(at: RwSignal<Option<At>>) -> impl IntoView {
    let l = list::get();
    let d = projects::get();
    let opts = |v: &[(&str, &str)]| -> Vec<(String, String)> {
        v.iter()
            .map(|(a, b)| (a.to_string(), b.to_string()))
            .collect()
    };
    let groups = opts(&[
        ("attention", "Attention"),
        ("project", "Project"),
        ("labels", "Labels"),
    ]);
    let titles = opts(&[("title", "Title"), ("branch", "Branch")]);
    let sorts = vec![
        SelectOption::new("state", "Attention first"),
        SelectOption::new("recent", "Recent activity"),
        SelectOption::new("created", "Created"),
        SelectOption::new("title", "Title"),
    ];
    let shows: [(&'static str, &'static str); 5] = [
        ("project", "Project"),
        ("branch", "Branch"),
        ("host", "Host"),
        ("labels", "Labels"),
        ("provider", "Provider"),
    ];
    let show_get = move |k: &str| {
        l.prefs.with(|p| match k {
            "project" => p.show.project,
            "branch" => p.show.branch,
            "host" => p.show.host,
            "labels" => p.show.labels,
            _ => p.show.provider,
        })
    };
    let show_flip = move |k: &str| {
        l.prefs.update(|p| {
            let f = match k {
                "project" => &mut p.show.project,
                "branch" => &mut p.show.branch,
                "host" => &mut p.show.host,
                "labels" => &mut p.show.labels,
                _ => &mut p.show.provider,
            };
            *f = !*f;
        })
    };
    view! {
        <Pop at=at width=330.0 class="display-pop">
            <span class="t-label pop-head">"Display"</span>
            <div class="pop-line">
                <span>"Group"</span>
                <Seg
                    options=groups.clone()
                    value=Signal::derive(move || l.prefs.with(|p| p.group.clone()))
                    on_change=Callback::new(move |v| l.prefs.update(|p| p.group = v))
                />
            </div>
            <div class="pop-line">
                <span>"Sort"</span>
                <div class="pop-select">
                    <Select
                        options=sorts.clone()
                        value=Signal::derive(move || l.prefs.with(|p| p.sort.clone()))
                        on_change=Callback::new(move |v| l.prefs.update(|p| p.sort = v))
                    />
                </div>
            </div>
            <div class="pop-line">
                <span>"Title"</span>
                <Seg
                    options=titles.clone()
                    value=Signal::derive(move || l.prefs.with(|p| p.title.clone()))
                    on_change=Callback::new(move |v| l.prefs.update(|p| p.title = v))
                />
            </div>
            <span class="t-label pop-head">"Show"</span>
            <div class="show-chips">
                {shows
                    .into_iter()
                    .map(|(k, label)| {
                        view! {
                            <button
                                class="show-chip"
                                class:on=move || show_get(k)
                                aria-pressed=move || show_get(k).to_string()
                                on:click=move |_| show_flip(k)
                            >
                                {label}
                            </button>
                        }
                    })
                    .collect_view()}
            </div>
            <span class="t-label pop-head">"Filter"</span>
            <div class="pop-line">
                <span>"Label"</span>
                <div class="pop-select">
                    {move || {
                        let mut o = vec![SelectOption::new("__any", "Any")];
                        o.extend(d.labels.get().into_iter().map(|x| SelectOption::new(x.name.clone(), x.name)));
                        view! {
                            <Select
                                options=o
                                value=Signal::derive(move || l.prefs.with(|p| p.label.clone().unwrap_or_else(|| "__any".into())))
                                on_change=Callback::new(move |v: String| {
                                    l.prefs.update(|p| p.label = (v != "__any").then_some(v))
                                })
                            />
                        }
                    }}
                </div>
            </div>
            <div class="pop-line">
                <span>{move || format!("Show hidden ({})", l.hidden.with(Vec::len))}</span>
                <Toggle
                    value=Signal::derive(move || l.prefs.with(|p| p.show_hidden))
                    on_change=Callback::new(move |v| l.prefs.update(|p| p.show_hidden = v))
                />
            </div>
        </Pop>
    }
}

/// A small on/off switch (ui-next `settings/controls` Toggle).
#[component]
pub fn Toggle(#[prop(into)] value: Signal<bool>, on_change: Callback<bool>) -> impl IntoView {
    view! {
        <button
            class="toggle"
            class:on=move || value.get()
            role="switch"
            aria-checked=move || value.get().to_string()
            on:click=move |ev| {
                ev.stop_propagation();
                on_change.run(!value.get_untracked());
            }
        >
            <span class="toggle-knob"></span>
        </button>
    }
}
