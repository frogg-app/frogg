//! Command palette (ui-next `Palette.tsx`): sessions, commands and tools in one filtered list,
//! `>` for commands only, arrows to move, Enter to run.

use leptos::html;
use leptos::prelude::*;

use super::tools::{shown, TOOLS};
use crate::components::{use_presence, Ico, Icon, StatusGlyph};
use crate::state::kbd::kbd;
use crate::state::{bucket_of, Bucket, Tool};
use crate::theme::OVERLAY_OUT_MS;

#[derive(Clone)]
struct Item {
    id: String,
    group: &'static str,
    label: String,
    hint: Option<String>,
    kbd: Option<&'static str>,
    glyph: Option<Bucket>,
    run: Callback<()>,
}

const FOOT_HINTS: [(&str, &str); 4] = [
    ("↑↓", "move"),
    ("↵", "run"),
    (">", "commands only"),
    ("esc", "close"),
];

fn items(q: &str) -> Vec<Item> {
    let app = crate::state::get();
    let ui = app.ui;
    let mut list = Vec::new();
    // Newest first by `updatedAt`, as ui-next: `sessions()` already sorts that way.
    for s in app.sessions() {
        let id = s.agent.id.clone();
        list.push(Item {
            id: s.agent.id.clone(),
            group: "Sessions",
            label: s.agent.title_or_untitled(),
            hint: s.project.as_ref().map(|p| p.project_name.clone()),
            kbd: None,
            glyph: Some(bucket_of(&s.agent)),
            run: Callback::new(move |_| {
                ui.set_tool(Tool::Sessions);
                ui.select(Some(id.clone()));
            }),
        });
    }
    let cmd =
        |id: &str, label: &str, hint: Option<&str>, k: Option<&'static str>, run: Callback<()>| {
            Item {
                id: id.into(),
                group: "Commands",
                label: label.into(),
                hint: hint.map(str::to_owned),
                kbd: k,
                glyph: None,
                run,
            }
        };
    list.push(cmd(
        "new-session",
        "New session",
        None,
        Some("⌘N"),
        Callback::new(move |_| ui.set_new_session(true, None)),
    ));
    list.push(cmd(
        "new-term",
        "New terminal",
        None,
        Some("⌃`"),
        Callback::new(move |_| {
            ui.set_tool(Tool::Terminals);
            super::keys::new_terminal();
        }),
    ));
    list.push(cmd(
        "onboarding",
        "Getting started",
        Some("walkthrough"),
        None,
        Callback::new(move |_| crate::state::onboarding::get().open(None)),
    ));
    list.push(cmd(
        "hosts",
        "Switch host",
        Some("add or switch"),
        None,
        Callback::new(move |_| ui.host_sheet_open.set(true)),
    ));
    list.push(cmd(
        "home",
        "Start something (home)",
        None,
        None,
        Callback::new(move |_| {
            ui.set_tool(Tool::Sessions);
            ui.select(None);
        }),
    ));
    for t in TOOLS.iter().filter(|t| shown(&app, t.id)) {
        let id = t.id;
        list.push(Item {
            id: format!("go-{}", id.id()),
            group: "Go to",
            label: t.label.into(),
            hint: None,
            kbd: None,
            glyph: None,
            run: Callback::new(move |_| ui.set_tool(id)),
        });
    }
    let commands_only = q.starts_with('>');
    let needle = if commands_only { &q[1..] } else { q }
        .trim()
        .to_lowercase();
    list.into_iter()
        .filter(|i| {
            (!commands_only || i.group != "Sessions")
                && (needle.is_empty()
                    || format!("{} {}", i.label, i.hint.clone().unwrap_or_default())
                        .to_lowercase()
                        .contains(&needle))
        })
        .collect()
}

#[component]
pub fn Palette() -> impl IntoView {
    let app = crate::state::get();
    let open = app.ui.palette_open;
    let p = use_presence(open.into(), OVERLAY_OUT_MS);
    let q = RwSignal::new(String::new());
    let cursor = RwSignal::new(0usize);
    let input = NodeRef::<html::Input>::new();
    let list = Signal::derive(move || {
        open.track();
        items(&q.get())
    });
    let close = move || {
        open.set(false);
        q.set(String::new());
        cursor.set(0);
    };
    let pick = move |i: Option<Item>| {
        if let Some(i) = i {
            close();
            i.run.run(());
        }
    };
    Effect::new(move |_| {
        if open.get() {
            request_animation_frame(move || {
                if let Some(el) = input.get_untracked() {
                    let _ = el.focus();
                }
            });
        }
    });
    let on_key = move |ev: leptos::ev::KeyboardEvent| match ev.key().as_str() {
        "ArrowDown" => {
            ev.prevent_default();
            let n = list.with_untracked(Vec::len);
            cursor.update(|c| *c = (*c + 1).min(n.saturating_sub(1)));
        }
        "ArrowUp" => {
            ev.prevent_default();
            cursor.update(|c| *c = c.saturating_sub(1));
        }
        "Enter" => {
            ev.prevent_default();
            pick(list.with_untracked(|l| l.get(cursor.get_untracked()).cloned()));
        }
        "Escape" => close(),
        _ => {}
    };
    view! {
        <Show when=move || p.mounted.get()>
            <div class="layer palette-layer" class:closing=move || p.closing.get()>
                <div
                    class=move || format!("scrim blur {}", if p.closing.get() { "m-fade-out" } else { "m-fade-in" })
                    on:click=move |_| close()
                ></div>
                <div class=move || format!("palette-place {}", if p.closing.get() { "m-pop-out" } else { "m-rise" })>
                    <div class="palette cut flip cut-stroke" style="--c:14px">
                        <input
                            class="palette-input"
                            node_ref=input
                            placeholder="Search sessions, commands, tools…"
                            prop:value=move || q.get()
                            on:input=move |ev| {
                                q.set(event_target_value(&ev));
                                cursor.set(0);
                            }
                            on:keydown=on_key
                        />
                        <div class="palette-list">
                            {move || {
                                let l = list.get();
                                if l.is_empty() {
                                    return view! { <span class="t-label palette-empty">"no matches"</span> }.into_any();
                                }
                                let mut prev = "";
                                l.into_iter()
                                    .enumerate()
                                    .map(|(n, i)| {
                                        let head = (i.group != prev).then_some(i.group);
                                        prev = i.group;
                                        let item = i.clone();
                                        view! {
                                            {head.map(|g| view! { <div class="t-label palette-group">{g}</div> })}
                                            <button
                                                class="palette-row"
                                                class:on=move || cursor.get() == n
                                                data-id=i.id.clone()
                                                on:pointerenter=move |_| cursor.set(n)
                                                on:click=move |_| pick(Some(item.clone()))
                                            >
                                                {match i.glyph {
                                                    Some(b) => view! { <StatusGlyph bucket=b size=8.0 /> }.into_any(),
                                                    None => view! { <Icon ico=Ico::ChevronRight size=13.0 class="faint" /> }.into_any(),
                                                }}
                                                <span class="palette-label">{i.label.clone()}</span>
                                                {i.hint.clone().map(|h| view! { <span class="t-mono palette-hint">{h}</span> })}
                                                {i.kbd.map(|k| view! { <span class="t-mono kbd">{kbd(k)}</span> })}
                                            </button>
                                        }
                                    })
                                    .collect_view()
                                    .into_any()
                            }}
                        </div>
                        <div class="palette-foot">
                            {FOOT_HINTS
                                .iter()
                                .map(|(k, l)| view! {
                                    <span class="palette-fh">
                                        <span class="t-mono kbd">{kbd(k)}</span>
                                        <span class="palette-fh-t">{*l}</span>
                                    </span>
                                })
                                .collect_view()}
                        </div>
                    </div>
                </div>
            </div>
        </Show>
    }
}
