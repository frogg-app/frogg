//! Getting started (ui-next `onboarding/Onboarding.tsx`, `Card.tsx`, `parts.tsx`): opens the
//! walkthrough on a first run, presents it (a centred card on desktop and tablet, full screen on
//! phones), and shows a resume chip while it is minimised.

mod steps;

use std::time::Duration;

use leptos::prelude::*;

use crate::components::{use_presence, Button, ButtonKind, Ico, Icon};
use crate::state::onboarding::{
    self, index_of, meta, next_step, prev_step, progress_of, Status, Step, STEPS,
};
use crate::state::Tool;
use crate::theme::OVERLAY_OUT_MS;

/// Leave the walkthrough to do `step` in the app: a settings page.
pub fn open_settings_page(page: &str) {
    let ui = crate::state::get().ui;
    ui.set_tool(Tool::Settings);
    ui.open_settings(Some(page.to_owned()));
}

/// A rail tool by its id.
pub fn open_tool(id: &str) {
    if let Some(t) = Tool::ALL.iter().find(|t| t.id() == id) {
        crate::state::get().ui.set_tool(*t);
    }
}

/// Mounted once by the app root.
#[component]
pub fn Onboarding() -> impl IntoView {
    let app = crate::state::get();
    let ob = onboarding::get();
    first_run();
    auto_resume();
    // Provider readiness ticks a step: read the host's snapshot once it is online.
    let online = Memo::new(move |_| app.conn.active_link().conn == crate::state::Conn::Online);
    Effect::new(move |_| {
        let _ = app.hosts.active_id.get();
        if online.get() {
            crate::state::config::get().load();
        }
    });
    let open = Signal::derive(move || ob.state.with(|s| s.status == Status::Active));
    let p = use_presence(open, OVERLAY_OUT_MS);
    let close = move || ob.minimise();
    let handle = window_event_listener(leptos::ev::keydown, move |ev| {
        if open.get_untracked() && ev.key() == "Escape" {
            ob.minimise();
        }
    });
    on_cleanup(move || handle.remove());
    view! {
        <Show when=move || p.mounted.get()>
            {move || {
                let phone = app.viewport.phone();
                let closing = p.closing.get();
                if phone {
                    view! {
                        <div class="layer ob-phone" class:m-sheet-out=closing class:m-sheet-in=!closing role="dialog" aria-modal="true">
                            <ObCard phone=true />
                        </div>
                    }
                    .into_any()
                } else {
                    view! {
                        <div class="layer" class:closing=closing>
                            <div
                                class=if closing { "scrim m-fade-out" } else { "scrim m-fade-in" }
                                aria-label="Close, resume later"
                                on:click=move |_| close()
                            ></div>
                            <div class=if closing { "ob-box m-pop-out" } else { "ob-box m-rise" } role="dialog" aria-modal="true">
                                <ObCard phone=false />
                            </div>
                        </div>
                    }
                    .into_any()
                }
            }}
        </Show>
        // Desktop and tablet dock the chip in the status bar (`shell::status_bar`) so it never
        // covers the chat or composer; phones float it here.
        <Show when=move || crate::state::get().viewport.phone()>
            <ResumeChip />
        </Show>
    }
}

/// Opens the walkthrough on a first run, once nothing else is on screen. Someone whose hosts
/// have been online before gets the chip, not a walkthrough over their work.
fn first_run() {
    let app = crate::state::get();
    let ob = onboarding::get();
    let fresh = RwSignal::new(false);
    // Read before this run's connections stamp `lastOnlineAt`.
    let used_before = app
        .hosts
        .hosts
        .with_untracked(|hs| hs.iter().any(|h| h.last_online_at.is_some()));
    if ob.state.with_untracked(|s| s.status == Status::New) {
        set_timeout(
            move || {
                if ob.state.with_untracked(|s| s.status != Status::New) {
                    return;
                }
                if used_before {
                    ob.minimise();
                } else {
                    fresh.set(true);
                }
            },
            Duration::from_millis(1500),
        );
    }
    Effect::new(move |_| {
        let busy = app.ui.host_sheet_open.get()
            || app.ui.new_session_open.get()
            || app.ui.palette_open.get();
        if fresh.get() && ob.state.with(|s| s.status == Status::New) && !busy {
            ob.open(None);
        }
    });
}

/// Back from pairing: once the host sheet closes, reopen on the host step. A host sheet opened
/// from elsewhere while the walkthrough is open takes precedence.
fn auto_resume() {
    let app = crate::state::get();
    let ob = onboarding::get();
    Effect::new(move |_| {
        let sheet = app.ui.host_sheet_open.get();
        let status = ob.state.with(|s| s.status);
        let away = ob.away.get();
        if status == Status::Minimised && away == Some(Step::Host) && !sheet {
            ob.away.set(None);
            let level = ob.state.with_untracked(|s| s.level.is_some());
            ob.open(level.then_some(Step::Host));
        }
        if status == Status::Active && sheet {
            ob.away.set(Some(Step::Host));
            ob.minimise();
        }
    });
}

#[component]
pub fn Progress(
    #[prop(into)] done: Signal<usize>,
    #[prop(into)] total: Signal<usize>,
) -> impl IntoView {
    view! {
        <span class="ob-progress" aria-label=move || format!("{} of {} steps done", done.get(), total.get())>
            <span class="ob-track">
                <span
                    class="ob-fill"
                    style=move || format!("width:{}%", if total.get() == 0 { 0.0 } else { done.get() as f64 / total.get() as f64 * 100.0 })
                ></span>
            </span>
            <span class="t-mono ob-count">{move || format!("{}/{}", done.get(), total.get())}</span>
        </span>
    }
}

#[component]
fn ObCard(phone: bool) -> impl IntoView {
    let ob = onboarding::get();
    let step = Memo::new(move |_| ob.state.with(|s| s.step));
    let done = Memo::new(move |_| onboarding::done());
    let progress = Memo::new(move |_| progress_of(&done.get()));
    let level = Memo::new(move |_| ob.state.with(|s| s.level));
    let next = move || {
        let st = step.get_untracked();
        let m = meta(st);
        if !m.setup && st != Step::Done {
            ob.mark_seen(st);
        }
        if st == Step::Done {
            ob.finish();
        } else {
            ob.go(next_step(st, &done.get_untracked(), level.get_untracked()));
        }
    };
    let footer = move || {
        let st = step.get();
        let idx = index_of(st);
        let waiting = meta(st).setup && !done.get().contains(&st);
        let primary = match st {
            Step::Done => "Start using Frogg",
            Step::Work if ob.state.with(|s| s.work.is_empty()) => "Skip question",
            _ => "Continue",
        };
        view! {
            <div class="ob-foot" class:phone=phone>
                {(!phone).then(|| view! { <button class="ob-skip" on:click=move |_| ob.hide()>"Skip setup"</button> })}
                <span class="grow"></span>
                {(idx > 0).then(|| view! {
                    <Button label="Back" icon=Ico::ArrowLeft on_press=Callback::new(move |_| ob.go(prev_step(step.get_untracked()))) />
                })}
                {if waiting {
                    view! { <Button label="Skip for now" grow=phone on_press=Callback::new(move |_| next()) /> }.into_any()
                } else {
                    view! {
                        <Button
                            label=primary
                            kind=ButtonKind::Primary
                            grow=phone
                            disabled=Signal::derive(move || step.get() == Step::Level && level.get().is_none())
                            on_press=Callback::new(move |_| next())
                        />
                    }
                    .into_any()
                }}
            </div>
        }
    };
    let body = move || {
        let st = step.get();
        view! {
            <div class="ob-scroll">
                <div class="ob-body m-enter" class:phone=phone>
                    <span class="t-label ob-eyebrow">{format!("Step {} of {}", index_of(st) + 1, STEPS.len())}</span>
                    {steps::body(st)}
                </div>
            </div>
        }
    };
    if phone {
        return view! {
            <div class="ob-card phone">
                <div class="ob-phone-head">
                    <span class="t-label grow">"Getting started"</span>
                    <button class="ob-skip" on:click=move |_| ob.hide()>"Skip"</button>
                    <button class="icon-btn" aria-label="Close, resume later" on:click=move |_| ob.minimise()>
                        <Icon ico=Ico::X size=17.0 />
                    </button>
                </div>
                <div class="ob-phone-progress">
                    <Progress done=Signal::derive(move || progress.get().0) total=Signal::derive(move || progress.get().1) />
                </div>
                {body}
                {footer}
            </div>
        }
        .into_any();
    }
    view! {
        <div class="ob-card cut cut-stroke" style="--c:16px">
            <div class="ob-head">
                <span class="t-label">"Getting started"</span>
                <span class="ob-head-progress">
                    <Progress done=Signal::derive(move || progress.get().0) total=Signal::derive(move || progress.get().1) />
                </span>
                <button class="icon-btn" aria-label="Close, resume later" on:click=move |_| ob.minimise()>
                    <Icon ico=Ico::Minimize2 size=15.0 />
                </button>
            </div>
            <div class="ob-row">
                <div class="ob-list">
                    <span class="ob-glide" style=move || format!("transform:translateY({}px)", index_of(step.get()) * 40)></span>
                    {STEPS
                        .iter()
                        .enumerate()
                        .map(|(i, m)| {
                            let id = m.id;
                            let on = move || step.get() == id;
                            let is_done = move || done.get().contains(&id);
                            view! {
                                <button
                                    class="ob-item"
                                    class:on=on
                                    class:done=move || is_done() && !on()
                                    aria-label=move || format!("{}{}", m.label, if is_done() { ", done" } else { "" })
                                    on:click=move |_| ob.go(id)
                                >
                                    <span class="ob-glyph" class:done=is_done class:on=on>
                                        {move || if is_done() {
                                            view! { <Icon ico=Ico::Check size=11.0 stroke=3.0 /> }.into_any()
                                        } else {
                                            view! { <span class="t-mono">{i + 1}</span> }.into_any()
                                        }}
                                    </span>
                                    <span class="ob-item-t">{m.label}</span>
                                </button>
                            }
                        })
                        .collect_view()}
                </div>
                <div class="ob-main">
                    {body}
                    {footer}
                </div>
            </div>
        </div>
    }
    .into_any()
}

/// Bottom-right while minimised: progress, resume, dismiss. Turns mint when the step it left
/// for is done.
#[component]
pub fn ResumeChip(#[prop(optional)] docked: bool) -> impl IntoView {
    let app = crate::state::get();
    let ob = onboarding::get();
    let minimised = Memo::new(move |_| ob.state.with(|s| s.status == Status::Minimised));
    let done = Memo::new(move |_| onboarding::done());
    let started = Memo::new(move |_| ob.state.with(|s| !s.seen.is_empty() || s.level.is_some()));
    let resume = move |_| {
        let at = ob.away.get_untracked();
        ob.away.set(None);
        match at {
            Some(at) if done.get_untracked().contains(&at) => {
                let level = ob.state.with_untracked(|s| s.level);
                ob.open(Some(next_step(at, &done.get_untracked(), level)));
            }
            _ => ob.open(None),
        }
    };
    view! {
        <Show when=move || minimised.get() && !(docked && app.viewport.phone())>
            {move || {
                let away = ob.away.get();
                let finished_away = away.is_some_and(|a| done.get().contains(&a));
                let (n, total) = progress_of(&done.get());
                let mut title = if started.get() { "Resume getting started".to_owned() } else { "New here? Take the tour".to_owned() };
                if let (true, Some(a)) = (finished_away, away) {
                    title = format!("{} done · continue", meta(a).label);
                }
                let phone = app.viewport.phone();
                view! {
                    <div class="ob-chip-place" class:phone=phone class:docked=docked>
                        <div class="ob-chip m-rise" class:cut=!docked class:ok=finished_away style="--c:10px">
                            <button class="ob-chip-main" on:click=resume>
                                {if finished_away {
                                    view! { <span class="ob-chip-done m-snap"><Icon ico=Ico::Check size=11.0 stroke=3.0 /></span> }.into_any()
                                } else {
                                    view! { <Icon ico=Ico::Sparkles size=15.0 class="cyan2" /> }.into_any()
                                }}
                                <span class="ob-chip-t">{title}</span>
                                {started.get().then(|| view! { <span class="t-mono ob-chip-n">{format!("{n}/{total}")}</span> })}
                            </button>
                            <button class="ob-chip-x" aria-label="Dismiss getting started" on:click=move |_| ob.hide()>
                                <Icon ico=Ico::X size=13.0 />
                            </button>
                        </div>
                    </div>
                }
            }}
        </Show>
    }
}
