//! "App" pages (ui-next `OnboardingSettings.tsx`, `Privacy.tsx` + `BugReport.tsx`, `About.tsx`,
//! `AppUpdates.tsx`).

use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::json;

use crate::components::{Button, ButtonKind, Ico, Seg, Select, SelectOption};
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
/// has no statistics collector of its own, so only the host's switch (the daemon's) is shown.
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
    let consent = RwSignal::new(stats_consent());
    let note = RwSignal::new(None::<String>);
    let set_app = Callback::new(move |on: bool| {
        note.set(None);
        set_stats_consent(if on { "on" } else { "off" });
        consent.set(stats_consent());
        // An owner's opt-in turns on the connected host's statistics too; off never touches it.
        if on {
            let h = host.get_untracked();
            note.set(match (host_stats.get_untracked(), owner) {
                (None, _) => None,
                (Some(_), false) => Some(format!("{h} sends its own statistics only if its owner turns them on.")),
                (Some(true), true) => None,
                (Some(false), true) => {
                    cfg.patch(json!({ "usageStats": true }));
                    Some(format!("Also turned on for {h}, because you own it. Its own switch above turns it off again."))
                }
            });
        }
    });
    view! {
        <Show when=move || STATS_COLLECTOR.is_some() && consent.get() == "unset">
            <Banner ico=Ico::ChartColumn title="Help improve Frogg" body="Send usage statistics: which features you use and which build you run, so we know what to work on. Never your prompts, code, file paths or other data. Off until you turn it on.">
                <Button kind=ButtonKind::Primary label="Send usage statistics" on_press=Callback::new(move |_| set_app.run(true)) />
                <Button label="No thanks" on_press=Callback::new(move |_| set_app.run(false)) />
            </Banner>
        </Show>
        <Section title="Usage statistics">
            <Row
                label="Send usage statistics"
                hint=if STATS_COLLECTOR.is_some() {
                    "App interactions from this device only. If you own the connected host, turning it on turns on that host's statistics too. Turning it off leaves hosts as they are."
                } else {
                    "This build has no statistics collector, so nothing is ever sent."
                }
            >
                <Toggle
                    value=Signal::derive(move || consent.get() == "on")
                    disabled=STATS_COLLECTOR.is_none()
                    on_change=set_app
                    label="Send usage statistics"
                />
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
        {move || note.get().map(|n| view! { <Note>{n}</Note> })}
        <Section title="What is sent">
            {STATS_EVENTS.iter().map(|(name, what)| view! { <Row label=*what hint=*name /> }).collect_view()}
            <Row
                label="Every batch also carries"
                hint="A random statistics id, the app's name, version, OS and platform, and times rounded to the minute"
            />
        </Section>
        <BugReport />
    }
}

/// The collector this build sends app statistics to (set at build time); none means the
/// device toggle stays off and nothing is ever sent.
const STATS_COLLECTOR: Option<&str> = option_env!("FROGG_COLLECTOR_URL");
const STATS_KEY: &str = "frogg.next-rs.usage-stats.consent";
const STATS_EVENTS: &[(&str, &str)] = &[
    (
        "app_opened, app_active",
        "The app started, and was used today",
    ),
    (
        "panel_opened, settings_opened",
        "Which view or settings page you opened, by name",
    ),
    (
        "session_started",
        "A session started, and with which provider",
    ),
    ("host_added", "A host was added, and how it connects"),
    (
        "bug_report_sent",
        "A bug report was sent, and whether it had a chat",
    ),
];

/// "unset" | "on" | "off" for this device.
fn stats_consent() -> String {
    web_sys::window()
        .and_then(|w| w.local_storage().ok().flatten())
        .and_then(|s| s.get_item(STATS_KEY).ok().flatten())
        .filter(|v| v == "on" || v == "off")
        .unwrap_or_else(|| "unset".into())
}

fn set_stats_consent(v: &str) {
    if let Some(s) = web_sys::window().and_then(|w| w.local_storage().ok().flatten()) {
        let _ = s.set_item(STATS_KEY, v);
    }
}

/// Report a bug: describe it, build a report on this device, review and edit it, then copy it.
#[component]
fn BugReport() -> impl IntoView {
    let description = RwSignal::new(String::new());
    let app = crate::state::get();
    let draft = RwSignal::new(None::<String>);
    let done = RwSignal::new(None::<String>);
    let attach = RwSignal::new(false);
    let session = RwSignal::new(String::new());
    let act = Action::new();
    let sessions = Memo::new(move |_| {
        let host = app.hosts.active_id.get();
        app.agents
            .list(host.as_deref())
            .into_iter()
            .take(30)
            .map(|s| SelectOption::new(s.agent.id.clone(), s.agent.title_or_untitled()))
            .collect::<Vec<_>>()
    });
    let preview = move |_| {
        let desc = description.get_untracked();
        let sid = (attach.get_untracked() && !session.get_untracked().is_empty())
            .then(|| session.get_untracked());
        let host = app.hosts.active_id.get_untracked();
        let provider = sid
            .as_deref()
            .zip(host.as_deref())
            .and_then(|(s, h)| app.agents.get_untracked(h, s))
            .map(|s| s.agent.provider);
        act.run(
            "preview",
            async move {
                let chat = match sid {
                    Some(id) => {
                        let v = config::call(
                            &need()?,
                            "fetch_agent_timeline_request",
                            json!({ "agentId": id, "direction": "tail", "limit": 200 }),
                            "fetch_agent_timeline_response",
                            None,
                        )
                        .await?;
                        Some(chat_transcript(&v))
                    }
                    None => None,
                };
                Ok(json!({ "chat": chat }))
            },
            move |v| {
                let info = config::host_version().unwrap_or_else(|| "unknown".to_owned());
                let mut text = format!(
                    "## Bug report\n\n{}\n\n## Environment\n\n- App: Frogg Next RS {} ({})\n- Daemon: {}\n{}- User agent: {}\n",
                    desc.trim(),
                    env!("CARGO_PKG_VERSION"),
                    platform_name(),
                    info,
                    provider.as_ref().map(|p| format!("- Provider: {p}\n")).unwrap_or_default(),
                    web_sys::window().and_then(|w| w.navigator().user_agent().ok()).unwrap_or_default(),
                );
                if let Some(chat) = v.get("chat").and_then(|c| c.as_str()) {
                    text.push_str(&format!("\n## Chat\n\n{chat}\n"));
                }
                draft.set(Some(text));
                done.set(None);
            },
        );
    };
    let save = move |_| {
        if let Some(t) = draft.get_untracked() {
            spawn_local(async move {
                done.set(Some(
                    match native::save_text(&bug_report_file_name(), &t).await {
                        Ok(true) => {
                            "Report saved. Attach the file wherever you report issues.".to_owned()
                        }
                        Ok(false) => return,
                        Err(e) => format!("Couldn't save the report: {e}"),
                    },
                ));
            });
        }
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
            <Row label="Attach a chat" hint="Messages and tool names from one session">
                <Toggle value=Signal::derive(move || attach.get()) on_change=Callback::new(move |v| attach.set(v)) label="Attach a chat" />
            </Row>
            <Show when=move || attach.get()>
                <Row label="Session">
                    {move || view! {
                        <Select
                            options=sessions.get()
                            value=Signal::derive(move || session.get())
                            on_change=Callback::new(move |v: String| session.set(v))
                        />
                    }}
                </Row>
            </Show>
            <Row label="Preview" hint="Builds the report on this device; nothing is sent">
                <Button
                    label=Signal::derive(move || if act.busy() { "Building…".to_owned() } else { "Preview report".to_owned() })
                    kind=ButtonKind::Primary
                    disabled=Signal::derive(move || act.busy() || (attach.get() && session.get().is_empty()))
                    on_press=Callback::new(preview)
                />
            </Row>
            <ErrorLine text=act.error />
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
                        <Button label="Save as file" kind=ButtonKind::Primary on_press=Callback::new(save) />
                        <Button label="Copy" on_press=Callback::new(copy) />
                        <Button label="Discard" on_press=Callback::new(move |_| draft.set(None)) />
                    </Acts>
                </Block>
            </Section>
        })}
        {move || done.get().map(|d| view! { <Note>{d}</Note> })}
        <Note>"This build has no report collector: save the report and attach it to an issue."</Note>
    }
}

const MAX_CHAT_CHARS: usize = 60_000;

/// One session's chat as plain text (ui-next `chatTranscript`): messages, errors and tool
/// names, trimmed from the start past [`MAX_CHAT_CHARS`].
fn chat_transcript(timeline: &serde_json::Value) -> String {
    let s = |v: &serde_json::Value, k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_owned);
    let lines: Vec<String> = timeline
        .get("entries")
        .and_then(|e| e.as_array())
        .into_iter()
        .flatten()
        .filter_map(|e| {
            let item = e.get("item")?;
            match item.get("type")?.as_str()? {
                "user_message" => s(item, "text").map(|t| format!("## You\n{t}")),
                "assistant_message" => s(item, "text").map(|t| format!("## Agent\n{t}")),
                "error" => s(item, "message").map(|t| format!("## Error\n{t}")),
                "tool_call" => s(item, "name").map(|n| match s(item, "status") {
                    Some(st) if !st.is_empty() => format!("[tool {n}: {st}]"),
                    _ => format!("[tool {n}]"),
                }),
                _ => None,
            }
        })
        .collect();
    let text = lines.join("\n\n");
    if text.len() > MAX_CHAT_CHARS {
        let mut cut = text.len() - MAX_CHAT_CHARS;
        while !text.is_char_boundary(cut) {
            cut += 1;
        }
        format!("[earlier messages trimmed]\n\n{}", &text[cut..])
    } else {
        text
    }
}

fn bug_report_file_name() -> String {
    let d = js_sys::Date::new_0();
    format!(
        "frogg-bug-report-{}-{:02}-{:02}.md",
        d.get_full_year(),
        d.get_month() + 1,
        d.get_date()
    )
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
    let v = s.latest_version.clone().unwrap_or_default();
    match s.status.as_str() {
        "checking" => "Checking for updates…".to_owned(),
        "up-to-date" => "Up to date".to_owned(),
        "available" if s.mode == "download" => {
            format!("Version {v} is available. Download it to update.")
        }
        "available" if s.mode == "apk" => format!("Version {v} is available"),
        "available" => format!("Version {v} is available. Downloading…"),
        "downloading" => format!(
            "Downloading {}{}",
            s.latest_version.as_deref().unwrap_or("the update"),
            s.progress
                .as_ref()
                .map(|p| format!(" · {}%", p.percent.round()))
                .unwrap_or_default()
        ),
        "ready" if s.mode == "apk" => format!("Version {v} is downloaded and verified"),
        "ready" => format!("Version {v} is ready. Restart to finish updating."),
        "error" => "The last update check failed".to_owned(),
        "disabled" if native::is_tauri() => "Updates run in installed builds only".to_owned(),
        "disabled" => "Install a newer build from GitHub releases to update".to_owned(),
        _ => "Checks for updates on start and every few hours".to_owned(),
    }
}

type UpdateCall = std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>>>>;

#[component]
pub fn AppUpdates() -> impl IntoView {
    let app = crate::state::get();
    let state = native::updates();
    let error = RwSignal::new(None::<String>);
    let run = move |f: fn() -> UpdateCall| {
        error.set(None);
        spawn_local(async move {
            if let Err(e) = f().await {
                error.set(Some(e));
            }
        });
    };
    let check = move || {
        spawn_local(async move {
            let s = native::update_check().await;
            state.set(Some(s));
        });
    };
    let host = Signal::derive(move || {
        app.conn
            .active_link()
            .server_name
            .unwrap_or_else(|| "No host connected".to_owned())
    });
    let online = Memo::new(move |_| app.conn.active_link().conn == Conn::Online);
    let status = move || state.get().map(|s| s.status).unwrap_or_default();
    view! {
        <Section title="Frogg Next RS">
            <Row label="Version" hint=platform_name()>
                <Value text=env!("CARGO_PKG_VERSION") />
            </Row>
            <Row label="App updates" hint=Signal::derive(move || state.get().map(|s| update_status(&s)).unwrap_or_default())>
                {move || {
                    let s = state.get().unwrap_or_default();
                    match s.status.as_str() {
                        "ready" if s.mode == "apk" => view! {
                            <Button kind=ButtonKind::Primary label="Install" on_press=Callback::new(move |_| run(|| Box::pin(native::update_install()))) />
                        }.into_any(),
                        "ready" => view! {
                            <Button kind=ButtonKind::Primary label="Restart to update" on_press=Callback::new(move |_| run(|| Box::pin(native::update_install()))) />
                        }.into_any(),
                        "available" if s.mode == "download" => view! {
                            <Button kind=ButtonKind::Primary label="Download" on_press=Callback::new(move |_| run(|| Box::pin(native::update_download()))) />
                        }.into_any(),
                        "available" => view! {
                            <Button kind=ButtonKind::Primary label="Download now" on_press=Callback::new(move |_| run(|| Box::pin(native::update_download()))) />
                        }.into_any(),
                        _ => view! {
                            <Button
                                label="Check for updates"
                                disabled=Signal::derive(move || matches!(status().as_str(), "checking" | "downloading" | "disabled"))
                                on_press=Callback::new(move |_| check())
                            />
                        }.into_any(),
                    }
                }}
            </Row>
            <Show when=move || status() == "downloading">
                <Block>
                    <div class="upd-bar" role="progressbar">
                        <div style=move || format!("width:{}%", state.get().and_then(|s| s.progress).map(|p| p.percent).unwrap_or(0.0))></div>
                    </div>
                </Block>
            </Show>
            <ErrorLine text=Signal::derive(move || error.get().or_else(|| state.get().and_then(|s| s.error))) />
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
