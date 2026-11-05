//! "App" pages (ui-next `OnboardingSettings.tsx`, `Privacy.tsx` + `BugReport.tsx`, `About.tsx`,
//! `AppUpdates.tsx`).

use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::json;

use crate::components::{Button, ButtonKind, Ico, Seg};
use crate::native;
use crate::state::config::{self, need, ns, Action};
use crate::state::onboarding::{self, progress_of, Level, Status, LEVELS, WORKS};
use crate::state::Conn;
use crate::views::flows::onboarding::Progress;
use crate::views::settings::kit::*;

const RELEASES_PAGE: &str = "https://github.com/frogg-app/frogg/releases";
const NOTICES: &str = "https://github.com/frogg-app/frogg/blob/main/NOTICE";

#[component]
pub fn GettingStarted() -> impl IntoView {
    let ob = onboarding::get();
    let status = Memo::new(move |_| ob.state.with(|s| s.status));
    let progress = Memo::new(move |_| progress_of(&onboarding::done()));
    let level = Signal::derive(move || {
        let l = ob.state.with(|s| s.level).unwrap_or(Level::Some);
        LEVELS
            .iter()
            .position(|x| x.0 == l)
            .unwrap_or(1)
            .to_string()
    });
    view! {
        <Section title="Walkthrough">
            <Row
                label="Progress"
                hint=Signal::derive(move || {
                    if status.get() == Status::Finished {
                        "Finished. Run it again any time.".to_owned()
                    } else {
                        let (n, t) = progress.get();
                        format!("{n} of {t} steps done")
                    }
                })
            >
                <span class="ob-progress-wrap">
                    <Progress done=Signal::derive(move || progress.get().0) total=Signal::derive(move || progress.get().1) />
                </span>
            </Row>
            <Row
                label=Signal::derive(move || if matches!(status.get(), Status::Finished | Status::New) { "Open the walkthrough".to_owned() } else { "Resume where you left off".to_owned() })
                hint="Also in the command palette: Getting started."
            >
                <Button label="Open" icon=Ico::Play kind=ButtonKind::Primary on_press=Callback::new(move |_| ob.open(None)) />
            </Row>
            <Row label="Start over" hint="Back to the first question; your answers are kept.">
                <Button label="Restart" icon=Ico::RotateCcw on_press=Callback::new(move |_| ob.restart()) />
            </Row>
        </Section>
        <Section title="Your answers">
            <Row label="How much to explain" hint="Changes how much each step and hint spells out.">
                <Seg
                    options=LEVELS.iter().enumerate().map(|(i, l)| (i.to_string(), l.1.to_owned())).collect()
                    value=level
                    on_change=Callback::new(move |v: String| {
                        if let Some(l) = v.parse::<usize>().ok().and_then(|i| LEVELS.get(i)) {
                            ob.set_level(l.0);
                        }
                    })
                />
            </Row>
            <Row label="Your work" hint="Picks the starter prompts, concepts and suggested settings.">
                <div class="chips">
                    {WORKS.iter().map(|(w, title, _)| {
                        let w = *w;
                        view! {
                            <button class="choice" class:on=move || ob.state.with(|s| s.work.contains(&w)) on:click=move |_| ob.toggle_work(w)>
                                {*title}
                            </button>
                        }
                    }).collect_view()}
                </div>
            </Row>
            <Row label="Forget answers" hint="Clears answers and progress on this device. Nothing on the host changes.">
                <Button label="Forget" kind=ButtonKind::Danger on_press=Callback::new(move |_| ob.reset()) />
            </Row>
        </Section>
    }
}

/// Privacy & feedback: usage statistics for the connected host, and Report a bug. This build
/// has no statistics or bug-report collector, so nothing leaves the device from here except
/// the host's own switch, which the daemon owns.
#[component]
pub fn Privacy() -> impl IntoView {
    let app = crate::state::get();
    let cfg = config::get();
    let host_stats = Memo::new(move |_| cfg.at("/usageStats").and_then(|v| v.as_bool()));
    let owner = config::caller_role().as_deref() == Some("owner");
    let host = Signal::derive(move || {
        app.conn
            .active_link()
            .server_name
            .unwrap_or_else(|| "this host".to_owned())
    });
    view! {
        <Section title="Usage statistics">
            <Row label="Send usage statistics" hint="This build has no statistics collector, so nothing is ever sent from this device.">
                <Toggle value=false disabled=true on_change=Callback::new(|_| {}) label="Send usage statistics" />
            </Row>
            <Row
                label=Signal::derive(move || format!("Send from {}", host.get()))
                hint=Signal::derive(move || match host_stats.get() {
                    None => "Needs a newer daemon on this host".to_owned(),
                    Some(_) => format!(
                        "The daemon's version, OS and provider count, once a day. Each batch is logged to usage-stats.log in the host's Frogg home.{}",
                        if owner { "" } else { " Only the host's owner can change this." }
                    ),
                })
            >
                <Toggle
                    value=Signal::derive(move || host_stats.get() == Some(true))
                    disabled=Signal::derive(move || !owner || host_stats.get().is_none())
                    on_change=Callback::new(move |v: bool| cfg.patch(json!({ "usageStats": v })))
                    label="Send usage statistics from this host"
                />
            </Row>
        </Section>
        <BugReport />
    }
}

/// Report a bug: describe it, build a report on this device, review and edit it, then copy it.
#[component]
fn BugReport() -> impl IntoView {
    let description = RwSignal::new(String::new());
    let draft = RwSignal::new(None::<String>);
    let done = RwSignal::new(None::<String>);
    let preview = move |_| {
        let info = config::host_version().unwrap_or_else(|| "unknown".to_owned());
        let text = format!(
            "## Bug report\n\n{}\n\n## Environment\n\n- App: Frogg Next RS {} ({})\n- Daemon: {}\n- User agent: {}\n",
            description.get_untracked().trim(),
            env!("CARGO_PKG_VERSION"),
            platform_name(),
            info,
            web_sys::window().and_then(|w| w.navigator().user_agent().ok()).unwrap_or_default(),
        );
        draft.set(Some(text));
        done.set(None);
    };
    let copy = move |_| {
        if let Some(t) = draft.get_untracked() {
            spawn_local(async move {
                let ok = native::clipboard_write(&t).await.is_ok();
                done.set(Some(if ok {
                    "Copied. Paste it wherever you report issues.".to_owned()
                } else {
                    "Couldn't copy here; select the text and copy it.".to_owned()
                }));
            });
        }
    };
    view! {
        <Section title="Report a bug">
            <Block>
                <textarea
                    class="set-area"
                    placeholder="What happened, and what did you expect?"
                    prop:value=move || description.get()
                    on:input=move |ev| description.set(event_target_value(&ev))
                ></textarea>
            </Block>
            <Row label="Preview" hint="Builds the report on this device; nothing is sent">
                <Button label="Preview report" kind=ButtonKind::Primary on_press=Callback::new(preview) />
            </Row>
        </Section>
        {move || draft.get().is_some().then(|| view! {
            <Section title="Review before sharing">
                <Block>
                    <textarea
                        class="set-area tall t-mono"
                        prop:value=move || draft.get().unwrap_or_default()
                        on:input=move |ev| draft.set(Some(event_target_value(&ev)))
                    ></textarea>
                    <span class="t-label">"Nothing identifying is added beyond what you see. Check the text before sharing."</span>
                </Block>
                <Block>
                    <Acts>
                        <Button label="Copy" kind=ButtonKind::Primary on_press=Callback::new(copy) />
                        <Button label="Discard" on_press=Callback::new(move |_| draft.set(None)) />
                    </Acts>
                </Block>
            </Section>
        })}
        {move || done.get().map(|d| view! { <Note>{d}</Note> })}
        <Note>"This build has no report collector: copy the report and attach it to an issue."</Note>
    }
}

#[component]
pub fn About() -> impl IntoView {
    let app = crate::state::get();
    let ob = onboarding::get();
    let report = RwSignal::new(None::<String>);
    let act = Action::new();
    let online = Memo::new(move |_| app.conn.active_link().conn == Conn::Online);
    let host = Signal::derive(move || {
        app.conn
            .active_link()
            .server_name
            .unwrap_or_else(|| "No host connected".to_owned())
    });
    view! {
        <Section title="About">
            <Row label="Frogg Next RS" hint=format!("{} · {}", env!("CARGO_PKG_VERSION"), platform_name())>
                <Value text="Rust client" />
            </Row>
            <Row label="Connected host" hint=host />
            <Row label="Getting started" hint="The first-run walkthrough, tailored to you">
                <Button label="Open" on_press=Callback::new(move |_| ob.open(None)) />
            </Row>
            <Row label="Licenses">
                <Button label="View notices" on_press=Callback::new(|_| native::open_external(NOTICES)) />
            </Row>
        </Section>
        <Section title="Diagnostics">
            <Row label="Host diagnostic" hint="Daemon, providers and runtime details">
                <Button
                    label=Signal::derive(move || if act.busy() { "Running…".to_owned() } else { "Run".to_owned() })
                    kind=ButtonKind::Primary
                    disabled=Signal::derive(move || !online.get() || act.busy())
                    on_press=Callback::new(move |_| {
                        act.run(
                            "diagnostic",
                            async move { ns(&need()?, "diagnostics.request", json!({})).await },
                            move |v| report.set(v.get("diagnostic").and_then(|d| d.as_str()).map(str::to_owned)),
                        );
                    })
                />
            </Row>
            <Row label="Provider diagnostics">
                <Button label="Open Providers" on_press=Callback::new(move |_| app.ui.open_settings(Some("providers".to_owned()))) />
            </Row>
            <Row label="Report a bug" hint="Built on this device, editable before you share it">
                <Button label="Report…" on_press=Callback::new(move |_| app.ui.open_settings(Some("privacy".to_owned()))) />
            </Row>
        </Section>
        <ErrorLine text=act.error />
        {move || report.get().map(|r| view! {
            <Section title="Diagnostic report">
                <Block><pre class="status-lines t-mono">{r}</pre></Block>
            </Section>
        })}
    }
}

fn update_status(s: &native::UpdateState) -> String {
    match s.status.as_str() {
        "checking" => "Checking for updates…".to_owned(),
        "up-to-date" => "Up to date".to_owned(),
        "available" => format!(
            "Version {} is available. Install it to update.",
            s.latest_version.clone().unwrap_or_default()
        ),
        "error" => "The last update check failed".to_owned(),
        "disabled" if native::is_tauri() => "Updates run in installed builds only".to_owned(),
        "disabled" => "Updates install from GitHub releases in the web build".to_owned(),
        _ => "Checks for updates on start".to_owned(),
    }
}

#[component]
pub fn AppUpdates() -> impl IntoView {
    let app = crate::state::get();
    let state = RwSignal::new(None::<native::UpdateState>);
    let checking = RwSignal::new(false);
    let installing = RwSignal::new(false);
    let error = RwSignal::new(None::<String>);
    let check = move || {
        checking.set(true);
        spawn_local(async move {
            let s = native::update_check().await;
            error.set(s.error.clone());
            state.set(Some(s));
            checking.set(false);
        });
    };
    check();
    let host = Signal::derive(move || {
        app.conn
            .active_link()
            .server_name
            .unwrap_or_else(|| "No host connected".to_owned())
    });
    let online = Memo::new(move |_| app.conn.active_link().conn == Conn::Online);
    view! {
        <Section title="Frogg Next RS">
            <Row label="Version" hint=platform_name()>
                <Value text=env!("CARGO_PKG_VERSION") />
            </Row>
            <Row
                label="App updates"
                hint=Signal::derive(move || {
                    if checking.get() {
                        "Checking for updates…".to_owned()
                    } else if installing.get() {
                        "Installing; the app restarts when it is done…".to_owned()
                    } else {
                        state.get().map(|s| update_status(&s)).unwrap_or_default()
                    }
                })
            >
                {move || {
                    let available = state.get().is_some_and(|s| s.status == "available");
                    if available {
                        view! {
                            <Button
                                kind=ButtonKind::Primary
                                label="Install and restart"
                                disabled=installing
                                on_press=Callback::new(move |_| {
                                    installing.set(true);
                                    spawn_local(async move {
                                        if let Err(e) = native::update_install().await {
                                            error.set(Some(e));
                                        }
                                        installing.set(false);
                                    });
                                })
                            />
                        }.into_any()
                    } else {
                        view! {
                            <Button
                                label="Check for updates"
                                disabled=Signal::derive(move || checking.get() || state.get().is_some_and(|s| s.status == "disabled"))
                                on_press=Callback::new(move |_| check())
                            />
                        }.into_any()
                    }
                }}
            </Row>
            <ErrorLine text=error />
            {move || state.get().and_then(|s| s.notes.clone()).filter(|n| !n.is_empty()).map(|n| view! {
                <Block><pre class="status-lines">{n}</pre></Block>
            })}
            <Row label="Release notes" hint="Every release on GitHub">
                <Button
                    label="Release notes"
                    on_press=Callback::new(move |_| {
                        let url = state.get_untracked().map(|s| s.release_url).filter(|u| !u.is_empty()).unwrap_or_else(|| RELEASES_PAGE.into());
                        native::open_external(&url);
                    })
                />
            </Row>
        </Section>
        <Section title="Hosts">
            <Row label=host hint="Daemon updates are managed separately for each host">
                <Button
                    label="Daemon & updates"
                    disabled=Signal::derive(move || !online.get())
                    on_press=Callback::new(move |_| app.ui.open_settings(Some("daemon".to_owned())))
                />
            </Row>
        </Section>
    }
}

fn platform_name() -> String {
    format!("{:?}", native::platform()).to_lowercase()
}
