//! Live previews for Design options picks whose components live elsewhere (ui-next
//! `DesignOptions.tsx`): shape language, session state card, sub-work indicator, streaming text
//! and heading reveal. Each renders the production component around fixed sample data.

use std::time::Duration;

use leptos::prelude::*;

use crate::components::{Brackets, Button, ButtonKind, Ico, Icon, StatusGlyph};
use crate::shell::panel_head::RevealHeading;
use crate::state::Bucket;
use crate::views::chat::reveal::{noise_of, RevealReply};
use crate::views::chat::session_state::StatePreview;
use crate::views::chat::subwork::{Item, Kind, Status, SubWork, SubWorkTree};

/// Permission-style card and an input in the picked shape language (ui-next `ShapeCard`,
/// `ShapeInput`). HUD draws a solid frame here: the app keeps no dashed lines.
#[component]
pub fn ShapePreview() -> impl IntoView {
    let prefs = crate::state::get().prefs;
    let lang = Memo::new(move |_| prefs.text("shapeLang"));
    let text = RwSignal::new(String::new());
    let focus = RwSignal::new(false);
    move || {
        let l = lang.get();
        let head = view! {
            <div class="shp-head">
                <Icon ico=Ico::Lock size=13.0 />
                <span class="shp-kind">"Permission needed"</span>
                <span class="t-mono shp-meta">"Bash · Default"</span>
            </div>
        };
        let body = view! {
            <span class="shp-title">"Run git push --force-with-lease"</span>
            <div class="design-preview">
                <Button kind=ButtonKind::Danger label="Deny" />
                <Button kind=ButtonKind::Primary label="Approve" />
            </div>
        };
        let card = match l.as_str() {
            "tab" => view! {
                <div class="shp-tab-wrap">
                    <span class="shp-tab cut flip" style="--c:6px">
                        <Icon ico=Ico::Lock size=11.0 />
                        <span class="t-mono">"PERMISSION"</span>
                    </span>
                    <div class="shp-card shp-tab-card">{body}</div>
                </div>
            }
            .into_any(),
            "hud" => view! {
                <div class="shp-card shp-hud">
                    <Brackets on=true len=6.0 />
                    <div class="shp-hud-strip t-mono">
                        <span class="shp-hud-t">"// PERMISSION"</span>
                        <span class="shp-hud-meta">"BASH · DEFAULT"</span>
                    </div>
                    <div class="shp-hud-body">{body}</div>
                </div>
            }
            .into_any(),
            "brackets" => view! {
                <div class="shp-card shp-brackets">
                    <Brackets on=true len=10.0 />
                    {head}
                    {body}
                </div>
            }
            .into_any(),
            "bar" | "soft" => view! {
                <div class=format!("shp-card shp-{l}")>{head}{body}</div>
            }
            .into_any(),
            _ => view! {
                <div class="shp-card shp-chamfer cut flip cut-stroke" style="--c:10px">{head}{body}</div>
            }
            .into_any(),
        };
        let input_class = match l.as_str() {
            "chamfer" => "shp-input shp-in-chamfer cut cut-stroke",
            "tab" => "shp-input shp-in-chamfer cut flip cut-stroke",
            "bar" => "shp-input shp-in-bar",
            "brackets" => "shp-input shp-in-brackets",
            "soft" => "shp-input shp-in-soft",
            _ => "shp-input shp-in-hud",
        };
        let hud = l == "hud";
        let brackets = l == "brackets";
        view! {
            <div class="shp">
                {card}
                <div class=input_class class:on=move || focus.get() style="--c:6px">
                    {brackets.then(|| view! { <Brackets on=Signal::derive(move || focus.get()) len=6.0 /> })}
                    {hud.then(|| view! { <span class="t-mono shp-prompt">">"</span> })}
                    <input
                        class:t-mono=hud
                        placeholder="Tell the agent what to do instead"
                        prop:value=move || text.get()
                        on:input=move |e| text.set(event_target_value(&e))
                        on:focus=move |_| focus.set(true)
                        on:blur=move |_| focus.set(false)
                    />
                </div>
            </div>
        }
    }
}

/// The real session state cards (ready, failed) with a replay of their entry.
#[component]
pub fn StateCards() -> impl IntoView {
    let run = RwSignal::new(0u32);
    view! {
        <div class="dp-col">
            {move || {
                run.get();
                view! {
                    <StatePreview />
                    <StatePreview failed=true />
                }
            }}
            <div class="design-preview">
                <Button label="Replay entry" on_press=Callback::new(move |_| run.update(|n| *n += 1)) />
            </div>
        </div>
    }
}

fn sample(
    id: &str,
    kind: Kind,
    label: &str,
    status: Status,
    started: Option<f64>,
    ended: Option<f64>,
) -> Item {
    Item {
        id: id.into(),
        kind,
        label: label.into(),
        status,
        started_at: started,
        ended_at: ended,
        detail: None,
        activity: None,
        port: None,
        parent_id: "preview".into(),
        nested_under: None,
        tool_call_id: None,
        open_id: None,
    }
}

/// Two session rows with fixed sub-work: the row chip and the real sub-work tree.
#[component]
pub fn SubWorkPreview() -> impl IntoView {
    let work = SubWork::new();
    let t = js_sys::Date::now();
    let mut explore = sample(
        "a",
        Kind::Subagent,
        "Explore",
        Status::Running,
        Some(t - 84_000.0),
        None,
    );
    explore.activity = Some("Grep · evictOldest".into());
    let mut dev = sample("b", Kind::Script, "dev", Status::Running, None, None);
    dev.port = Some(3000);
    let items = vec![
        explore,
        dev,
        sample(
            "c",
            Kind::Subagent,
            "ui-next-dev",
            Status::Done,
            Some(t - 300_000.0),
            Some(t - 120_000.0),
        ),
    ];
    let failed = vec![sample(
        "d",
        Kind::Terminal,
        "npm run e2e",
        Status::Failed,
        None,
        None,
    )];
    let open = RwSignal::new(false);
    let row = move |title: &'static str,
                    bucket: Bucket,
                    when: &'static str,
                    list: Vec<Item>,
                    always: bool| {
        let running = list.iter().filter(|x| x.status == Status::Running).count();
        let total = list.len();
        let list = Signal::stored(list);
        view! {
            <div class="dp-sw-row">
                <div class="dp-sw-top">
                    <StatusGlyph bucket=bucket size=8.0 />
                    <span class="dp-sw-title">{title}</span>
                    <button
                        class="t-mono sub-chip"
                        title="Sub-work"
                        on:click=move |_| {
                            if !always {
                                open.update(|o| *o = !*o);
                            }
                        }
                    >
                        <span class="sub-chip-mark"></span>
                        {if running > 0 { running } else { total }}
                    </button>
                    <span class="t-mono dp-sw-time">{when}</span>
                </div>
                <Show when=move || always || open.get()>
                    <SubWorkTree items=list work=work />
                </Show>
            </div>
        }
    };
    view! {
        <div class="dp-sw">
            {row("Interface redesign (ui-next)", Bucket::Working, "3m", items, false)}
            {row("Docs: pairing guide", Bucket::Idle, "1d", failed, true)}
        </div>
    }
}

const STREAM: &str = "The flicker came from the **session list** re-sorting on every status tick.

- `SessionList` now memoises rows by `id`
- the sort key ignores `updatedAt` while an agent is *working*

Run `npm test` to confirm.";

/// A short bursty stream of sample markdown through the production reply reveal.
#[component]
pub fn StreamPreview() -> impl IntoView {
    let prefs = crate::state::get().prefs;
    let run = RwSignal::new(0u32);
    view! {
        <div class="dp-col dp-stream">
            {move || {
                run.get();
                prefs.text("textReveal");
                view! { <Stream /> }
            }}
            <div class="design-preview">
                <Button label="Replay stream" icon=Ico::RefreshCw on_press=Callback::new(move |_| run.update(|n| *n += 1)) />
            </div>
        </div>
    }
}

#[component]
fn Stream() -> impl IntoView {
    let len = RwSignal::new(0usize);
    let chars: Vec<char> = STREAM.chars().collect();
    let total = chars.len();
    fn step(len: RwSignal<usize>, total: usize, delay: u64) {
        set_timeout(
            move || {
                let Some(cur) = len.try_get_untracked() else {
                    return;
                };
                let next = (cur + 2 + (js_sys::Math::random() * 12.0) as usize).min(total);
                if len.try_set(next).is_some() {
                    return;
                }
                if next < total {
                    step(len, total, 40 + (js_sys::Math::random() * 130.0) as u64);
                }
            },
            Duration::from_millis(delay),
        );
    }
    step(len, total, 300);
    let text = Signal::derive(move || chars[..len.get()].iter().collect::<String>());
    let streaming = Signal::derive(move || len.get() < total);
    view! { <RevealReply text=text streaming=streaming on_link=Callback::new(|_| ()) /> }
}

const TITLES: [(&str, &str); 3] = [
    ("What do you want to know?", "dp-h-hero"),
    ("Agent crashed", "dp-h-crash"),
    ("Source control", "dp-h-panel"),
];

/// Display headings through the picked heading reveal, with a replay.
#[component]
pub fn HeadingPreview() -> impl IntoView {
    let prefs = crate::state::get().prefs;
    let run = RwSignal::new(0u32);
    view! {
        <div class="dp-col">
            {move || {
                run.get();
                let mode = prefs.text("headingReveal");
                TITLES
                    .iter()
                    .map(|(t, class)| heading(t, class, &mode))
                    .collect_view()
            }}
            <div class="design-preview">
                <Button label="Replay" icon=Ico::RefreshCw on_press=Callback::new(move |_| run.update(|n| *n += 1)) />
            </div>
        </div>
    }
}

fn heading(text: &'static str, class: &'static str, mode: &str) -> AnyView {
    match mode {
        "stagger" => {
            view! { <div><RevealHeading text=text.to_string() class=class /></div> }.into_any()
        }
        "wipe" => view! { <div class=format!("t-display dp-wipe {class}")>{text}</div> }.into_any(),
        "scramble" => {
            view! { <div class=format!("t-display {class}")><Scramble text=text /></div> }
                .into_any()
        }
        _ => view! { <div class=format!("t-display {class}")>{text}</div> }.into_any(),
    }
}

/// Letters settle left to right out of glyph noise over a short run.
#[component]
fn Scramble(text: &'static str) -> impl IntoView {
    const MS: f64 = 560.0;
    const TICK: u64 = 40;
    let chars: Vec<char> = text.chars().collect();
    let tick = RwSignal::new(0u32);
    let done = ((MS / TICK as f64).ceil()) as u32;
    if let Ok(h) = set_interval_with_handle(
        move || {
            if let Some(n) = tick.try_get_untracked() {
                if n < done {
                    let _ = tick.try_set(n + 1);
                }
            }
        },
        Duration::from_millis(TICK),
    ) {
        on_cleanup(move || h.clear());
    }
    view! {
        <span aria-label=text>
            {move || {
                let t = tick.get();
                let settled = ((t as f64 / done as f64) * chars.len() as f64).floor() as usize;
                let settled = settled.min(chars.len());
                let head: String = chars[..settled].iter().collect();
                let tail = noise_of(&chars[settled..], settled, t);
                format!("{head}{tail}")
            }}
        </span>
    }
}
