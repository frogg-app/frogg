//! The walkthrough's step bodies (ui-next `StepProfile.tsx`, `StepHost.tsx`,
//! `StepProviders.tsx`, `StepWork.tsx`, `StepFinish.tsx`).

use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::{json, Value};

use super::{open_settings_page, open_tool};
use crate::components::{Button, ButtonKind, Ico, Icon};
use crate::state::config::{self, call, ns, provider_label, s};
use crate::state::hostview::{self, open_add_host, HostDialog};
use crate::state::onboarding::{
    self, concepts_for, meta, settings_for, show_deep, starters_for, Level, Step, LEVELS, STEPS,
    WORKS,
};
use crate::state::{Conn, Tool};
use crate::views::panels::hosts::access::{NEXT_CLI, NEXT_INSTALL_COMMAND};

pub fn body(step: Step) -> AnyView {
    match step {
        Step::Level => view! { <LevelStep /> }.into_any(),
        Step::Work => view! { <WorkStep /> }.into_any(),
        Step::Host => view! { <HostStep /> }.into_any(),
        Step::Providers => view! { <ProvidersStep /> }.into_any(),
        Step::Session => view! { <SessionStep /> }.into_any(),
        Step::Concepts => view! { <ConceptsStep /> }.into_any(),
        Step::Settings => view! { <SettingsStep /> }.into_any(),
        Step::Done => view! { <DoneStep /> }.into_any(),
    }
}

#[component]
fn StepHead(
    #[prop(into)] title: Signal<String>,
    #[prop(into)] lede: Signal<String>,
) -> impl IntoView {
    view! {
        <h2 class="t-display ob-title">{move || title.get()}</h2>
        <p class="ob-lede">{move || lede.get()}</p>
    }
}

/// A one-line state: ok (mint) or waiting (amber).
#[component]
fn State(ok: bool, #[prop(into)] text: String) -> impl IntoView {
    view! {
        <div class="ob-state" class:ok=ok>
            <span class="hdot" class:online=ok class:connecting=!ok></span>
            <span>{text}</span>
        </div>
    }
}

#[component]
fn Para(#[prop(optional)] faint: bool, children: Children) -> impl IntoView {
    view! { <p class="ob-para" class:faint=faint>{children()}</p> }
}

/// A shell command to copy.
#[component]
fn Cmd(#[prop(into)] text: String) -> impl IntoView {
    let copied = RwSignal::new(false);
    let t = StoredValue::new(text.clone());
    view! {
        <div class="ob-cmd">
            <pre class="t-mono">{text}</pre>
            <button
                class="icon-btn"
                aria-label="Copy"
                on:click=move |_| {
                    let t = t.get_value();
                    spawn_local(async move {
                        if crate::native::clipboard_write(&t).await.is_ok() {
                            copied.set(true);
                        }
                    });
                }
            >
                {move || if copied.get() {
                    view! { <Icon ico=Ico::Check size=14.0 class="mint" /> }.into_any()
                } else {
                    view! { <Icon ico=Ico::Copy size=14.0 /> }.into_any()
                }}
            </button>
        </div>
    }
}

/// A pickable card: single (radio) or multi (check).
#[component]
fn Choice(
    #[prop(into)] title: String,
    #[prop(optional, into)] sub: Option<String>,
    #[prop(into)] on: Signal<bool>,
    #[prop(optional)] multi: bool,
    on_pick: Callback<()>,
) -> impl IntoView {
    view! {
        <button
            class="ob-choice cut"
            class:on=move || on.get()
            style="--c:8px"
            role=if multi { "checkbox" } else { "radio" }
            aria-checked=move || on.get().to_string()
            on:click=move |_| on_pick.run(())
        >
            <span class="ob-choice-mark" class:multi=multi>
                {move || on.get().then(|| view! { <Icon ico=Ico::Check size=11.0 stroke=3.0 /> })}
            </span>
            <span class="ob-choice-text">
                <span class="ob-choice-t">{title}</span>
                {sub.map(|s| view! { <span class="ob-choice-s">{s}</span> })}
            </span>
        </button>
    }
}

#[component]
fn LevelStep() -> impl IntoView {
    let ob = onboarding::get();
    view! {
        <StepHead title="Welcome to Frogg" lede="Frogg runs coding agents on your machines and lets you follow and steer them from anywhere. Two quick questions tailor this walkthrough." />
        <span class="t-label ob-q">"How much should we explain?"</span>
        <div class="ob-choices">
            {LEVELS.iter().map(|(l, t, sub)| {
                let l = *l;
                view! {
                    <Choice
                        title=*t
                        sub=*sub
                        on=Signal::derive(move || ob.state.with(|s| s.level == Some(l)))
                        on_pick=Callback::new(move |_| ob.set_level(l))
                    />
                }
            }).collect_view()}
        </div>
    }
}

#[component]
fn WorkStep() -> impl IntoView {
    let ob = onboarding::get();
    view! {
        <StepHead title="What do you work on?" lede="Pick any that fit. It decides which starter prompts, tools and settings we point at." />
        <div class="ob-grid">
            {WORKS.iter().map(|(w, t, sub)| {
                let w = *w;
                view! {
                    <Choice
                        title=*t
                        sub=*sub
                        multi=true
                        on=Signal::derive(move || ob.state.with(|s| s.work.contains(&w)))
                        on_pick=Callback::new(move |_| ob.toggle_work(w))
                    />
                }
            }).collect_view()}
        </div>
    }
}

fn pair_phone() {
    let ob = onboarding::get();
    ob.away(Step::Host, || {
        crate::state::get().ui.set_tool(Tool::Hosts);
        hostview::get().open(HostDialog::PairDevice);
    });
}

#[component]
fn HostStep() -> impl IntoView {
    let app = crate::state::get();
    let ob = onboarding::get();
    let link = Memo::new(move |_| app.conn.active_link());
    let level = Memo::new(move |_| ob.state.with(|s| s.level));
    let away_add = move |pair: bool| ob.away(Step::Host, move || open_add_host(pair));
    move || {
        let l = link.get();
        let phone = app.viewport.phone();
        if l.conn == Conn::Online {
            let saved = app.hosts.hosts.with(Vec::len);
            let name = l.server_name.unwrap_or_else(|| "host".to_owned());
            return view! {
                <StepHead title="Your host is connected" lede="Agents run on the host, not in this app, so they keep working when you close it." />
                <State ok=true text=format!("Connected to {name}{}", if saved > 1 { format!(" · {saved} hosts saved") } else { String::new() }) />
                {(level.get() == Some(Level::New)).then(|| view! {
                    <Para>"A host is any computer running the Frogg daemon: this machine, a server or a VM. You can add more later from Hosts in the rail."</Para>
                })}
                <div class="ob-actions">
                    {(!phone).then(|| view! { <Button label="Pair your phone" icon=Ico::Smartphone kind=ButtonKind::Primary on_press=Callback::new(|_| pair_phone()) /> })}
                    <Button label="Add another host" icon=Ico::Link2 on_press=Callback::new(move |_| away_add(false)) />
                </div>
                {(!phone).then(|| view! { <Para faint=true>"A paired phone follows the same sessions and can answer permissions away from your desk."</Para> })}
            }
            .into_any();
        }
        view! {
            <StepHead title="Connect a host" lede="Frogg's agents run on a host: a computer running the Frogg daemon. Connect this app to one." />
            <State ok=false text=if l.conn == Conn::Connecting { "Looking for a host…" } else { "No host connected" } />
            {if level.get() == Some(Level::Expert) {
                view! {
                    <Para>"Run " <code class="t-mono ob-inline">{format!("{NEXT_CLI} daemon pair")}</code> " on the host and enter the code, or connect to its address."</Para>
                }.into_any()
            } else {
                view! {
                    <Para>"No daemon yet? Install it on the machine that has your code:"</Para>
                    <Cmd text=NEXT_INSTALL_COMMAND />
                    <Para>"Then run this there and enter the code it prints here:"</Para>
                    <Cmd text=format!("{NEXT_CLI} daemon pair") />
                }.into_any()
            }}
            <div class="ob-actions">
                <Button label="Pair with a code or link" icon=Ico::QrCode kind=ButtonKind::Primary on_press=Callback::new(move |_| away_add(true)) />
                <Button label="Enter an address" icon=Ico::Link2 on_press=Callback::new(move |_| away_add(false)) />
            </div>
            <Para faint=true>"The walkthrough steps aside while you pair and comes back when the dialog closes."</Para>
        }
        .into_any()
    }
}

fn provider_status(e: &Value, update: Option<&Value>) -> (&'static str, &'static str) {
    if e.get("enabled") == Some(&Value::Bool(false)) {
        return ("off", "faint");
    }
    match s(e, "status").as_str() {
        "ready" => ("ready", "mint"),
        "loading" => ("checking", "amber"),
        st if st == "unavailable" || update.is_some_and(|u| s(u, "status") == "not-installed") => {
            ("not installed", "faint")
        }
        _ => ("error", "coral"),
    }
}

#[component]
fn ProvidersStep() -> impl IntoView {
    let app = crate::state::get();
    let ob = onboarding::get();
    let cfg = config::get();
    let online = Memo::new(move |_| app.conn.active_link().conn == Conn::Online);
    let updates = RwSignal::new(Vec::<Value>::new());
    let busy = RwSignal::new(None::<String>);
    let error = RwSignal::new(None::<String>);
    let read_updates = move || {
        let Ok(c) = config::need() else { return };
        spawn_local(async move {
            // Older hosts don't answer this; the list then just has no install buttons.
            if let Ok(r) = ns(&c, "provider.update.check.request", json!({})).await {
                updates.set(
                    r.get("entries")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default(),
                );
            }
        });
    };
    Effect::new(move |_| {
        if online.get() {
            cfg.load();
            read_updates();
        }
    });
    Effect::new(move |_| {
        let probing = cfg.providers.with(|p| {
            p.as_ref()
                .and_then(|p| p.get("entries"))
                .and_then(Value::as_array)
                .is_some_and(|e| e.iter().any(|x| s(x, "status") == "loading"))
        });
        if online.get() && probing {
            set_timeout(
                move || cfg.load_providers(),
                std::time::Duration::from_millis(2000),
            );
        }
    });
    let install = move |provider: String| {
        let Ok(c) = config::need() else { return };
        busy.set(Some(provider.clone()));
        error.set(None);
        spawn_local(async move {
            match ns_install(&c, &provider).await {
                Ok(()) => {}
                Err(e) => error.set(Some(format!("{}: {e}", provider_label(&provider)))),
            }
            let _ = call(
                &c,
                "refresh_providers_snapshot_request",
                json!({ "providers": [provider] }),
                "refresh_providers_snapshot_response",
                Some(120_000),
            )
            .await;
            cfg.load();
            read_updates();
            busy.set(None);
        });
    };
    let level = Memo::new(move |_| ob.state.with(|s| s.level));
    move || {
        if !online.get() {
            return view! {
                <StepHead title="Agent providers" lede="Providers are the agent CLIs the host runs." />
                <State ok=false text="Connect a host first; providers are installed there." />
                <Button label="Back to Connect a host" on_press=Callback::new(move |_| ob.go(Step::Host)) />
            }
            .into_any();
        }
        let entries: Vec<Value> = cfg
            .providers
            .get()
            .and_then(|p| p.get("entries").and_then(Value::as_array).cloned())
            .unwrap_or_default()
            .into_iter()
            .filter(|e| !s(e, "provider").starts_with("mock"))
            .collect();
        let ready: Vec<String> = entries
            .iter()
            .filter(|e| s(e, "status") == "ready" && e.get("enabled") != Some(&Value::Bool(false)))
            .map(|e| {
                e.get("label")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .unwrap_or_else(|| provider_label(&s(e, "provider")))
            })
            .collect();
        let expert = level.get() == Some(Level::Expert);
        view! {
            <StepHead
                title="Agent providers"
                lede=if expert {
                    "Turn on the CLIs you use. Frogg installs npm-distributed ones for you."
                } else {
                    "A provider is an agent CLI like Claude Code or Codex. Frogg runs them on the host and shows their work here. Turn on the ones you have, or install one."
                }
            />
            {if ready.is_empty() {
                view! { <State ok=false text="No provider is ready yet" /> }.into_any()
            } else {
                view! { <State ok=true text=format!("{} ready", ready.join(", ")) /> }.into_any()
            }}
            {cfg.providers.with(Option::is_none).then(|| view! { <span class="t-label">"loading…"</span> })}
            <div class="ob-list-box">
                {entries.into_iter().map(|e| {
                    let id = s(&e, "provider");
                    let up = updates.with(|u| u.iter().find(|x| s(x, "provider") == id).cloned());
                    let (text, tint) = provider_status(&e, up.as_ref());
                    let can_install = up.as_ref().is_some_and(|u| {
                        let st = s(u, "status");
                        st == "not-installed" || st == "update-available"
                    });
                    let update = up.as_ref().is_some_and(|u| s(u, "status") == "update-available");
                    let label = e.get("label").and_then(Value::as_str).map(str::to_owned).unwrap_or_else(|| provider_label(&id));
                    let idc = id.clone();
                    let mine = id.clone();
                    view! {
                        <div class="ob-prov">
                            <span class="ob-prov-t">{label}</span>
                            <span class="pill t-mono" style=format!("--tint:var(--{tint})")>{text}</span>
                            <span class="grow"></span>
                            {can_install.then(|| view! {
                                <Button
                                    label=Signal::derive(move || if busy.get().as_deref() == Some(mine.as_str()) { "Installing…".to_owned() } else if update { "Update".to_owned() } else { "Install".to_owned() })
                                    disabled=Signal::derive(move || busy.get().is_some())
                                    on_press=Callback::new(move |_| install(idc.clone()))
                                />
                            })}
                        </div>
                    }
                }).collect_view()}
            </div>
            {move || error.get().map(|e| view! { <span class="set-err">{e}</span> })}
            {(!expert).then(|| view! {
                <Para>"Sign in once on the host, as the user the daemon runs as:"</Para>
                <Cmd text="claude          # Claude Code\ncodex login     # Codex" />
            })}
            <div class="ob-actions">
                <Button
                    label="Manage sign-ins"
                    icon=Ico::KeyRound
                    on_press=Callback::new(move |_| ob.away(Step::Providers, || open_settings_page("accounts")))
                />
            </div>
        }
        .into_any()
    }
}

/// Installs runs npm on the host and can take a while.
async fn ns_install(c: &frogg_client_core::DaemonClient, provider: &str) -> Result<(), String> {
    call(
        c,
        "provider.update.install.request",
        json!({ "provider": provider }),
        "provider.update.install.response",
        Some(600_000),
    )
    .await
    .map(|_| ())
}

#[component]
fn SessionStep() -> impl IntoView {
    let app = crate::state::get();
    let ob = onboarding::get();
    let count = Memo::new(move |_| app.sessions().len());
    let level = Memo::new(move |_| ob.state.with(|s| s.level));
    let starters = Memo::new(move |_| ob.state.with(|s| starters_for(&s.work)));
    let start = move |prompt: Option<String>| {
        ob.away(Step::Session, move || {
            app.ui
                .set_new_session(true, Some(prompt.unwrap_or_default()))
        })
    };
    view! {
        <StepHead
            title=Signal::derive(move || if count.get() > 0 { "You have sessions running".to_owned() } else { "Start your first session".to_owned() })
            lede="Pick a folder on the host, choose a provider and say what you want done."
        />
        {move || (count.get() > 0).then(|| {
            let n = count.get();
            view! { <State ok=true text=format!("{n} {} on this host", if n == 1 { "session" } else { "sessions" }) /> }
        })}
        {move || (level.get() == Some(Level::New)).then(|| view! {
            <Para>"A project is just a folder on the host. If it’s a git repository, turn on New branch when you start: the agent then works in its own worktree and your checkout stays untouched."</Para>
        })}
        <span class="t-label ob-q">"Try one of these"</span>
        <div class="ob-grid">
            {move || starters.get().into_iter().map(|p| view! {
                <Choice title=p on=false on_pick=Callback::new(move |_| start(Some(p.to_owned()))) />
            }).collect_view()}
        </div>
        <div class="ob-actions">
            <Button label="New session" icon=Ico::Plus kind=ButtonKind::Primary kbd="⌘N" on_press=Callback::new(move |_| start(None)) />
            {move || (count.get() > 0).then(|| view! {
                <Button label="Open sessions" on_press=Callback::new(move |_| ob.away(Step::Session, || open_tool("sessions"))) />
            })}
        </div>
    }
}

#[component]
fn ConceptsStep() -> impl IntoView {
    let ob = onboarding::get();
    let (level, work) = ob.state.with_untracked(|s| (s.level, s.work.clone()));
    let deep = show_deep(level);
    view! {
        <StepHead
            title="Key concepts"
            lede=if level == Some(Level::Expert) { "The few things that work differently here." } else { "What you'll see around a session, and where each lives." }
        />
        <div class="ob-grid">
            {concepts_for(level, &work).into_iter().map(|c| {
                let (tool, page) = (c.tool, c.page);
                view! {
                    <div class="ob-concept cut" style="--c:10px">
                        <span class="t-display ob-concept-t">{c.title}</span>
                        <span class="ob-concept-b">{c.body}</span>
                        {c.deep.filter(|_| deep).map(|d| view! { <span class="ob-concept-d">{d}</span> })}
                        {(tool.is_some() || page.is_some()).then(|| view! {
                            <button
                                class="ob-show"
                                on:click=move |_| ob.away(Step::Concepts, move || {
                                    if let Some(p) = page {
                                        open_settings_page(p);
                                    } else if let Some(t) = tool {
                                        open_tool(t);
                                    }
                                })
                            >
                                "Show me"
                                <Icon ico=Ico::ArrowRight size=12.0 />
                            </button>
                        })}
                    </div>
                }
            }).collect_view()}
        </div>
    }
}

#[component]
fn SettingsStep() -> impl IntoView {
    let ob = onboarding::get();
    let (level, work) = ob.state.with_untracked(|s| (s.level, s.work.clone()));
    view! {
        <StepHead title="Settings for you" lede="Based on your answers, these are the pages worth a look. Everything else can wait." />
        <div class="ob-list-box">
            {settings_for(level, &work, 6).into_iter().map(|t| view! {
                <button class="ob-tip" aria-label=format!("Open {}", t.label) on:click=move |_| ob.away(Step::Settings, move || open_settings_page(t.page))>
                    <span class="grow ob-tip-text">
                        <span class="ob-tip-t">{t.label}</span>
                        <span class="ob-tip-s">{t.why}</span>
                    </span>
                    <Icon ico=Ico::ChevronRight size=15.0 />
                </button>
            }).collect_view()}
        </div>
        <Para faint=true>{format!("Reopen this walkthrough any time from Settings → Getting started, or {} → Getting started.", crate::state::kbd::kbd("⌘K"))}</Para>
    }
}

#[component]
fn DoneStep() -> impl IntoView {
    let ob = onboarding::get();
    let done = Memo::new(move |_| onboarding::done());
    let open = move || {
        STEPS
            .iter()
            .filter(|m| m.id != Step::Done && !done.get().contains(&m.id))
            .collect::<Vec<_>>()
    };
    let tailored = move || {
        let (level, work) = ob.state.with(|s| (s.level, s.work.clone()));
        let mut parts: Vec<&str> = level
            .and_then(|l| LEVELS.iter().find(|x| x.0 == l))
            .map(|x| x.1)
            .into_iter()
            .collect();
        parts.extend(WORKS.iter().filter(|w| work.contains(&w.0)).map(|w| w.1));
        parts.join(" · ")
    };
    view! {
        <StepHead
            title=Signal::derive(move || if open().is_empty() { "You're set up".to_owned() } else { "Almost there".to_owned() })
            lede=Signal::derive(move || if open().is_empty() {
                "Everything's in place. Agents that need you show up in the session list and the inbox.".to_owned()
            } else {
                "You can start now and finish these later; the walkthrough remembers where you were.".to_owned()
            })
        />
        {move || {
            let list = open();
            (!list.is_empty()).then(|| view! {
                <div class="ob-list-box">
                    {list.into_iter().map(|m| {
                        let id = m.id;
                        view! {
                            <button class="ob-tip" on:click=move |_| ob.go(id)>
                                <span class="t-mono faint">{onboarding::index_of(id) + 1}</span>
                                <span class="grow ob-tip-t">{meta(id).label}</span>
                                <Icon ico=Ico::ChevronRight size=15.0 />
                            </button>
                        }
                    }).collect_view()}
                </div>
            })
        }}
        {move || {
            let t = tailored();
            (!t.is_empty()).then(|| view! { <Para faint=true>{format!("Tailored for: {t}. Change it in Settings → Getting started.")}</Para> })
        }}
    }
}
