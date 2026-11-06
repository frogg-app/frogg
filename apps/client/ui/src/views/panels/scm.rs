//! Source control (ui-next `ScmPanel.tsx`, `DiffView.tsx`): the active checkout's branch card,
//! commit box, changed files, session commits and stashes; a file's diff in the main pane through
//! frogg-render's `DiffView`; and the branch / diff-stat / checks status-bar segments.

use frogg_render::{parse_unified, DiffMode, FileDiff};
use leptos::prelude::*;

use super::util::{plural, Ask, Confirm};
use crate::components::{Brackets, Button, ButtonKind, Floating, Ico, Icon, Menu, MenuItem, Seg};
use crate::shell::panel_head::{GroupHead, PanelHead};
use crate::state::checkout::{base_name, online, session_cwd};
use crate::state::scm::{store, Compare, DiffFile, Status};
use crate::state::{self, Tool};
use crate::theme::layout::FormFactor;

/// Keeps the session's checkout watched (the panel, the status bar and Files share it).
fn use_watch() -> Memo<Option<String>> {
    let cwd = Memo::new(move |_| session_cwd());
    Effect::new(move |_| {
        if let (Some(c), true) = (cwd.get(), online()) {
            store().watch(c);
        }
    });
    cwd
}

fn git() -> Option<Status> {
    store().status.get().filter(|s| s.is_git)
}

/// Files with something to commit: against the base only a dirty tree has any.
fn dirty_count() -> usize {
    let s = store();
    let n = s.files.with(|f| f.as_ref().map(|f| f.len()).unwrap_or(0));
    if s.compare.get() == Compare::Base && !git().is_some_and(|g| g.is_dirty) {
        0
    } else {
        n
    }
}

#[component]
pub fn ScmPanel() -> impl IntoView {
    let app = state::get();
    let s = store();
    let cwd = use_watch();
    let ask = RwSignal::new(None::<Ask>);
    // Wide layouts always have something in the main pane: the first change, or the empty state.
    Effect::new(move |_| {
        if app.viewport.form_factor.get() == FormFactor::Phone {
            return;
        }
        let Some(files) = s.files.get() else { return };
        let open = app.ui.diff_path.get_untracked();
        if open.as_ref().is_some_and(|p| p != "." || files.is_empty()) {
            return;
        }
        app.ui.diff_path.set(Some(
            files
                .first()
                .map(|f| f.path.clone())
                .unwrap_or_else(|| ".".into()),
        ));
    });
    let more = RwSignal::new(false);
    view! {
        <div class="panel pn">
            <PanelHead title="Source control">
                {move || git().is_some().then(|| view! { <QuickSettings /> })}
                <button class="icon-btn" aria-label="Refresh" on:click=move |_| s.refresh()>
                    <Icon ico=Ico::RefreshCw size=14.0 class="faint" />
                </button>
                {move || git().map(|g| view! {
                    <div class="rel">
                        <button class="icon-btn" aria-label="More source control actions" on:click=move |_| more.set(true)>
                            <Icon ico=Ico::MoreHorizontal size=15.0 class="faint" />
                        </button>
                        <Menu open=more on_close=Callback::new(move |_| more.set(false)) items=more_items(&g, ask) align_right=true />
                    </div>
                })}
            </PanelHead>
            {move || cwd.get().is_none().then(|| view! { <div class="pn-note">"open a session to see its checkout"</div> })}
            {move || s.status.get().filter(|st| !st.is_git).map(|_| view! { <div class="pn-note">"this checkout is not a git repository"</div> })}
            {move || git().map(|g| view! { <BranchCard git=g /> })}
            {move || git().map(|_| view! { <CommitBox /> })}
            <div class="panel-scroll">
                {move || {
                    let files = s.files.get()?;
                    let label = match (s.compare.get(), git().and_then(|g| g.base_ref)) {
                        (Compare::Base, Some(b)) => format!("Changes vs {b}"),
                        _ => "Changes".to_owned(),
                    };
                    let n = files.len();
                    Some(view! {
                        <GroupHead label=label count=Signal::derive(move || n) />
                        {(n == 0).then(|| view! { <div class="t-label pn-clean">"working tree clean"</div> })}
                        {files.into_iter().map(|f| view! { <FileRow f=f ask=ask /> }).collect_view()}
                    })
                }}
                <Commits />
                <Stashes ask=ask />
            </div>
            <Confirm ask=ask />
        </div>
    }
}

fn more_items(g: &Status, ask: RwSignal<Option<Ask>>) -> Vec<MenuItem> {
    let s = store();
    let dirty = dirty_count();
    let base = g.base_ref.clone().unwrap_or_else(|| "main".into());
    let ahead = g.ahead_of_origin.unwrap_or(0.0) as u64;
    let remote = g.has_remote;
    let pr = s.pr.get_untracked().flatten();
    let pr_open = pr
        .as_ref()
        .is_some_and(|p| p.state != "merged" && p.state != "closed");
    let mut items = Vec::new();
    // ui-next lists "Commit" first; the message comes from the commit box.
    let commit = MenuItem::new("Commit", move || {
        if dirty > 0 {
            s.error
                .set(Some("Write a message in the box, then commit.".into()));
        }
    });
    items.push(if dirty > 0 {
        commit.hint("⌘↵")
    } else {
        commit.hint("Nothing to commit")
    });
    if dirty > 0 && remote {
        items.push(MenuItem::new("Commit and push", move || {
            let files = plural(dirty, "file");
            ask.set(Some(Ask::new(
                "Commit and push",
                format!("Commits all {files} changed with an automatic message, then pushes."),
                "Commit and push",
                move || store().commit(format!("Update {}", plural(dirty, "file")), true),
            )))
        }));
    }
    if remote {
        items.push(MenuItem::new("Pull", move || store().pull()).icon(Ico::ArrowDown));
        let mut push = MenuItem::new("Push", move || store().push()).icon(Ico::ArrowUp);
        if ahead > 0 {
            push = push.hint(format!("{ahead} ahead"));
        }
        items.push(push);
        items.push(MenuItem::new("Pull and push", move || {
            store().pull_and_push()
        }));
    }
    items.push(
        MenuItem::new(format!("Update from {base}"), move || {
            store().merge_from_base()
        })
        .hint(format!("merge {base}")),
    );
    if dirty == 0 {
        let (b, cur) = (
            base.clone(),
            g.current_branch
                .clone()
                .unwrap_or_else(|| "this branch".into()),
        );
        items.push(MenuItem::new(
            format!("Merge into {base} locally"),
            move || {
                ask.set(Some(Ask::new(
                    format!("Merge into {b}"),
                    format!("Merges {cur} into {b} in the local repository."),
                    "Merge",
                    move || store().merge_into_base(),
                )))
            },
        ));
    }
    if remote && !pr_open {
        items.push(
            MenuItem::new("Create pull request", move || store().create_pr())
                .icon(Ico::GitPullRequest),
        );
    }
    if let Some(p) = pr {
        let url = p.url.clone();
        let mut item = MenuItem::new("View pull request", move || {
            crate::native::open_external(&url)
        })
        .icon(Ico::ExternalLink);
        if let Some(n) = p.number {
            item = item.hint(format!("#{n}"));
        }
        items.push(item);
    }
    if dirty > 0 {
        items.push(MenuItem::new("Stash changes", move || store().stash_save()));
    }
    items
}

/// The branch switcher under the branch name: filter, recent branches with the current one
/// first, this branch's PR, and a stash-and-switch step when the tree is dirty (ui-next
/// `tools/BranchMenu.tsx`).
#[component]
fn BranchMenu(open: RwSignal<bool>, current: Option<String>) -> impl IntoView {
    let s = store();
    let query = RwSignal::new(String::new());
    let pending = RwSignal::new(None::<String>);
    let input = NodeRef::<leptos::html::Input>::new();
    let seq = StoredValue::new(0u64);
    // Reload (debounced) as the filter changes while open.
    Effect::new(move |_| {
        let q = query.get();
        if !open.get() {
            return;
        }
        pending.set(None);
        seq.update_value(|n| *n += 1);
        let mine = seq.get_value();
        set_timeout(
            move || {
                if seq.try_get_value() == Some(mine) {
                    s.load_branches((!q.trim().is_empty()).then(|| q.trim().to_owned()));
                }
            },
            std::time::Duration::from_millis(120),
        );
    });
    Effect::new(move |_| {
        if open.get() {
            if let Some(i) = input.get() {
                let _ = i.focus();
            }
        } else {
            query.set(String::new());
        }
    });
    let close = Callback::new(move |_| open.set(false));
    let current = StoredValue::new(current);
    let pick = move |name: String| {
        if current.with_value(|c| c.as_deref() == Some(name.as_str())) {
            open.set(false);
            return;
        }
        if dirty_count() > 0 {
            pending.set(Some(name));
            return;
        }
        open.set(false);
        s.switch_branch(name, false);
    };
    view! {
        <Floating open=open on_close=close class="pn-branch-menu">
            <div class="pn-branch-filter">
                <input
                    node_ref=input
                    class="input"
                    placeholder="Filter branches and PRs"
                    aria-label="Filter branches and PRs"
                    prop:value=move || query.get()
                    on:input=move |e| query.set(event_target_value(&e))
                />
            </div>
            <div class="pn-branch-list">
                <span class="t-label pn-branch-group">"Recent"</span>
                {move || {
                    let Some(list) = s.branches.get() else {
                        return view! { <span class="t-mono faint pn-branch-note">"loading branches…"</span> }.into_any();
                    };
                    if list.is_empty() {
                        return view! { <span class="faint pn-branch-note">"No matching branches."</span> }.into_any();
                    }
                    let cur = current.get_value();
                    let mut list = list;
                    if let Some(i) = list.iter().position(|b| Some(&b.name) == cur.as_ref()) {
                        let mine = list.remove(i);
                        list.insert(0, mine);
                    }
                    list.into_iter()
                        .map(|b| {
                            let on = Some(&b.name) == cur.as_ref();
                            let name = b.name.clone();
                            let n2 = b.name.clone();
                            let sub = on.then(|| {
                                format!(
                                    "current{}{}",
                                    b.ahead.map(|a| format!(" · ↑{a}")).unwrap_or_default(),
                                    b.behind.map(|x| format!(" ↓{x}")).unwrap_or_default()
                                )
                            });
                            view! {
                                <button
                                    class="pn-branch-row"
                                    class:on=on
                                    class:picked=move || pending.get().as_deref() == Some(n2.as_str())
                                    role="menuitem"
                                    on:click=move |_| pick(name.clone())
                                >
                                    <Icon ico=Ico::GitBranch size=13.0 class=if on { "cyan2" } else { "faint" } />
                                    <span class="pn-branch-row-text">
                                        <span class="pn-branch-row-name">{b.name.clone()}</span>
                                        {sub.map(|t| view! { <span class="t-mono faint pn-small">{t}</span> })}
                                    </span>
                                </button>
                            }
                        })
                        .collect_view()
                        .into_any()
                }}
                {move || s.pr.get().flatten().map(|p| view! {
                    <span class="t-label pn-branch-group">"Pull requests"</span>
                    <div class="pn-branch-row static">
                        <Icon ico=Ico::GitPullRequest size=13.0 class="faint" />
                        <span class="pn-branch-row-text">
                            <span class="pn-branch-row-name">
                                {format!("{}{}", p.number.map(|n| format!("#{n} ")).unwrap_or_default(), p.title)}
                            </span>
                            <span class="t-mono faint pn-small">{p.state}</span>
                        </span>
                    </div>
                })}
            </div>
            {move || {
                let n = dirty_count();
                (n > 0).then(|| {
                    let files = plural(n, "uncommitted file");
                    let text = match pending.get() {
                        Some(b) => format!("{files}. Stash them and switch to {b}?"),
                        None => format!("{files}. Switching will offer to stash them."),
                    };
                    view! {
                        <div class="pn-branch-warn">
                            <i class="pn-diamond pending"></i>
                            <span class="pn-branch-warn-text">{text}</span>
                            <button
                                class="pn-link"
                                disabled=move || pending.with(Option::is_none)
                                on:click=move |_| {
                                    if let Some(b) = pending.get_untracked() {
                                        open.set(false);
                                        s.switch_branch(b, true);
                                    }
                                }
                            >
                                "Stash & switch"
                            </button>
                        </div>
                    }
                })
            }}
        </Floating>
    }
}

#[component]
fn BranchCard(git: Status) -> impl IntoView {
    let s = store();
    let menu = RwSignal::new(false);
    let ab = git.ahead_behind.clone().unwrap_or_default();
    let ahead = git.ahead_of_origin.unwrap_or(0.0) as u64;
    let busy = move || s.busy.get().is_some();
    let on_base = git.base_ref.is_some() && git.current_branch == git.base_ref;
    let current = git.current_branch.clone();
    let base = git.base_ref.clone();
    view! {
        <div class="pn-branch cut" style="--c:8px">
            <div class="rel">
                <button
                    class="pn-branch-head"
                    aria-label="Switch branch"
                    on:click=move |_| {
                        s.load_branches(None);
                        menu.set(true);
                    }
                >
                    <Icon ico=Ico::GitBranch size=14.0 class="cyan2" />
                    <span class="pn-branch-name t-mono">{git.current_branch.clone().unwrap_or_else(|| "detached".into())}</span>
                    <Icon ico=Ico::ChevronDown size=12.0 class="faint" />
                </button>
                <BranchMenu open=menu current=current.clone() />
            </div>
            <div class="pn-counts t-mono">
                {match (&base, on_base) {
                    (Some(b), false) => view! {
                        <span><span class="cyan2">{format!("{} ahead", ab.ahead)}</span>{format!(" of {b} · {} behind", ab.behind)}</span>
                    }
                    .into_any(),
                    (Some(b), true) => view! { <span>{format!("this is {b}")}</span> }.into_any(),
                    (None, _) => view! { <span>"no base branch"</span> }.into_any(),
                }}
                {(ahead > 0).then(|| view! { <span class="amber">{format!("{ahead} not pushed")}</span> })}
                {move || match s.busy.get() {
                    Some("switch") => Some("switching…"),
                    Some("stash") => Some("stashing…"),
                    Some("merge") => Some("merging…"),
                    _ => None,
                }
                .map(|t| view! { <span>{t}</span> })}
            </div>
            <div class="pn-sync">
                <Button
                    label=Signal::derive(move || if s.busy.get() == Some("pull") { "Pulling…".to_string() } else { "Pull".to_string() })
                    icon=Ico::ArrowDown
                    disabled=Signal::derive(move || !git.has_remote || busy())
                    on_press=Callback::new(move |_| s.pull())
                />
                <Button
                    label=Signal::derive(move || {
                        if s.busy.get() == Some("push") {
                            "Pushing…".into()
                        } else if ahead > 0 {
                            format!("Push ↑{ahead}")
                        } else {
                            "Push".into()
                        }
                    })
                    icon=Ico::ArrowUp
                    disabled=Signal::derive(move || !git.has_remote || busy())
                    on_press=Callback::new(move |_| s.push())
                />
                {base.filter(|_| !on_base).map(|b| view! {
                    <Button
                        label=format!("Update from {b}")
                        disabled=Signal::derive(busy)
                        on_press=Callback::new(move |_| s.merge_from_base())
                    />
                })}
            </div>
        </div>
    }
}

#[component]
fn CommitBox() -> impl IntoView {
    let s = store();
    let msg = RwSignal::new(String::new());
    let count = Memo::new(move |_| dirty_count());
    let can = Signal::derive(move || {
        !msg.get().trim().is_empty() && count.get() > 0 && s.busy.get().is_none()
    });
    let menu = RwSignal::new(false);
    let commit = move |push: bool| {
        if !can.get_untracked() {
            return;
        }
        s.commit(msg.get_untracked().trim().to_owned(), push);
        msg.set(String::new());
    };
    view! {
        <div class="pn-commit">
            <textarea
                class="pn-msg t-mono"
                placeholder="Commit message"
                prop:value=move || msg.get()
                on:input=move |e| msg.set(event_target_value(&e))
                on:keydown=move |e: web_sys::KeyboardEvent| {
                    if e.key() == "Enter" && (e.meta_key() || e.ctrl_key()) {
                        e.prevent_default();
                        commit(false);
                    }
                }
            ></textarea>
            <div class="pn-commit-row">
                <Button
                    kind=ButtonKind::Primary
                    grow=true
                    label=Signal::derive(move || {
                        if s.busy.get() == Some("commit") {
                            "Committing…".to_owned()
                        } else {
                            format!("Commit {}", plural(count.get(), "file"))
                        }
                    })
                    disabled=Signal::derive(move || !can.get())
                    on_press=Callback::new(move |_| commit(false))
                />
                <div class="rel">
                    <button class="pn-commit-more" aria-label="More commit options" disabled=move || !can.get() on:click=move |_| menu.set(true)>
                        <Icon ico=Ico::ChevronDown size=13.0 class="pn-muted" />
                    </button>
                    <Menu
                        open=menu
                        on_close=Callback::new(move |_| menu.set(false))
                        items=vec![
                            MenuItem::new("Commit", move || commit(false)).hint("⌘↵"),
                            MenuItem::new("Commit and push", move || commit(true)),
                        ]
                        align_right=true
                    />
                </div>
            </div>
            {move || s.error.get().map(|e| view! { <div class="pn-error-inline t-mono">{e}</div> })}
        </div>
    }
}

#[component]
fn FileRow(f: DiffFile, ask: RwSignal<Option<Ask>>) -> impl IntoView {
    let app = state::get();
    let path = StoredValue::new(f.path.clone());
    let on = Signal::derive(move || {
        app.ui.diff_path.get().as_deref() == Some(path.get_value().as_str())
    });
    let (letter, tint) = f.mark();
    let name = base_name(&f.path);
    let dir = f
        .path
        .strip_suffix(&name)
        .unwrap_or("")
        .trim_end_matches('/')
        .to_owned();
    let is_new = f.is_new;
    let n2 = name.clone();
    let discard = move |e: web_sys::MouseEvent| {
        e.stop_propagation();
        ask.set(Some(
            Ask::new(
                format!("Discard changes to {n2}?"),
                if is_new {
                    "This file is new; discarding deletes it. This cannot be undone."
                } else {
                    "Restores the file to its last committed state. This cannot be undone."
                },
                "Discard changes",
                move || store().discard(vec![path.get_value()]),
            )
            .danger(),
        ))
    };
    view! {
        <div class="pn-row tight" class:on=move || on.get() role="button" tabindex="0" on:click=move |_| app.ui.open_diff(Some(path.get_value()))>
            <Brackets on=on />
            <span class=format!("pn-letter t-mono {tint}")>{letter}</span>
            <div class="pn-row-text">
                <span class="pn-row-title">{name.clone()}</span>
                {(!dir.is_empty()).then(|| view! { <span class="pn-row-meta t-mono">{dir.clone()}</span> })}
            </div>
            <button class="icon-btn pn-hover" aria-label=format!("Discard {name}") on:click=discard>
                <Icon ico=Ico::RotateCcw size=13.0 class="faint" />
            </button>
            <span class="t-mono mint pn-stat">{format!("+{}", f.additions)}</span>
            <span class="t-mono coral pn-stat">{format!("-{}", f.deletions)}</span>
        </div>
    }
}

/// How many of the base branch's newest commits sit under the branch, to show where it forked.
const BASE_CONTEXT: usize = 5;

/// A commit's place in the two-lane graph.
#[derive(Clone)]
struct GraphRow {
    c: crate::state::scm::Commit,
    branch: bool,
    first: bool,
    last: bool,
}

fn graph_rows(commits: Vec<crate::state::scm::Commit>, with_base: bool) -> Vec<GraphRow> {
    let (branch, base): (Vec<_>, Vec<_>) = commits.into_iter().partition(|c| !c.on_base);
    let n = branch.len();
    let mut rows: Vec<GraphRow> = branch
        .into_iter()
        .enumerate()
        .map(|(i, c)| GraphRow {
            c,
            branch: true,
            first: i == 0,
            last: i + 1 == n,
        })
        .collect();
    if with_base {
        rows.extend(
            base.into_iter()
                .take(BASE_CONTEXT)
                .enumerate()
                .map(|(i, c)| GraphRow {
                    c,
                    branch: false,
                    first: i == 0,
                    last: false,
                }),
        );
    }
    rows
}

/// The checkout's commits with a branch graph as the left-most column: this branch's commits on
/// their own lane, joining the base lane where it forked (ui-next `scm/CommitGraph.tsx`). The
/// daemon lists commits without parents, so the graph shows the fork, not merges.
#[component]
fn Commits() -> impl IntoView {
    let app = state::get();
    let s = store();
    move || {
        let p = app.prefs;
        let list = s.commits.get().filter(|c| !c.is_empty())?;
        let rows = graph_rows(list, p.flag("scmBaseCommits"));
        let n = rows.iter().filter(|r| r.branch).count();
        let has_branch = n > 0;
        let base = git()
            .and_then(|g| g.base_ref)
            .unwrap_or_else(|| "base".into());
        let label = if has_branch {
            format!("Commits not in {base}")
        } else {
            format!("Recent on {base}")
        };
        let (graph, sha, author, date, compact) = (
            p.flag("scmGraph"),
            p.flag("scmSha"),
            p.flag("scmAuthor"),
            p.flag("scmDate"),
            p.flag("scmCompact"),
        );
        let unpushed = rows.iter().any(|r| !r.c.on_remote);
        let base_legend = has_branch && p.flag("scmBaseCommits");
        Some(view! {
            {if has_branch {
                view! { <GroupHead label=label count=Signal::derive(move || n) /> }.into_any()
            } else {
                view! { <GroupHead label=label /> }.into_any()
            }}
            {unpushed.then(|| view! {
                <div class="pn-graph-legend t-mono">
                    <i class="pn-gnode local"></i>"not pushed yet"
                    {base_legend.then(|| view! { <i class="pn-gnode base"></i>{base.clone()} })}
                </div>
            })}
            {rows
                .into_iter()
                .map(|r| {
                    let node = if !r.c.on_remote {
                        "local"
                    } else if !r.branch {
                        "base"
                    } else {
                        "pushed"
                    };
                    let cell = if graph {
                        let solo = r.first && r.last;
                        view! {
                            <span class="pn-graph" class:narrow=!has_branch>
                                {(has_branch && r.branch).then(|| view! { <i class="pn-lane base dim"></i> })}
                                {(!r.branch).then(|| view! { <i class="pn-lane base"></i> })}
                                {r.branch.then(|| view! {
                                    <i class="pn-lane branch" class:from-mid=r.first || solo class:to-mid=r.last || solo></i>
                                })}
                                {(r.branch && r.last).then(|| view! { <i class="pn-fork"></i> })}
                                <i class=format!("pn-gnode {node} {}", if r.branch { "at-branch" } else { "at-base" })></i>
                            </span>
                        }
                        .into_any()
                    } else {
                        view! {
                            <span class="pn-graph-dot">
                                {(!r.c.on_remote).then(|| view! { <i class="pn-gnode local"></i> })}
                            </span>
                        }
                        .into_any()
                    };
                    let when = if js_sys::Date::parse(&r.c.when).is_finite() && r.c.when.contains('T') {
                        super::util::ago(&r.c.when)
                    } else {
                        r.c.when.clone()
                    };
                    view! {
                        <div class="pn-cline" class:compact=compact>
                            {cell}
                            {sha.then(|| view! { <span class="t-mono cyan2 pn-sha" class:dim=!r.branch>{r.c.sha.clone()}</span> })}
                            <span class="pn-line-text" class:dim=!r.branch>{r.c.subject.clone()}</span>
                            {(author && !r.c.author.is_empty()).then(|| view! { <span class="t-mono pn-cauthor">{r.c.author.clone()}</span> })}
                            {date.then(|| view! { <span class="t-mono pn-when">{when}</span> })}
                        </div>
                    }
                })
                .collect_view()}
        })
    }
}

/// Top-right quick settings for the commit list: columns, density and layout.
#[component]
fn QuickSettings() -> impl IntoView {
    use crate::views::settings::kit::PrefToggle;
    let open = RwSignal::new(false);
    let base = move || {
        git()
            .and_then(|g| g.base_ref)
            .unwrap_or_else(|| "base".into())
    };
    let row = |label: String, key: &'static str| {
        view! {
            <div class="pn-quick-row">
                <span class="pn-quick-label">{label}</span>
                <PrefToggle key=key />
            </div>
        }
    };
    view! {
        <div class="pn-rel">
            <button
                class="icon-btn"
                class:pn-on=move || open.get()
                aria-label="Source control view settings"
                on:click=move |_| open.set(true)
            >
                <Icon ico=Ico::SlidersHorizontal size=14.0 />
            </button>
            <Floating open=open on_close=Callback::new(move |_| open.set(false)) align_right=true class="pn-quick">
                <span class="t-label">"Columns"</span>
                {row("Branch graph".into(), "scmGraph")}
                {row("Commit hash".into(), "scmSha")}
                {row("Author".into(), "scmAuthor")}
                {row("Age".into(), "scmDate")}
                <span class="t-label pn-quick-head">"Appearance"</span>
                {row("Compact rows".into(), "scmCompact")}
                <span class="t-label pn-quick-head">"Layout"</span>
                {move || row(format!("Show {} under the branch", base()), "scmBaseCommits")}
                {row("Stashes".into(), "scmStashes")}
            </Floating>
        </div>
    }
}

#[component]
fn Stashes(ask: RwSignal<Option<Ask>>) -> impl IntoView {
    let app = state::get();
    let s = store();
    move || {
        if !app.prefs.flag("scmStashes") && app.prefs.all.with(|m| m.contains_key("scmStashes")) {
            return None;
        }
        let list = s.stashes.get().filter(|c| !c.is_empty())?;
        let n = list.len();
        Some(view! {
            <GroupHead label="Stashes" count=Signal::derive(move || n) />
            {list
                .into_iter()
                .map(|st| {
                    let (i, m) = (st.index, st.message.clone());
                    view! {
                        <div class="pn-line pn-line-btn" role="button" on:click=move |_| {
                            ask.set(Some(Ask::new(
                                "Apply and drop this stash?",
                                m.clone(),
                                "Pop stash",
                                move || store().stash_pop(i),
                            )))
                        }>
                            <span class="t-mono cyan2 pn-sha">{format!("stash@{{{}}}", st.index)}</span>
                            <span class="pn-line-text">{st.message}</span>
                            {st.branch.map(|b| view! { <span class="t-mono pn-when">{b}</span> })}
                        </div>
                    }
                })
                .collect_view()}
        })
    }
}

/// A changed file's diff in the main pane (ui-next `DiffView.tsx`).
#[component]
pub fn DiffView(
    path: String,
    #[prop(optional_no_strip)] on_back: Option<Callback<()>>,
) -> impl IntoView {
    let app = state::get();
    let s = store();
    let mode = RwSignal::new("split".to_owned());
    let desktop = move || app.viewport.form_factor.get() == FormFactor::Desktop;
    let effective = Signal::derive(move || {
        if desktop() && mode.get() == "split" {
            DiffMode::Split
        } else {
            DiffMode::Unified
        }
    });
    let p = StoredValue::new(path.clone());
    let file = Memo::new(move |_| {
        s.files.with(|f| {
            f.as_ref().and_then(|f| {
                f.iter()
                    .position(|x| x.path == p.get_value())
                    .map(|i| (i, f.len(), f[i].clone()))
            })
        })
    });
    let parsed: Memo<Vec<FileDiff>> = Memo::new(move |_| {
        file.get()
            .map(|(_, _, f)| parse_unified(&f.to_unified()))
            .unwrap_or_default()
    });
    let base = move || git().and_then(|g| g.base_ref);
    let empty =
        move || s.files.with(|f| f.as_ref().is_some_and(|f| f.is_empty())) || p.get_value() == ".";
    let compare_opts = move || {
        vec![
            ("uncommitted".to_owned(), "Uncommitted".to_owned()),
            (
                "base".to_owned(),
                base()
                    .map(|b| format!("vs {b}"))
                    .unwrap_or_else(|| "vs base".into()),
            ),
        ]
    };
    let compare_value = Signal::derive(move || match s.compare.get() {
        Compare::Uncommitted => "uncommitted".to_owned(),
        Compare::Base => "base".to_owned(),
    });
    let on_compare = Callback::new(move |v: String| {
        store().set_compare(if v == "base" {
            Compare::Base
        } else {
            Compare::Uncommitted
        })
    });
    let back = move || {
        on_back.map(|b| {
            view! {
                <button class="icon-btn" aria-label="Back" on:click=move |_| b.run(())>
                    <Icon ico=Ico::ArrowLeft size=18.0 />
                </button>
            }
        })
    };
    view! {
        <div class="detail pn-diff">
            {move || {
                if empty() {
                    let ahead = git().and_then(|g| g.ahead_behind).map(|a| a.ahead).unwrap_or(0.0);
                    let note = match (s.compare.get(), base()) {
                        (Compare::Uncommitted, Some(b)) if ahead > 0.0 => format!("No uncommitted changes. This branch is {ahead} ahead of {b}: compare against it to review."),
                        (Compare::Uncommitted, _) => "No uncommitted changes.".to_owned(),
                        (Compare::Base, Some(b)) => format!("Nothing differs from {b}."),
                        (Compare::Base, None) => "No base branch to compare against.".to_owned(),
                    };
                    return view! {
                        <div class="detail-empty m-enter">
                            <Icon ico=Ico::Check size=26.0 stroke=1.4 class="faint" />
                            <span class="t-display detail-title">"Working tree clean"</span>
                            <span class="detail-note">{note}</span>
                            <Seg options=compare_opts() value=compare_value on_change=on_compare />
                        </div>
                    }
                    .into_any();
                }
                view! {
                    <div class="pn-diff-head">
                        <div class="pn-viewer-titles">
                            <span class="t-label">
                                {move || match s.compare.get() {
                                    Compare::Uncommitted => "changes · uncommitted".to_owned(),
                                    Compare::Base => format!("changes · vs {}", base().unwrap_or_default()),
                                }}
                            </span>
                            <div class="pn-viewer-title-row">
                                {back()}
                                <span class="t-display pn-viewer-title">{base_name(&p.get_value())}</span>
                            </div>
                            {move || file.get().map(|(i, n, f)| {
                                let parent = crate::state::files::parent_of(&f.path);
                                view! {
                                    <span class="t-mono pn-diff-meta">
                                        {(!parent.is_empty() && parent != ".").then(|| format!("{parent} · "))}
                                        <span class="mint">{format!("+{}", f.additions)}</span>" "
                                        <span class="coral">{format!("-{}", f.deletions)}</span>
                                        {format!(" · {} of {}", i + 1, plural(n, "file"))}
                                    </span>
                                }
                            })}
                        </div>
                        <span class="spacer"></span>
                        <Seg options=compare_opts() value=compare_value on_change=on_compare />
                        {move || desktop().then(|| view! {
                            <Seg
                                options=vec![("unified".into(), "Unified".into()), ("split".into(), "Split".into())]
                                value=mode
                                on_change=Callback::new(move |v| mode.set(v))
                            />
                        })}
                    </div>
                    <div class="pn-viewer-body">
                        {move || match file.get() {
                            None => view! {
                                <div class="pn-note">{if s.files.with(|f| f.is_some()) { "file not in this diff" } else { "loading diff…" }}</div>
                            }
                            .into_any(),
                            Some(_) => view! { <frogg_render::DiffView files=parsed mode=effective no_headers=true /> }.into_any(),
                        }}
                    </div>
                }
                .into_any()
            }}
        </div>
    }
}

/// Branch, diff stat and PR checks for the status bar (ui-next `StatusBar.tsx`). Renders nothing
/// off git; each segment opens its tool.
#[component]
pub fn ScmStatusSegments() -> impl IntoView {
    let app = state::get();
    let s = store();
    let cwd = use_watch();
    let checks = LocalResource::new(move || {
        let cwd = cwd.get();
        let on = online();
        async move {
            let (Some(cwd), true) = (cwd, on) else {
                return None;
            };
            let c = state::get().conn.client()?;
            let v = serde_json::to_value(c.checkout_pr_status(&cwd).await.ok()?).ok()?;
            let list = v["status"]["checks"].as_array()?.clone();
            if list.is_empty() {
                return None;
            }
            let state_of =
                |c: &serde_json::Value| c["status"].as_str().unwrap_or_default().to_lowercase();
            let done = list
                .iter()
                .filter(|c| {
                    matches!(
                        state_of(c).as_str(),
                        "success" | "passed" | "pass" | "skipped" | "neutral" | "completed"
                    )
                })
                .count();
            let failed = list
                .iter()
                .filter(|c| {
                    matches!(
                        state_of(c).as_str(),
                        "failure" | "failed" | "fail" | "error" | "cancelled" | "timed_out"
                    )
                })
                .count();
            Some((done, list.len(), failed))
        }
    });
    let go_scm = move |_| app.ui.set_tool(Tool::Scm);
    // `use_watch` falls back to any session's checkout (the SCM panel wants one); the status bar
    // speaks only for the selected session, as ui-next's does.
    let selected = Memo::new(move |_| {
        app.selected_session()
            .is_some_and(|s| !s.agent.cwd.is_empty())
    });
    view! {
        {move || { selected.get().then_some(())?; cwd.get()?; git() }.map(|g| {
            let ahead = g.ahead_behind.as_ref().map(|a| a.ahead).unwrap_or(0.0);
            view! {
                <button class="sb-seg" on:click=go_scm>
                    <span class="sb-t t-mono">
                        {format!("⎇ {}{}", g.current_branch.unwrap_or_else(|| "detached".into()), if ahead > 0.0 { format!(" ↑{ahead}") } else { String::new() })}
                    </span>
                </button>
            }
        })}
        {move || {
            selected.get().then_some(())?;
            cwd.get()?;
            git()?;
            let (add, del) = s.files.with(|f| {
                f.iter().flatten().fold((0.0, 0.0), |(a, d), x| (a + x.additions, d + x.deletions))
            });
            (add > 0.0 || del > 0.0).then(|| view! {
                <button class="sb-seg" on:click=go_scm>
                    <span class="sb-t t-mono mint">{format!("+{add}")}</span>
                    <span class="sb-t t-mono coral">{format!("-{del}")}</span>
                </button>
            })
        }}
        {move || selected.get().then(|| checks.get().flatten()).flatten().map(|(done, total, failed)| view! {
            <button class="sb-seg" on:click=move |_| app.ui.set_tool(Tool::Prs)>
                <span class={if failed > 0 { "sb-t coral" } else { "sb-t" }}>
                    {format!("{} checks {done}/{total}", if failed > 0 { "■" } else { "▸" })}
                </span>
            </button>
        })}
    }
}
