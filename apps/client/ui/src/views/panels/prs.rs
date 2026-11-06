//! PRs & CI (ui-next `PrsPanel.tsx`, `ci/*`, `tools/PrMerge.tsx`, `tools/Streams.tsx`): the
//! branch's pull request with its checks and a merge split button, the repository's CI runs
//! (polled while any is live, with live timers, progress and expandable jobs), the release
//! streams, and a run's jobs and steps in the main pane.

use std::time::Duration;

use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::Value;

use crate::components::{Brackets, Button, Ico, Icon, Menu, MenuItem, Seg, SkeletonRows};
use crate::shell::panel_head::{GroupHead, PanelHead};
use crate::state::checkout::{online, session_cwd};
use crate::state::ci::{dur, store, CiState, Job, Run};
use crate::state::{self};

const POLL_MS: u64 = 15_000;

fn forge(p: &str) -> String {
    match p {
        "githubActions" => "GitHub Actions".into(),
        "gitlab" => "GitLab CI".into(),
        "buildkite" => "Buildkite".into(),
        "jenkins" => "Jenkins".into(),
        o => o.to_owned(),
    }
}

/// A wall clock (ms) that ticks every second while anything is live, so open durations count.
#[derive(Clone, Copy)]
struct Now(RwSignal<f64>);

fn use_now() -> Now {
    if let Some(n) = use_context::<Now>() {
        return n;
    }
    Now(RwSignal::new(js_sys::Date::now()))
}

/// Seconds between two ISO stamps, counting to `now` while still open.
fn secs(a: Option<&str>, b: Option<&str>, now: f64) -> Option<f64> {
    let a = js_sys::Date::parse(a?);
    let b = b.map(js_sys::Date::parse).unwrap_or(now);
    (a.is_finite() && b.is_finite()).then(|| ((b - a) / 1000.0).max(0.0))
}

/// Remaining seconds from elapsed and progress; none until there is enough basis to guess.
fn eta(elapsed: Option<f64>, progress: Option<f64>) -> Option<f64> {
    let (e, p) = (elapsed?, progress?);
    (0.08..1.0).contains(&p).then(|| (e / p) * (1.0 - p))
}

/// The step a job is on (running) or stopped at (failed), 1-based, of how many, and its name.
fn current_step(job: &Job) -> Option<(usize, usize, String)> {
    let want = if CiState::of(&job.status) == CiState::Fail {
        CiState::Fail
    } else {
        CiState::Run
    };
    let at = job
        .steps
        .iter()
        .position(|s| CiState::of(&s.status) == want)?;
    Some((at + 1, job.steps.len(), job.steps[at].name.clone()))
}

/// The CI state glyph: a filled diamond, ring while running, dash when skipped.
#[component]
pub fn CiGlyph(state: CiState) -> impl IntoView {
    view! { <span class=format!("pn-ci-glyph {}", state.class())></span> }
}

/// Elapsed time that keeps counting while open.
#[component]
fn Elapsed(from: Option<String>, to: Option<String>) -> impl IntoView {
    let now = use_now();
    move || {
        secs(from.as_deref(), to.as_deref(), now.0.get())
            .map(|s| view! { <span class="t-mono pn-small faint pn-elapsed">{dur(s)}</span> })
    }
}

/// A 2px bar easing to each value, tinted by state, with a travelling band while it runs.
#[component]
fn CiProgress(value: f64, state: CiState, #[prop(default = true)] pct: bool) -> impl IntoView {
    let w = (value.clamp(0.0, 1.0) * 100.0).round();
    view! {
        <div class="pn-ci-progress">
            <span class=format!("pn-ci-track {}", state.class())>
                <span class="pn-ci-fill" style=format!("width:{w}%")></span>
            </span>
            {pct.then(|| view! { <span class=format!("t-mono pn-ci-pct {}", state.class())>{format!("{w}%")}</span> })}
        </div>
    }
}

fn headline(run: &Run, now: f64) -> String {
    let st = CiState::of(&run.status);
    let took = secs(run.started_at.as_deref(), run.completed_at.as_deref(), now);
    let failed: Vec<&str> = run
        .jobs
        .iter()
        .filter(|j| CiState::of(&j.status) == CiState::Fail)
        .map(|j| j.name.as_str())
        .collect();
    let took_s = took.map(|t| format!(" in {}", dur(t))).unwrap_or_default();
    match st {
        CiState::Fail => format!(
            "Failed{took_s}{}",
            if failed.is_empty() {
                String::new()
            } else {
                format!(" on {}", failed.join(", "))
            }
        ),
        CiState::Ok => format!("Passed{took_s}"),
        CiState::Cancel => "Cancelled".into(),
        CiState::Wait => "Queued, waiting for a runner".into(),
        _ => {
            let done = run
                .jobs
                .iter()
                .filter(|j| CiState::of(&j.status).done())
                .count();
            format!("Running · {done} of {} jobs done", run.jobs.len())
        }
    }
}

#[component]
pub fn PrsPanel() -> impl IntoView {
    let app = state::get();
    let ci = store();
    let tab = RwSignal::new("pr".to_owned());
    let cwd = Memo::new(move |_| session_cwd());
    let streams = RwSignal::new(None::<Result<Value, String>>);
    let load_streams = move || {
        let (Some(c), Some(client)) = (cwd.get_untracked(), app.conn.client()) else {
            return;
        };
        spawn_local(async move {
            let r = client
                .checkout_streams_get_graph(&c, false)
                .await
                .map_err(|e| e.to_string())
                .and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string()))
                .and_then(|v| match v["error"]["message"].as_str() {
                    Some(m) => Err(m.to_owned()),
                    None => Ok(v),
                });
            streams.set(Some(r));
        });
    };
    let load = move || {
        if let (Some(c), true) = (cwd.get_untracked(), online()) {
            ci.load(c);
            if tab.get_untracked() == "streams" {
                load_streams();
            }
        }
    };
    Effect::new(move |_| {
        cwd.track();
        if online() {
            load();
        }
    });
    Effect::new(move |prev: Option<String>| {
        let t = tab.get();
        if t == "streams" && prev.as_deref() != Some("streams") && online() {
            load_streams();
        }
        t
    });
    let live = Memo::new(move |_| {
        ci.runs
            .with(|r| r.iter().flatten().any(|r| !CiState::of(&r.status).done()))
    });
    if let Ok(h) = set_interval_with_handle(
        move || {
            if live.get_untracked() {
                load();
            }
        },
        Duration::from_millis(POLL_MS),
    ) {
        on_cleanup(move || h.clear());
    }
    let now = Now(RwSignal::new(js_sys::Date::now()));
    provide_context(now);
    if let Ok(h) = set_interval_with_handle(
        move || {
            if live.get_untracked() {
                now.0.set(js_sys::Date::now());
            }
        },
        Duration::from_millis(1000),
    ) {
        on_cleanup(move || h.clear());
    }
    let tabs = move || {
        let pr_n = ci
            .pr
            .with(|p| p.as_ref().is_some_and(|p| !p["status"].is_null()));
        let runs_n = ci.runs.with(|r| r.as_ref().map(|r| r.len()));
        vec![
            (
                "pr".to_owned(),
                if pr_n {
                    "Pull request · 1".to_owned()
                } else {
                    "Pull request".to_owned()
                },
            ),
            (
                "ci".to_owned(),
                runs_n
                    .map(|n| format!("CI runs · {n}"))
                    .unwrap_or_else(|| "CI runs".into()),
            ),
            ("streams".to_owned(), "Streams".to_owned()),
        ]
    };
    view! {
        <div class="panel pn">
            <PanelHead title="PRs & CI">
                <button class="icon-btn" aria-label="Refresh" on:click=move |_| load()>
                    <Icon ico=Ico::RefreshCw size=14.0 class="faint" />
                </button>
            </PanelHead>
            <div class="pn-views">
                {move || view! { <Seg options=tabs() value=tab on_change=Callback::new(move |v| tab.set(v)) /> }}
            </div>
            <div class="panel-scroll">
                {move || if cwd.get().is_none() {
                    view! { <div class="pn-note">"open a session to see its checkout"</div> }.into_any()
                } else {
                    match tab.get().as_str() {
                        "pr" => view! { <PullRequest on_changed=Callback::new(move |_| load()) /> }.into_any(),
                        "streams" => view! { <StreamList graph=streams /> }.into_any(),
                        _ => view! { <RunList /> }.into_any(),
                    }
                }}
            </div>
        </div>
    }
}

fn auth_hint(state: &str) -> Option<&'static str> {
    match state {
        "unauthenticated" => Some("Sign the host's gh CLI in to see pull requests."),
        "cli_missing" => Some("Install the GitHub CLI (gh) on this host to see pull requests."),
        "no_remote" => Some("This checkout has no forge remote."),
        _ => None,
    }
}

#[component]
fn PullRequest(on_changed: Callback<()>) -> impl IntoView {
    let ci = store();
    move || {
        let Some(pr) = ci.pr.get() else {
            return view! { <div class="t-label pn-note-plain">"loading…"</div> }.into_any();
        };
        let st = &pr["status"];
        if st.is_null() {
            let msg = auth_hint(pr["authState"].as_str().unwrap_or_default())
                .map(str::to_owned)
                .or_else(|| pr["error"]["message"].as_str().map(str::to_owned))
                .unwrap_or_else(|| "No pull request for this branch yet.".into());
            return view! {
                <div class="pn-empty">
                    <Icon ico=Ico::GitPullRequest size=18.0 class="faint" />
                    <span class="pn-muted">{msg}</span>
                </div>
            }
            .into_any();
        }
        let merged = st["isMerged"].as_bool().unwrap_or(false);
        let (badge, cls) = if merged {
            ("MERGED".to_owned(), "merged")
        } else if st["isDraft"].as_bool().unwrap_or(false) {
            ("DRAFT".to_owned(), "draft")
        } else {
            (
                st["state"].as_str().unwrap_or("open").to_uppercase(),
                "open",
            )
        };
        let url = st["url"].as_str().unwrap_or_default().to_owned();
        let review = match st["reviewDecision"].as_str() {
            Some("APPROVED") => "approved",
            Some("CHANGES_REQUESTED") => "changes requested",
            Some("REVIEW_REQUIRED") => "review required",
            _ => "no review decision",
        };
        let auto = if st["github"]["autoMergeRequest"].is_null() {
            " · auto-merge off"
        } else {
            " · auto-merge on"
        };
        let checks: Vec<Value> = st["checks"].as_array().cloned().unwrap_or_default();
        let n = checks.len();
        let status = st.clone();
        view! {
            <GroupHead label="This session" />
            <div class="pn-pr cut flip" style="--c:10px">
                <div class="pn-pr-head">
                    <span class=format!("pn-badge t-mono {cls}")>{badge}</span>
                    <span class="pn-pr-title">{st["title"].as_str().unwrap_or_default().to_owned()}</span>
                    <button class="icon-btn" aria-label="Open pull request" on:click=move |_| crate::native::open_external(&url)>
                        <Icon ico=Ico::ExternalLink size=13.0 class="faint" />
                    </button>
                </div>
                <span class="t-mono pn-small faint">
                    {format!(
                        "{}{} → {}",
                        st["number"].as_u64().map(|n| format!("#{n} · ")).unwrap_or_default(),
                        st["headRefName"].as_str().unwrap_or_default(),
                        st["baseRefName"].as_str().unwrap_or_default()
                    )}
                </span>
                <span class="t-mono pn-small faint">{format!("{review}{auto}")}</span>
                {(!merged).then(|| view! { <MergeButton pr=status on_done=on_changed /> })}
            </div>
            <GroupHead label="Checks" count=Signal::derive(move || n) />
            {checks
                .into_iter()
                .map(|c| view! {
                    <div class="pn-check">
                        <CiGlyph state=CiState::of(c["status"].as_str().unwrap_or_default()) />
                        <span class="pn-line-text">{c["name"].as_str().unwrap_or_default().to_owned()}</span>
                        {c["duration"].as_str().map(|d| view! { <span class="t-mono pn-small faint">{d.to_owned()}</span> })}
                    </div>
                })
                .collect_view()}
        }
        .into_any()
    }
}

const METHODS: [(&str, &str, &str); 3] = [
    ("squash", "Squash and merge", "Squash and merge"),
    ("merge", "Create a merge commit", "Merge"),
    ("rebase", "Rebase and merge", "Rebase and merge"),
];

/// Why the forge would refuse a merge right now, or none when it can go.
fn merge_blocker(pr: &Value) -> Option<String> {
    if pr["isMerged"].as_bool().unwrap_or(false) {
        return Some("Already merged".into());
    }
    if !pr["state"]
        .as_str()
        .unwrap_or("open")
        .eq_ignore_ascii_case("open")
    {
        return Some("Pull request is closed".into());
    }
    let mut parts = Vec::new();
    if pr["isDraft"].as_bool().unwrap_or(false) {
        parts.push("Draft".to_owned());
    }
    let failing = pr["checks"]
        .as_array()
        .map(|c| {
            c.iter()
                .filter(|c| {
                    let s = c["status"].as_str().unwrap_or_default().to_lowercase();
                    s.contains("fail") || s.contains("error") || s.contains("cancel")
                })
                .count()
        })
        .unwrap_or(0);
    if failing > 0 {
        parts.push(format!(
            "{failing} failing check{}",
            if failing == 1 { "" } else { "s" }
        ));
    }
    if pr["mergeable"].as_str() == Some("CONFLICTING") {
        parts.push("Merge conflicts".into());
    }
    match pr["reviewDecision"].as_str() {
        Some("REVIEW_REQUIRED") => parts.push("Review required".into()),
        Some("CHANGES_REQUESTED") => parts.push("Changes requested".into()),
        _ => {}
    }
    (!parts.is_empty()).then(|| parts.join(" · "))
}

/// The merge methods the repository allows (all three when the forge doesn't say).
fn allowed_methods(pr: &Value) -> Vec<&'static str> {
    let repo = &pr["github"]["repository"];
    if repo.is_null() {
        return METHODS.iter().map(|m| m.0).collect();
    }
    let flag = |k: &str| repo[k].as_bool().unwrap_or(false);
    let mut out = Vec::new();
    if flag("squashMergeAllowed") {
        out.push("squash");
    }
    if flag("mergeCommitAllowed") {
        out.push("merge");
    }
    if flag("rebaseMergeAllowed") {
        out.push("rebase");
    }
    out
}

fn default_method(pr: &Value, methods: &[&'static str]) -> &'static str {
    let d = pr["github"]["repository"]["viewerDefaultMergeMethod"]
        .as_str()
        .unwrap_or_default()
        .to_lowercase();
    methods
        .iter()
        .find(|m| **m == d)
        .or(methods.first())
        .copied()
        .unwrap_or("squash")
}

/// The pr-merge-menu split button: merge with the chosen method, or arm auto-merge.
#[component]
fn MergeButton(pr: Value, on_done: Callback<()>) -> impl IntoView {
    let app = state::get();
    let methods = allowed_methods(&pr);
    let method = RwSignal::new(default_method(&pr, &methods));
    let busy = RwSignal::new(false);
    let error = RwSignal::new(None::<String>);
    let menu = RwSignal::new(false);
    let blocker = if methods.is_empty() {
        Some("No merge method is enabled for this repository".to_owned())
    } else {
        merge_blocker(&pr)
    };
    let blocked = blocker.is_some();
    let blocker_m = blocker.clone();
    let auto = pr["github"]["autoMergeRequest"].clone();
    let armed = !auto.is_null();
    let can_auto = pr["github"].is_null()
        || pr["github"]["repository"]["autoMergeAllowed"]
            .as_bool()
            .unwrap_or(false);
    // Runs one forge action and reports its error inline.
    let run = move |merge: bool, enable: bool| {
        let (Some(cwd), Some(c)) = (session_cwd(), app.conn.client()) else {
            return;
        };
        let m = method.get_untracked();
        busy.set(true);
        error.set(None);
        spawn_local(async move {
            let r = if merge {
                c.checkout_pr_merge(&cwd, m)
                    .await
                    .map_err(|e| e.to_string())
                    .and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string()))
            } else {
                c.checkout_forge_set_auto_merge(&cwd, enable, Some(m))
                    .await
                    .map_err(|e| e.to_string())
                    .and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string()))
            };
            busy.set(false);
            let err = match r {
                Ok(v) => v["error"]["message"]
                    .as_str()
                    .or(v["error"].as_str())
                    .map(str::to_owned),
                Err(e) => Some(e),
            };
            error.set(err);
            on_done.run(());
        });
    };
    let items = move || {
        let mut items = Vec::new();
        for (m, label, _) in METHODS.iter().filter(|x| methods.contains(&x.0)) {
            let mut it = MenuItem::new(*label, move || method.set(m));
            if method.get_untracked() == *m {
                it = it.hint("✓");
            }
            items.push(it);
        }
        if can_auto {
            if armed {
                let hint = auto["mergeMethod"]
                    .as_str()
                    .map(|m| format!("armed · {}", m.to_lowercase()))
                    .unwrap_or_else(|| "armed".into());
                items.push(
                    MenuItem::new("Disable auto-merge", move || run(false, false)).hint(hint),
                );
            } else {
                items.push(MenuItem::new(
                    format!("Enable auto-merge ({})", method.get_untracked()),
                    move || run(false, true),
                ));
            }
        }
        if let Some(b) = blocker_m.clone() {
            items.push(MenuItem::new("Merge disabled", || {}).hint(b).danger());
        }
        items
    };
    let label = move || {
        if busy.get() {
            return "Merging…".to_owned();
        }
        let m = method.get();
        METHODS
            .iter()
            .find(|x| x.0 == m)
            .map(|x| x.2)
            .unwrap_or("Merge")
            .to_owned()
    };
    view! {
        <div class="pn-merge">
            <div class="pn-merge-row pn-rel">
                <button
                    class="pn-merge-main cut"
                    class:off=blocked
                    style="--c:6px"
                    disabled=move || blocked || busy.get()
                    title=blocker.clone().unwrap_or_default()
                    on:click=move |_| run(true, false)
                >
                    {label}
                </button>
                <button class="pn-merge-chev" class:off=blocked aria-label="Merge options" on:click=move |_| menu.set(true)>
                    <Icon ico=Ico::ChevronDown size=13.0 />
                </button>
                {move || menu.get().then(|| view! {
                    <Menu open=menu on_close=Callback::new(move |_| menu.set(false)) items=items() align_right=true />
                })}
            </div>
            {armed.then(|| view! { <span class="t-mono pn-merge-note">"auto-merge on"</span> })}
            {blocker.clone().map(|b| view! { <span class="t-mono pn-small faint">{b}</span> })}
            {move || error.get().map(|e| view! { <span class="t-mono pn-error-inline">{e}</span> })}
        </div>
    }
}

#[component]
fn RunList() -> impl IntoView {
    let ci = store();
    let scope = RwSignal::new("all".to_owned());
    move || {
        let Some(runs) = ci.runs.get() else {
            return view! { <SkeletonRows rows=4 /> }.into_any();
        };
        let branch = ci.branch.get();
        let shown: Vec<Run> = match (&branch, scope.get().as_str()) {
            (Some(b), "branch") => runs
                .into_iter()
                .filter(|r| r.branch.as_ref() == Some(b))
                .collect(),
            _ => runs,
        };
        let tally = |s: CiState| shown.iter().filter(|r| CiState::of(&r.status) == s).count();
        let (ok, fail, live) = (
            tally(CiState::Ok),
            tally(CiState::Fail),
            tally(CiState::Run) + tally(CiState::Wait),
        );
        let first_live = shown
            .iter()
            .find(|r| CiState::of(&r.status) == CiState::Run)
            .map(|r| r.id.clone());
        view! {
            {ci.provider_errors.get().into_iter().map(|(p, m)| view! { <div class="pn-error t-mono">{format!("{p}: {m}")}</div> }).collect_view()}
            {branch.clone().map(|b| view! {
                <div class="pn-views">
                    <Seg
                        options=vec![("branch".into(), b), ("all".into(), "All branches".into())]
                        value=scope
                        on_change=Callback::new(move |v| scope.set(v))
                    />
                </div>
            })}
            {(!shown.is_empty()).then(|| view! {
                <div class="t-mono pn-tally">
                    <span class="mint">{format!("{ok} passed")}</span>
                    <span class="coral">{format!("{fail} failed")}</span>
                    <span class="cyan2">{format!("{live} live")}</span>
                </div>
            })}
            {shown.is_empty().then(|| view! { <div class="pn-empty pn-muted">"No CI runs for this repository."</div> })}
            {shown
                .into_iter()
                .map(|r| {
                    let open = first_live.as_ref() == Some(&r.id);
                    view! { <RunRow run=r default_open=open /> }
                })
                .collect_view()}
        }
        .into_any()
    }
}

fn run_caption(run: &Run, st: CiState) -> Option<String> {
    let failed: Vec<&str> = run
        .jobs
        .iter()
        .filter(|j| CiState::of(&j.status) == CiState::Fail)
        .map(|j| j.name.as_str())
        .collect();
    match st {
        CiState::Fail if !failed.is_empty() => Some(format!("{} failed", failed.join(", "))),
        CiState::Wait => Some("queued · waiting for a runner".into()),
        CiState::Cancel => Some("cancelled".into()),
        CiState::Run => {
            let live: Vec<&str> = run
                .jobs
                .iter()
                .filter(|j| CiState::of(&j.status) == CiState::Run)
                .map(|j| j.name.as_str())
                .collect();
            (!live.is_empty()).then(|| format!("running {}", live.join(", ")))
        }
        _ => None,
    }
}

/// A run in the side list: glyph, title, elapsed; meta; a progress bar with time left while it
/// runs. The chevron unfolds the job list in place.
#[component]
fn RunRow(run: Run, default_open: bool) -> impl IntoView {
    let app = state::get();
    let now = use_now();
    let open = RwSignal::new(default_open);
    let id = run.id.clone();
    let on = Signal::derive({
        let id = id.clone();
        move || app.ui.open_run.get().as_deref() == Some(id.as_str())
    });
    let st = CiState::of(&run.status);
    let meta = [
        Some(run.pipeline.clone()),
        run.number.map(|n| format!("#{n}")),
        run.branch.clone(),
        run.actor.clone(),
        run.sha.as_ref().map(|s| s.chars().take(7).collect()),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" · ");
    let progress = run.progress();
    let caption = run_caption(&run, st);
    let jobs_n = run.jobs.len();
    let started = run.started_at.clone();
    let r2 = run.clone();
    view! {
        <div class="pn-run-wrap">
            <div class="pn-row pn-run" class:on=move || on.get() role="button" on:click=move |_| {
                app.ui.open_run.set(Some(id.clone()));
                app.ui.list_open.set(false);
            }>
                <Brackets on=on />
                <CiGlyph state=st />
                <div class="pn-row-text">
                    <div class="pn-run-head">
                        <span class="pn-row-title">{run.title.clone().unwrap_or_else(|| run.pipeline.clone())}</span>
                        {run.attempt.filter(|a| *a > 1.0).map(|a| view! { <span class="t-mono pn-small faint">{format!("attempt {a}")}</span> })}
                        <Elapsed from=run.started_at.clone() to=run.completed_at.clone() />
                    </div>
                    <div class="pn-run-metarow">
                        <span class="pn-row-meta t-mono">{meta}</span>
                        <button
                            class="pn-run-jobs-btn"
                            aria-expanded=move || open.get().to_string()
                            aria-label=move || if open.get() { "Hide jobs" } else { "Show jobs" }
                            on:click=move |ev| {
                                ev.stop_propagation();
                                open.update(|o| *o = !*o);
                            }
                        >
                            <span class="t-mono">{format!("{jobs_n} jobs")}</span>
                            <span class="pn-chev" class:open=move || open.get()><Icon ico=Ico::ChevronRight size=12.0 /></span>
                        </button>
                    </div>
                    {(st == CiState::Run).then(|| view! {
                        <div class="pn-run-progress">
                            <CiProgress value=progress state=st />
                            {move || eta(secs(started.as_deref(), None, now.0.get()), Some(progress))
                                .map(|l| view! { <span class="t-mono pn-small faint">{format!("~{} left", dur(l))}</span> })}
                        </div>
                    })}
                    {caption.map(|c| view! { <span class=format!("t-mono pn-run-cap {}", st.class())>{c}</span> })}
                </div>
            </div>
            {move || open.get().then(|| {
                let r = r2.clone();
                view! {
                    <div class="pn-run-jobs">
                        {r.jobs.iter().cloned().map(|j| view! { <JobRow job=j /> }).collect_view()}
                        <RunActions run=r />
                    </div>
                }
            })}
        </div>
    }
}

fn step_line(job: &Job, st: CiState) -> Option<String> {
    let step = current_step(job);
    match (st, step) {
        (CiState::Run, Some((n, of, name))) => Some(format!("{n}/{of} · {name}")),
        (CiState::Fail, Some((_, _, name))) => Some(format!("failed at {name}")),
        (CiState::Wait, _) => Some("queued".into()),
        (CiState::Cancel, _) => Some("cancelled".into()),
        (CiState::Skip, _) => Some("skipped".into()),
        _ => None,
    }
}

/// One job: glyph, name, current step, time; a mini bar while running.
#[component]
fn JobRow(
    job: Job,
    #[prop(optional)] selected: Option<Signal<bool>>,
    #[prop(optional)] on_press: Option<Callback<String>>,
) -> impl IntoView {
    let now = use_now();
    let st = CiState::of(&job.status);
    let sub = step_line(&job, st);
    let quiet = matches!(st, CiState::Skip | CiState::Cancel | CiState::Wait);
    let id = job.id.clone();
    let progress = job.progress;
    let started = job.started_at.clone();
    let on = selected.unwrap_or_else(|| Signal::derive(|| false));
    view! {
        <div
            class="pn-job"
            class:on=move || on.get()
            class:press=on_press.is_some()
            role=on_press.map(|_| "button")
            on:click=move |_| {
                if let Some(cb) = on_press {
                    cb.run(id.clone());
                }
            }
        >
            {on_press.map(|_| view! { <Brackets on=on /> })}
            <div class="pn-job-head">
                <CiGlyph state=st />
                <span class="pn-line-text" class:faint=quiet>{job.name.clone()}</span>
                {job.attempt.filter(|a| *a > 1.0).map(|a| view! { <span class="t-mono pn-small faint">{format!("#{a}")}</span> })}
                {(st == CiState::Run).then(|| {
                    let started = started.clone();
                    move || eta(secs(started.as_deref(), None, now.0.get()), progress)
                        .map(|l| view! { <span class="t-mono pn-small faint">{format!("~{} left", dur(l))}</span> })
                })}
                <Elapsed from=job.started_at.clone() to=job.completed_at.clone() />
            </div>
            {sub.map(|s| view! { <span class=format!("t-mono pn-job-sub {}", st.class())>{s}</span> })}
            {(st == CiState::Run).then(|| progress.map(|p| view! { <CiProgress value=p state=st pct=false /> }))}
        </div>
    }
}

/// Run actions. Re-run and cancel are not daemon RPCs yet (ui-next only shows them when the lab
/// registers handlers), so only Open logs, which goes to the forge.
#[component]
fn RunActions(run: Run) -> impl IntoView {
    let url = run
        .jobs
        .iter()
        .find(|j| CiState::of(&j.status) == CiState::Fail)
        .and_then(|j| j.url.clone())
        .or(run.url.clone());
    url.map(|u| {
        view! {
            <div class="pn-run-actions">
                <Button
                    label="Open logs"
                    icon=Ico::ExternalLink
                    on_press=Callback::new(move |_| crate::native::open_external(&u))
                />
            </div>
        }
    })
}

/// Stream identity colours; green is kept for "released", so no stream is green.
fn stream_tint(kind: &str, channel: &str) -> &'static str {
    match kind {
        "development" => "var(--cyan)",
        "stable" => "var(--text)",
        "feature" => "var(--violet)",
        _ if channel == "stable" => "var(--mint)",
        _ => "var(--cyan)",
    }
}

fn flow_text(f: &Value) -> String {
    let n = f["pending"].as_f64().unwrap_or(0.0) as u64;
    let commits = format!("{n} commit{}", if n == 1 { "" } else { "s" });
    let to = f["to"].as_str().unwrap_or_default();
    match f["kind"].as_str().unwrap_or_default() {
        "promote" => format!("{commits} ready to promote to {to}"),
        "backport" => format!("{commits} to backport to {to}"),
        "forward-port" => format!("{commits} to carry forward to {to}"),
        "sync" => format!("{to} is {commits} behind; sync to catch up"),
        "contribute" => format!("{commits} to contribute to {to}"),
        k => format!("{commits} → {to} ({k})"),
    }
}

/// The Streams tab: one row per long-lived branch with what is waiting on it; open one to list
/// those changes and what moves them on.
#[component]
fn StreamList(graph: RwSignal<Option<Result<Value, String>>>) -> impl IntoView {
    let open = RwSignal::new(None::<String>);
    move || match graph.get() {
        None => view! { <SkeletonRows rows=4 /> }.into_any(),
        Some(Err(e)) => view! { <div class="pn-error t-mono">{e}</div> }.into_any(),
        Some(Ok(g)) => {
            let streams = g["streams"].as_array().cloned().unwrap_or_default();
            if streams.is_empty() {
                return view! { <div class="pn-empty pn-muted">"No release streams for this repository."</div> }
                    .into_any();
            }
            let max = streams
                .iter()
                .filter_map(|s| s["unreleased"].as_f64())
                .fold(1.0f64, f64::max);
            let declared = g["config"]["declared"].as_bool();
            let g = StoredValue::new(g);
            view! {
                <p class="pn-stream-lede">
                    "Streams are the long-lived branches releases ship from. The number is how many commits on each aren’t in a release yet; open one to see them and what moves them on."
                </p>
                {streams
                    .into_iter()
                    .enumerate()
                    .map(|(i, s)| view! { <StreamRow st=s i=i max=max graph=g open=open /> })
                    .collect_view()}
                {(declared == Some(false)).then(|| view! {
                    <div class="t-mono pn-stream-foot">"default streams · declare them in frogg.json"</div>
                })}
            }
            .into_any()
        }
    }
}

#[component]
fn StreamRow(
    st: Value,
    i: usize,
    max: f64,
    graph: StoredValue<Value>,
    open: RwSignal<Option<String>>,
) -> impl IntoView {
    let id = st["id"].as_str().unwrap_or_default().to_owned();
    let exists = st["exists"].as_bool().unwrap_or(false);
    let kind = st["kind"].as_str().unwrap_or_default().to_owned();
    let tint = stream_tint(&kind, st["channel"].as_str().unwrap_or_default());
    let unreleased = st["unreleased"].as_f64().unwrap_or(0.0);
    let tag = st["releases"][0]["tag"].as_str().map(str::to_owned);
    let count_label = graph.with_value(|g| {
        if !exists {
            "missing".to_owned()
        } else if kind != "feature" {
            "unreleased".to_owned()
        } else {
            let behind = g["flows"]
                .as_array()
                .and_then(|f| {
                    f.iter()
                        .find(|f| f["to"] == id.as_str() && f["kind"] == "sync")
                })
                .and_then(|f| f["pending"].as_f64())
                .unwrap_or(0.0);
            if behind > 0.0 {
                format!("ahead · {behind} behind")
            } else {
                "ahead".to_owned()
            }
        }
    });
    let id2 = id.clone();
    let on = Signal::derive(move || open.get().as_deref() == Some(id2.as_str()));
    let id3 = id.clone();
    let toggle = move |_| {
        if exists {
            open.update(|o| {
                *o = if o.as_deref() == Some(id3.as_str()) {
                    None
                } else {
                    Some(id3.clone())
                }
            });
        }
    };
    let body = move || {
        on.get().then(|| {
            graph.with_value(|g| {
                let flows: Vec<Value> = g["flows"]
                    .as_array()
                    .map(|f| {
                        f.iter()
                            .filter(|f| f["from"] == id.as_str() && f["pending"].as_f64().unwrap_or(0.0) > 0.0)
                            .cloned()
                            .collect()
                    })
                    .unwrap_or_default();
                let waiting: Vec<(Value, Option<Value>)> = g["changes"]
                    .as_array()
                    .map(|c| {
                        c.iter()
                            .filter_map(|c| {
                                let here = c["presence"].as_array()?.iter().find(|p| p["stream"] == id.as_str()).cloned();
                                let wait = here.as_ref().is_some_and(|p| p["state"] == "landed" || p["state"] == "pending");
                                wait.then(|| (c.clone(), here))
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                view! {
                    <div class="pn-stream-changes">
                        {flows.into_iter().map(|f| view! {
                            <div class="pn-flow">
                                <span>{flow_text(&f)}</span>
                                {f["command"].as_str().map(|c| view! { <span class="t-mono pn-flow-cmd">{c.to_owned()}</span> })}
                            </div>
                        }).collect_view()}
                        {if waiting.is_empty() {
                            view! { <span class="pn-muted">"Everything here is released."</span> }.into_any()
                        } else {
                            view! {
                                <div class="pn-legend t-mono">
                                    <span><i class="pn-diamond"></i>"on the branch, not released"</span>
                                    <span><i class="pn-diamond pending"></i>"on its way here"</span>
                                </div>
                            }.into_any()
                        }}
                        {waiting.into_iter().take(30).enumerate().map(|(n, (c, here))| {
                            let state = here.as_ref().and_then(|p| p["state"].as_str()).unwrap_or_default().to_owned();
                            let backport = here.as_ref().is_some_and(|p| p["via"] == "backport");
                            view! {
                                <div class="pn-change" style=format!("animation-delay:{}ms", n.min(10) * 22)>
                                    <i class="pn-diamond" class:pending=state == "pending" class:shipped=state == "shipped"></i>
                                    <span class="pn-change-subject">{c["subject"].as_str().unwrap_or_default().to_owned()}</span>
                                    {backport.then(|| view! { <span class="t-mono pn-small faint">"backport"</span> })}
                                    <span class="t-mono pn-small faint">{c["sha"].as_str().unwrap_or_default().chars().take(7).collect::<String>()}</span>
                                </div>
                            }
                        }).collect_view()}
                    </div>
                }
            })
        })
    };
    view! {
        <div class="pn-stream" style=format!("animation-delay:{}ms", i * 40)>
            <div class="pn-stream-row" class:on=move || on.get() class:missing=!exists role="button" aria-expanded=move || on.get().to_string() on:click=toggle>
                <Brackets on=on />
                <span class="pn-chev" class:open=move || on.get()><Icon ico=Ico::ChevronRight size=12.0 /></span>
                <span class="pn-stream-dot" style=format!("background:{tint}")></span>
                <div class="pn-stream-main">
                    <div class="pn-stream-line">
                        <span class="pn-stream-name">{st["label"].as_str().unwrap_or_default().to_owned()}</span>
                        {tag.map(|t| view! { <span class="t-mono pn-small faint">{t}</span> })}
                    </div>
                    <span class="pn-stream-track">
                        <span style=format!("background:{tint};width:{}%", (unreleased / max * 100.0).round())></span>
                    </span>
                </div>
                <div class="pn-stream-count">
                    {exists.then(|| view! { <span class="t-mono pn-stream-num">{unreleased as u64}</span> })}
                    <span class="t-mono pn-small faint">{count_label}</span>
                </div>
            </div>
            {body}
        </div>
    }
}

/// A CI run in the main pane: header with actions, jobs, and the picked job's steps.
#[component]
pub fn CiRunDetail(
    id: String,
    #[prop(optional_no_strip)] on_back: Option<Callback<()>>,
) -> impl IntoView {
    let ci = store();
    let pick = RwSignal::new(None::<String>);
    let run = Memo::new(move |_| ci.find(&id));
    // The detail lives outside the panel, so it keeps its own clock.
    let now = Now(RwSignal::new(js_sys::Date::now()));
    provide_context(now);
    if let Ok(h) = set_interval_with_handle(
        move || {
            if run.with_untracked(|r| r.as_ref().is_some_and(|r| r.completed_at.is_none())) {
                now.0.set(js_sys::Date::now());
            }
        },
        Duration::from_millis(1000),
    ) {
        on_cleanup(move || h.clear());
    }
    move || {
        let Some(run) = run.get() else {
            return view! { <div class="detail"></div> }.into_any();
        };
        let st = CiState::of(&run.status);
        let fallback = run
            .jobs
            .iter()
            .find(|j| CiState::of(&j.status) == CiState::Fail)
            .or_else(|| {
                run.jobs
                    .iter()
                    .find(|j| CiState::of(&j.status) == CiState::Run)
            })
            .or(run.jobs.first())
            .map(|j| j.id.clone());
        let job_id = pick.get().or(fallback);
        let job = run
            .jobs
            .iter()
            .find(|j| Some(&j.id) == job_id.as_ref())
            .cloned();
        let url = run.url.clone();
        let meta = [
            run.trigger.clone(),
            run.actor.clone(),
            run.sha.as_ref().map(|s| s.chars().take(7).collect()),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" · ");
        let r_head = run.clone();
        let r_act = run.clone();
        view! {
            <div class="detail pn-run-detail">
                <div class="pn-diff-head">
                    <div class="pn-viewer-titles">
                        <span class="t-label">
                            {format!("ci run{} · {}", run.number.map(|n| format!(" #{n}")).unwrap_or_default(), forge(&run.provider))}
                        </span>
                        <div class="pn-viewer-title-row">
                            {on_back.map(|b| view! {
                                <button class="icon-btn" aria-label="Back" on:click=move |_| b.run(())>
                                    <Icon ico=Ico::ArrowLeft size=18.0 />
                                </button>
                            })}
                            <span class="t-display pn-viewer-title">
                                {format!("{}{}", run.pipeline, run.branch.as_ref().map(|b| format!(" · {b}")).unwrap_or_default())}
                            </span>
                        </div>
                        <div class="pn-run-meta">
                            <CiGlyph state=st />
                            <span class=format!("pn-run-cap {}", st.class())>{move || headline(&r_head, now.0.get())}</span>
                            {(!meta.is_empty()).then(|| view! { <span class="t-mono pn-small faint">{meta}</span> })}
                        </div>
                        {run.title.clone().map(|t| view! { <span class="pn-muted pn-run-title">{t}</span> })}
                        {(!st.done()).then(|| view! { <CiProgress value=run.progress() state=st /> })}
                    </div>
                    <span class="spacer"></span>
                    <RunActions run=r_act />
                    {url.map(|u| view! {
                        <button class="icon-btn" aria-label="Open in browser" on:click=move |_| crate::native::open_external(&u)>
                            <Icon ico=Ico::ExternalLink size=14.0 class="faint" />
                        </button>
                    })}
                </div>
                <div class="pn-run-body">
                    <div class="pn-jobs">
                        <GroupHead label="Jobs" count=Signal::derive({ let n = run.jobs.len(); move || n }) />
                        {run.jobs
                            .iter()
                            .cloned()
                            .map(|j| {
                                let on = job_id.as_ref() == Some(&j.id);
                                view! {
                                    <JobRow
                                        job=j
                                        selected=Signal::derive(move || on)
                                        on_press=Callback::new(move |id| pick.set(Some(id)))
                                    />
                                }
                            })
                            .collect_view()}
                    </div>
                    <div class="pn-steps">
                        {job.map(|j| view! {
                            <GroupHead label=format!("Steps · {}", j.name) />
                            {j.steps
                                .into_iter()
                                .enumerate()
                                .map(|(i, s)| view! {
                                    <div class="pn-check">
                                        <span class="t-mono pn-small faint pn-step-n">{i + 1}</span>
                                        <CiGlyph state=CiState::of(&s.status) />
                                        <span class="pn-line-text">{s.name}</span>
                                    </div>
                                })
                                .collect_view()}
                        })}
                    </div>
                </div>
            </div>
        }
        .into_any()
    }
}
