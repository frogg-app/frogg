//! Session list (ui-next `SessionList.tsx` + `components/sessions/*`): scope switcher (all
//! projects across connected hosts, one project, chats, history), status summary, filter, rows
//! grouped by attention / project / label with pins, labels, inline approve, a context menu,
//! and the dialogs those open (rename, labels, archive, import, add project).

pub mod folder;
pub mod history;
pub mod inbox;
pub mod menus;
pub mod merged;
pub mod sheets;
pub mod summary;

use std::collections::{HashMap, HashSet};

use leptos::html;
use leptos::prelude::*;

use crate::components::{Brackets, Button, ButtonKind, Ico, Icon, SkeletonRows, StatusGlyph};
use crate::state::projects::{self, Directory};
use crate::state::sessions::{self as list, age_group, ago, parse_ms, ListPrefs, SessionExt};
use crate::state::{bucket_of, Bucket, Conn, Session};
use menus::{At, DisplayMenu, ScopeMenu, SessionMenu};

/// One row: a session and, when it lives on a host other than the active one, that host's id.
#[derive(Debug, Clone, PartialEq)]
pub struct Item {
    pub host: Option<String>,
    pub s: Session,
    /// Listed indented under its parent.
    pub nested: bool,
}

impl Item {
    fn key(&self) -> String {
        format!("{}:{}", self.host.as_deref().unwrap_or(""), self.s.agent.id)
    }
}

#[derive(Debug, Clone, PartialEq)]
struct Group {
    key: String,
    label: String,
    hint: Option<&'static str>,
    list: Vec<Item>,
}

const ORDER: [(Bucket, &str, &str); 5] = [
    (
        Bucket::Needs,
        "Needs you",
        "Waiting for your approval or answer",
    ),
    (Bucket::Failed, "Failed", "Stopped with an error"),
    (
        Bucket::Review,
        "Ready to review",
        "Finished a turn you have not opened yet",
    ),
    (Bucket::Working, "Working", "Running a turn now"),
    (Bucket::Idle, "Idle", "Waiting for your next message"),
];

#[derive(Debug, Clone, PartialEq, Default)]
struct Model {
    groups: Vec<Group>,
    counts: HashMap<Bucket, usize>,
    total: usize,
    /// Rows name their host: sessions from more than one host share the list.
    mixed: bool,
}

fn scope_name(scope: &str, d: &Directory) -> String {
    match scope {
        "all" => "All projects".into(),
        "chats" => "Chats".into(),
        "archived" => "History".into(),
        id => d.projects.with(|ps| {
            ps.iter()
                .find(|p| p.project_id == id)
                .map(|p| p.name())
                .unwrap_or_else(|| "Project".into())
        }),
    }
}

fn sort_items(list: &mut [Item], prefs: &ListPrefs, pinned: &dyn Fn(&Session) -> bool) {
    list.sort_by(|a, b| {
        let p = pinned(&b.s).cmp(&pinned(&a.s));
        if p != std::cmp::Ordering::Equal {
            return p;
        }
        match prefs.sort.as_str() {
            "title" => {
                a.s.agent
                    .title
                    .clone()
                    .unwrap_or_default()
                    .to_lowercase()
                    .cmp(&b.s.agent.title.clone().unwrap_or_default().to_lowercase())
            }
            sort => {
                if sort == "state" {
                    let r = bucket_of(&a.s.agent)
                        .rank()
                        .cmp(&bucket_of(&b.s.agent).rank());
                    if r != std::cmp::Ordering::Equal {
                        return r;
                    }
                }
                let (x, y) = if sort == "created" {
                    (&a.s.agent.created_at, &b.s.agent.created_at)
                } else {
                    (&a.s.agent.updated_at, &b.s.agent.updated_at)
                };
                parse_ms(y).total_cmp(&parse_ms(x))
            }
        }
    });
}

fn model(needle: &str) -> Model {
    let app = crate::state::get();
    let d = projects::get();
    let l = list::get();
    let scope = l.scope.get();
    let prefs = l.prefs.get();
    let hidden = l.hidden.get();
    let active = app.active_host();
    let chats = scope == "chats";
    // "All projects" spans every connected host; a project or chats scope is the active host's.
    let mut pool: Vec<Item> = app
        .sessions()
        .into_iter()
        .map(|s| Item {
            host: None,
            s,
            nested: false,
        })
        .collect();
    let mut others = 0;
    if scope == "all" {
        let ids: Vec<String> = app.agents.by_host.with(|m| m.keys().cloned().collect());
        for h in ids {
            if Some(&h) == active.as_ref() || app.conn.link(&h).conn != Conn::Online {
                continue;
            }
            for s in app.agents.list(Some(&h)) {
                others += 1;
                pool.push(Item {
                    host: Some(h.clone()),
                    s,
                    nested: false,
                });
            }
        }
    }
    let labels_of = |s: &Session| {
        d.workspace(s.workspace_id().as_deref())
            .map(|w| w.labels)
            .unwrap_or_default()
    };
    let pinned = |s: &Session| {
        d.workspace(s.workspace_id().as_deref())
            .map(|w| w.pinned_at.is_some())
            .unwrap_or(false)
    };
    // Family: a child (frogg.parent-agent-id) follows its root's scope and section.
    let index: HashMap<String, usize> =
        pool.iter().enumerate().map(|(i, x)| (x.key(), i)).collect();
    let root_of = |i: usize| -> usize {
        let mut cur = i;
        for _ in 0..8 {
            let x = &pool[cur];
            let Some(pid) = x.s.parent_id() else { break };
            let key = format!("{}:{pid}", x.host.as_deref().unwrap_or(""));
            match index.get(&key) {
                // A parent cycle leads back to the start: treat the row as its own root.
                Some(&p) if p == i => return i,
                Some(&p) => cur = p,
                None => break,
            }
        }
        cur
    };
    let roots: Vec<usize> = (0..pool.len()).map(root_of).collect();
    let in_scope_root = |r: usize| {
        let s = &pool[r].s;
        if pool[r].host.is_some() {
            return !chats && scope == "all";
        }
        menus::is_chat(s, &d) == chats
            && (chats || scope == "all" || menus::project_id_of(s, &d).as_deref() == Some(&scope))
    };
    let passes = |r: usize| {
        let s = &pool[r].s;
        (prefs.show_hidden || !hidden.contains(&s.agent.id))
            && prefs
                .label
                .as_ref()
                .is_none_or(|l| labels_of(s).contains(l))
    };
    let matches = |s: &Session| {
        needle.is_empty()
            || format!(
                "{} {} {}",
                s.agent.title.clone().unwrap_or_default(),
                s.project_name(),
                s.branch().unwrap_or_default()
            )
            .to_lowercase()
            .contains(needle)
    };
    let mut counts = HashMap::new();
    let mut worst: HashMap<usize, usize> = HashMap::new();
    let mut shown: HashSet<usize> = HashSet::new();
    let mut total = 0;
    for i in 0..pool.len() {
        let r = roots[i];
        if !in_scope_root(r) {
            continue;
        }
        total += 1;
        let b = bucket_of(&pool[i].s.agent);
        *counts.entry(b).or_insert(0) += 1;
        let w = worst.entry(r).or_insert(4);
        *w = (*w).min(b.rank());
        if passes(r) && matches(&pool[i].s) {
            shown.insert(r);
        }
    }
    let mut kids: HashMap<usize, Vec<Item>> = HashMap::new();
    for i in 0..pool.len() {
        let r = roots[i];
        if r != i && shown.contains(&r) {
            let mut x = pool[i].clone();
            x.nested = true;
            kids.entry(r).or_default().push(x);
        }
    }
    let mut visible: Vec<(usize, Item)> = shown.iter().map(|&r| (r, pool[r].clone())).collect();
    {
        let mut items: Vec<Item> = visible.iter().map(|(_, x)| x.clone()).collect();
        sort_items(&mut items, &prefs, &pinned);
        visible = items.into_iter().map(|x| (index[&x.key()], x)).collect();
    }
    let host_name = |id: &str| {
        app.hosts
            .find(id)
            .map(|h| h.name)
            .unwrap_or_else(|| "host".into())
    };
    let mut groups: Vec<Group> = Vec::new();
    let mut push = |key: String, label: String, hint: Option<&'static str>, x: Item| {
        if let Some(g) = groups.iter_mut().find(|g| g.key == key) {
            g.list.push(x);
        } else {
            groups.push(Group {
                key,
                label,
                hint,
                list: vec![x],
            });
        }
    };
    if chats {
        for (_, x) in &visible {
            let g = age_group(&x.s.agent.updated_at);
            push(g.into(), g.into(), None, x.clone());
        }
    } else if prefs.group == "project" {
        for (_, x) in &visible {
            let name = x.s.project_name();
            match &x.host {
                Some(h) => push(
                    format!("{h}:{name}"),
                    format!("{name} · {}", host_name(h)),
                    None,
                    x.clone(),
                ),
                None => push(
                    menus::project_id_of(&x.s, &d).unwrap_or_else(|| name.clone()),
                    name,
                    None,
                    x.clone(),
                ),
            }
        }
        groups.sort_by_key(|a| a.label.to_lowercase());
    } else if prefs.group == "labels" {
        for (_, x) in &visible {
            let ls = labels_of(&x.s);
            if ls.is_empty() {
                push("~none".into(), "No label".into(), None, x.clone());
            }
            for l in ls {
                push(format!("l:{l}"), l.clone(), None, x.clone());
            }
        }
        groups.sort_by_key(|a| a.label.to_lowercase());
    } else {
        for (b, label, hint) in ORDER {
            for (r, x) in &visible {
                if worst.get(r).copied().unwrap_or(4) == b.rank() {
                    push(b.id().into(), label.into(), Some(hint), x.clone());
                }
            }
        }
    }
    let by_key: HashMap<String, usize> = visible.iter().map(|(r, x)| (x.key(), *r)).collect();
    for g in &mut groups {
        let list = std::mem::take(&mut g.list);
        for x in list {
            let r = by_key.get(&x.key()).copied();
            g.list.push(x);
            if let Some(k) = r.and_then(|r| kids.get(&r)) {
                g.list.extend(k.iter().cloned());
            }
        }
    }
    Model {
        groups,
        counts,
        total,
        mixed: others > 0 && scope == "all",
    }
}

#[component]
pub fn SessionList() -> impl IntoView {
    let app = crate::state::get();
    let d = projects::get();
    let l = list::get();
    let q = RwSignal::new(String::new());
    let needle = Memo::new(move |_| q.get().trim().to_lowercase());
    let m = Memo::new(move |_| model(&needle.get()));
    let scope_at = RwSignal::new(None::<At>);
    let display_at = RwSignal::new(None::<At>);
    let menu_at = RwSignal::new(None::<At>);
    let menu_agent = RwSignal::new(None::<String>);
    let filter = NodeRef::<html::Input>::new();
    // "/" focuses the filter.
    let handle = window_event_listener(leptos::ev::keydown, move |ev| {
        if ev.key() != "/" || ev.meta_key() || ev.ctrl_key() {
            return;
        }
        let typing = ev
            .target()
            .and_then(|t| wasm_bindgen::JsCast::dyn_into::<web_sys::HtmlElement>(t).ok())
            .map(|e| {
                matches!(e.tag_name().as_str(), "INPUT" | "TEXTAREA") || e.is_content_editable()
            })
            .unwrap_or(false);
        if !typing {
            if let Some(el) = filter.get_untracked() {
                ev.prevent_default();
                let _ = el.focus();
            }
        }
    });
    on_cleanup(move || handle.remove());
    let scope = move || l.scope.get();
    let name = move || scope_name(&l.scope.get(), &d);
    let chats = move || l.scope.get() == "chats";
    let loading = move || {
        m.with(|m| m.total == 0)
            && app.sessions().is_empty()
            && app.conn.active_link().conn == Conn::Connecting
    };
    let on_menu = Callback::new(move |(id, at): (String, At)| {
        menu_agent.set(Some(id));
        menu_at.set(Some(at));
    });
    view! {
        <div class="panel slist">
            <div class="slist-head">
                <button
                    class="slist-scope"
                    aria-label="Switch scope"
                    on:click=move |ev| scope_at.set(Some(menus::below(&ev, false, 316.0)))
                >
                    {move || {
                        let ico = match scope().as_str() {
                            "chats" => Ico::MessageSquare,
                            "archived" => Ico::History,
                            "all" => Ico::Layers,
                            _ => Ico::GitBranch,
                        };
                        view! { <Icon ico=ico size=14.0 class="cyan2" /> }
                    }}
                    <span class="t-display slist-scope-t">{name}</span>
                    <Icon ico=Ico::ChevronDown size=14.0 class="faint" />
                </button>
                <span class="spacer"></span>
                <button
                    class="icon-btn"
                    aria-label="Display options"
                    on:click=move |ev| display_at.set(Some(menus::below(&ev, true, 330.0)))
                >
                    <Icon ico=Ico::Filter size=15.0 />
                </button>
                <button
                    class="icon-btn"
                    aria-label="New session"
                    on:click=move |_| app.ui.set_new_session(true, None)
                >
                    <Icon ico=Ico::Plus size=17.0 />
                </button>
            </div>
            {move || {
                if scope() == "archived" {
                    return view! { <history::HistoryList /> }.into_any();
                }
                if loading() {
                    return view! { <SkeletonRows rows=6 /> }.into_any();
                }
                if m.with(|m| m.total == 0) {
                    return view! { <Empty name=name() chats=chats() all=scope() == "all" /> }.into_any();
                }
                view! {
                    <Show when=move || !chats()>
                        <summary::StatusSummary counts=Signal::derive(move || m.with(|m| m.counts.clone())) />
                    </Show>
                    <div class="slist-filter cut" style="--c:5px">
                        <input
                            node_ref=filter
                            class="slist-filter-in"
                            placeholder=move || if chats() { "Filter chats" } else { "Filter sessions" }
                            spellcheck="false"
                            prop:value=move || q.get()
                            on:input=move |ev| q.set(event_target_value(&ev))
                            on:keydown=move |ev| {
                                if ev.key() == "Escape" {
                                    q.set(String::new());
                                }
                            }
                        />
                        <span class="t-mono kbd">"/"</span>
                    </div>
                    <div class="panel-scroll">
                        <For
                            each=move || m.get().groups
                            key=|g| (g.key.clone(), g.list.iter().map(|x| x.key()).collect::<Vec<_>>().join(","))
                            children=move |g| {
                                let n = g.list.len();
                                view! {
                                    <div class="sgroup">
                                        <div class="sgroup-head">
                                            <span class="sgroup-text">
                                                <span class="t-label">{g.label.clone()}</span>
                                                {g.hint.map(|h| view! { <span class="sgroup-hint">{h}</span> })}
                                            </span>
                                            <span class="t-mono group-count">{n}</span>
                                        </div>
                                        <For
                                            each=move || g.list.clone()
                                            key=|x| x.key()
                                            children=move |x| {
                                                let key = x.key();
                                                let item = Memo::new(move |_| {
                                                    m.with(|m| {
                                                        m.groups
                                                            .iter()
                                                            .flat_map(|g| g.list.iter())
                                                            .find(|y| y.key() == key)
                                                            .cloned()
                                                    })
                                                });
                                                let host = x.host.clone().filter(|_| true);
                                                let mixed = Signal::derive(move || m.with(|m| m.mixed));
                                                view! { <Row item=item fallback=x chat=chats() mixed=mixed host=host on_menu=on_menu /> }
                                            }
                                        />
                                    </div>
                                }
                            }
                        />
                        <Show when=move || m.with(|m| m.groups.is_empty())>
                            <span class="slist-none">"Nothing matches."</span>
                        </Show>
                        <Show when=move || !chats()>
                            <merged::MergedTerminals needle=q />
                        </Show>
                    </div>
                }
                .into_any()
            }}
            <ScopeMenu at=scope_at />
            <DisplayMenu at=display_at />
            <SessionMenu at=menu_at agent=menu_agent />
            <sheets::SessionSheets />
        </div>
    }
}

#[component]
fn Empty(name: String, chats: bool, all: bool) -> impl IntoView {
    let app = crate::state::get();
    let l = list::get();
    let title = if chats {
        "No chats yet".to_owned()
    } else if all {
        "No sessions yet".to_owned()
    } else {
        format!("No sessions in {name} yet")
    };
    view! {
        <div class="slist-empty m-enter">
            <div class="empty-mark-box">
                <span class="empty-ring"></span>
                <span class="empty-mark"></span>
            </div>
            <span class="t-display slist-empty-t">{title}</span>
            <span class="slist-empty-b">
                {if chats {
                    "Ask a quick question without a project."
                } else {
                    "Start one on a new worktree, or import an existing conversation."
                }}
            </span>
            <Button
                label="New session"
                kind=ButtonKind::Primary
                on_press=Callback::new(move |_| app.ui.set_new_session(true, None))
            />
            {(!chats).then(|| view! {
                <button class="slist-empty-link" on:click=move |_| l.open(list::Sheet::Import)>"Import…"</button>
            })}
        </div>
    }
}

/// Makes the session's host active (when it is another), then opens the session.
fn open_on_its_host(host: Option<String>, id: String) {
    let app = crate::state::get();
    if let Some(h) = host {
        app.conn.activate(&h);
    }
    app.ui.set_tool(crate::state::Tool::Sessions);
    app.ui.select(Some(id));
}

#[component]
fn Row(
    item: Memo<Option<Item>>,
    fallback: Item,
    chat: bool,
    mixed: Signal<bool>,
    host: Option<String>,
    on_menu: Callback<(String, At)>,
) -> impl IntoView {
    let app = crate::state::get();
    let d = projects::get();
    let l = list::get();
    let fallback = StoredValue::new(fallback);
    let it = move || item.get().unwrap_or_else(|| fallback.get_value());
    let elsewhere = host.is_some();
    let host = StoredValue::new(host);
    let id = StoredValue::new(fallback.with_value(|f| f.s.agent.id.clone()));
    let selected = Signal::derive(move || {
        !elsewhere && app.ui.selected.get().as_deref() == Some(id.get_value().as_str())
    });
    let ws = move || d.workspace(it().s.workspace_id().as_deref());
    let hidden = move || l.hidden.with(|h| h.contains(&id.get_value()));
    let open = move || open_on_its_host(host.get_value(), id.get_value());
    let menu_at = move |at: At| {
        if elsewhere {
            open();
        } else {
            on_menu.run((id.get_value(), at));
        }
    };
    // Long press (touch) opens the menu.
    let press_timer = StoredValue::new(None::<TimeoutHandle>);
    let long_fired = StoredValue::new(false);
    let host_label = move || {
        let h = host.get_value();
        match h {
            Some(h) => app.hosts.find(&h).map(|x| x.name),
            None if mixed.get() => app.hosts.active().map(|x| x.name),
            None => None,
        }
        .filter(|_| l.prefs.with(|p| p.show.host) || mixed.get())
    };
    view! {
        <div
            class="srow2"
            class:on=move || selected.get()
            class:hidden-row=hidden
            class:nested=move || it().nested
            role="button"
            tabindex="0"
            on:click=move |_| {
                if long_fired.get_value() {
                    long_fired.set_value(false);
                    return;
                }
                open();
            }
            on:keydown=move |ev| if ev.key() == "Enter" { open() }
            on:contextmenu=move |ev| {
                ev.prevent_default();
                menu_at(menus::pointer(&ev));
            }
            on:touchstart=move |ev: web_sys::TouchEvent| {
                let t = ev.touches().get(0);
                let at = t.map(|t| At { x: t.client_x() as f64, y: t.client_y() as f64 });
                long_fired.set_value(false);
                let h = set_timeout_with_handle(
                    move || {
                        if let Some(at) = at {
                            long_fired.set_value(true);
                            menu_at(at);
                        }
                    },
                    std::time::Duration::from_millis(350),
                )
                .ok();
                press_timer.set_value(h);
            }
            on:touchend=move |_| { if let Some(h) = press_timer.get_value() { h.clear(); } }
            on:touchmove=move |_| { if let Some(h) = press_timer.get_value() { h.clear(); } }
        >
            <Brackets on=selected />
            <div class="srow2-top">
                <span class="srow2-glyph">
                    {move || if chat {
                        view! { <Icon ico=Ico::MessageSquare size=12.0 class="muted" /> }.into_any()
                    } else {
                        view! { <StatusGlyph bucket=bucket_of(&it().s.agent) /> }.into_any()
                    }}
                </span>
                <span class="srow2-title">
                    {move || {
                        let x = it();
                        let branch = x.s.branch();
                        if l.prefs.with(|p| p.title == "branch") && branch.is_some() {
                            branch.unwrap_or_default()
                        } else {
                            x.s.agent.title_or_untitled()
                        }
                    }}
                </span>
                {move || ws().and_then(|w| w.pinned_at).map(|_| view! { <Icon ico=Ico::Pin size=11.0 class="faint" /> })}
                <span class="t-mono srow2-time">{move || ago(&it().s.agent.updated_at)}</span>
            </div>
            <div class="srow2-meta">
                {move || {
                    let x = it();
                    let p = l.prefs.get();
                    let a = &x.s.agent;
                    let mut out: Vec<AnyView> = Vec::new();
                    if x.nested {
                        out.push(view! { <span class="t-mono srow2-branch">"subagent"</span> }.into_any());
                    }
                    if let Some(h) = host_label() {
                        out.push(view! { <span class="t-mono srow2-host">{h}</span> }.into_any());
                    }
                    if chat {
                        let m = a.model.clone().unwrap_or_else(|| a.provider.clone());
                        out.push(view! { <span class="srow2-proj">{format!("{m} · read-only sandbox")}</span> }.into_any());
                    } else {
                        if p.show.project {
                            out.push(view! { <span class="srow2-proj">{x.s.project_name()}</span> }.into_any());
                        }
                        if let Some(b) = x.s.branch().filter(|_| p.show.branch && p.title != "branch") {
                            out.push(view! { <span class="t-mono srow2-branch">{b}</span> }.into_any());
                        }
                        if p.show.provider {
                            out.push(view! { <span class="t-mono srow2-branch">{a.provider.clone()}</span> }.into_any());
                        }
                    }
                    if p.show.labels {
                        for name in ws().map(|w| w.labels).unwrap_or_default() {
                            let c = d.label_color(&name);
                            out.push(view! { <sheets::LabelChip name=name color=c /> }.into_any());
                        }
                    }
                    out
                }}
            </div>
            {move || {
                let x = it();
                (bucket_of(&x.s.agent) == Bucket::Failed)
                    .then(|| x.s.last_error())
                    .flatten()
                    .map(|e| view! { <span class="t-mono srow2-error">{e}</span> })
            }}
            {move || {
                let x = it();
                let perm = x.s.first_permission()?;
                let kind = perm.get("kind").and_then(|v| v.as_str()).unwrap_or("").to_owned();
                let plan = kind == "plan";
                let question = kind == "question";
                let asked = question
                    .then(|| {
                        perm.pointer("/input/questions/0/question")
                            .and_then(|v| v.as_str())
                            .map(str::to_owned)
                    })
                    .flatten();
                let fallback = perm
                    .get("title")
                    .and_then(|v| v.as_str())
                    .or_else(|| perm.get("name").and_then(|v| v.as_str()))
                    .unwrap_or("permission")
                    .to_owned();
                let perm_id = perm.get("id").and_then(|v| v.as_str()).unwrap_or("").to_owned();
                let agent_id = x.s.agent.id.clone();
                let act = move |ev: leptos::ev::MouseEvent| {
                    ev.stop_propagation();
                    if plan || question || elsewhere {
                        open();
                    } else if let Err(e) = projects::answer_permission(&agent_id, &perm_id, true) {
                        menus::toast_err(e);
                    }
                };
                let label = if plan { "Review" } else if question { "Answer" } else { "Approve" };
                Some(view! {
                    <div class="srow2-perm">
                        <span class="srow2-perm-cmd">
                            {if plan {
                                view! { <span class="t-mono perm-plan">"Plan ready"</span> }.into_any()
                            } else if let Some(q) = asked {
                                view! { <span class="perm-ask">{q}</span> }.into_any()
                            } else {
                                view! { <span class="t-mono perm-text">{fallback}</span> }.into_any()
                            }}
                        </span>
                        <button class="approve cut" style="--c:6px" on:click=act>
                            <span class="approve-t">{label}</span>
                            {(!question).then(|| view! { <span class="t-mono approve-k">"A"</span> })}
                        </button>
                    </div>
                })
            }}
        </div>
    }
}
