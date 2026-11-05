//! PRs & CI (ui-next `PrsPanel.tsx`, `ci/*`): the branch's pull request with its checks and a
//! merge action, the repository's CI runs (polled while any is live), and a run's jobs and steps
//! in the main pane.

use std::time::Duration;

use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::Value;

use crate::components::{Brackets, Button, ButtonKind, Ico, Icon, Seg};
use crate::shell::panel_head::{GroupHead, PanelHead};
use crate::shell::toast::{Toast, ToastKind};
use crate::state::checkout::{online, session_cwd};
use crate::state::ci::{dur, seconds, store, CiState, Run};
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

/// The CI state glyph: a filled diamond, ring while running, dash when skipped.
#[component]
pub fn CiGlyph(state: CiState) -> impl IntoView {
    view! { <span class=format!("pn-ci-glyph {}", state.class())></span> }
}

fn headline(run: &Run) -> String {
    let st = CiState::of(&run.status);
    let took = seconds(run.started_at.as_deref(), run.completed_at.as_deref());
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
    let ci = store();
    let tab = RwSignal::new("pr".to_owned());
    let cwd = Memo::new(move |_| session_cwd());
    let load = move || {
        if let (Some(c), true) = (cwd.get_untracked(), online()) {
            ci.load(c);
        }
    };
    Effect::new(move |_| {
        cwd.track();
        if online() {
            load();
        }
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
                } else if tab.get() == "pr" {
                    view! { <PullRequest on_changed=Callback::new(move |_| load()) /> }.into_any()
                } else {
                    view! { <RunList /> }.into_any()
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
                {(!merged).then(|| view! { <MergeButton on_done=on_changed /> })}
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

#[component]
fn MergeButton(on_done: Callback<()>) -> impl IntoView {
    let app = state::get();
    let busy = RwSignal::new(false);
    let merge = move |method: &'static str| {
        let (Some(cwd), Some(c)) = (session_cwd(), app.conn.client()) else {
            return;
        };
        busy.set(true);
        spawn_local(async move {
            let r = c
                .checkout_pr_merge(&cwd, method)
                .await
                .map_err(|e| e.to_string())
                .and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string()));
            busy.set(false);
            let err = match r {
                Ok(v) => v["error"]["message"]
                    .as_str()
                    .or(v["error"].as_str())
                    .map(str::to_owned),
                Err(e) => Some(e),
            };
            match err {
                Some(e) => app
                    .toasts
                    .push(Toast::new(ToastKind::Error, "Couldn't merge").detail(e)),
                None => app
                    .toasts
                    .push(Toast::new(ToastKind::Ok, "Pull request merged")),
            };
            on_done.run(());
        });
    };
    view! {
        <div class="pn-sync">
            <Button kind=ButtonKind::Primary label="Squash and merge" disabled=busy on_press=Callback::new(move |_| merge("squash")) />
            <Button label="Merge" disabled=busy on_press=Callback::new(move |_| merge("merge")) />
        </div>
    }
}

#[component]
fn RunList() -> impl IntoView {
    let app = state::get();
    let ci = store();
    let scope = RwSignal::new("all".to_owned());
    move || {
        let Some(runs) = ci.runs.get() else {
            return view! { <div class="t-label pn-note-plain">"loading…"</div> }.into_any();
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
                    let id = r.id.clone();
                    let on = Signal::derive({
                        let id = id.clone();
                        move || app.ui.open_run.get().as_deref() == Some(id.as_str())
                    });
                    let st = CiState::of(&r.status);
                    let meta = [
                        r.number.map(|n| format!("#{n}")),
                        r.branch.clone(),
                        Some(forge(&r.provider)),
                    ]
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join(" · ");
                    let pct = (r.progress() * 100.0).round();
                    view! {
                        <div class="pn-row pn-run" class:on=move || on.get() role="button" on:click=move |_| {
                            app.ui.open_run.set(Some(id.clone()));
                            app.ui.list_open.set(false);
                        }>
                            <Brackets on=on />
                            <CiGlyph state=st />
                            <div class="pn-row-text">
                                <span class="pn-row-title">{r.pipeline.clone()}</span>
                                <span class="pn-row-meta t-mono">{meta}</span>
                                <span class=format!("pn-run-cap {}", st.class())>{headline(&r)}</span>
                                {(!st.done()).then(|| view! {
                                    <span class="pn-progress"><span style=format!("width:{pct}%")></span></span>
                                })}
                            </div>
                        </div>
                    }
                })
                .collect_view()}
        }
        .into_any()
    }
}

/// A CI run in the main pane: header, jobs, and the picked job's steps.
#[component]
pub fn CiRunDetail(
    id: String,
    #[prop(optional_no_strip)] on_back: Option<Callback<()>>,
) -> impl IntoView {
    let ci = store();
    let pick = RwSignal::new(None::<String>);
    let run = Memo::new(move |_| ci.find(&id));
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
                            <span class=format!("pn-run-cap {}", st.class())>{headline(&run)}</span>
                            {run.trigger.clone().map(|t| view! { <span class="t-mono pn-small faint">{t}</span> })}
                        </div>
                    </div>
                    <span class="spacer"></span>
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
                            .map(|j| {
                                let jid = j.id.clone();
                                let on = job_id.as_ref() == Some(&j.id);
                                let took = seconds(j.started_at.as_deref(), j.completed_at.as_deref());
                                view! {
                                    <div class="pn-row tight" class:on=on role="button" on:click=move |_| pick.set(Some(jid.clone()))>
                                        <Brackets on=Signal::derive(move || on) />
                                        <CiGlyph state=CiState::of(&j.status) />
                                        <span class="pn-line-text">{j.name.clone()}</span>
                                        {took.map(|t| view! { <span class="t-mono pn-small faint">{dur(t)}</span> })}
                                    </div>
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
