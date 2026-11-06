//! "Session labels" (ui-next `settings/pages/SessionLabels.tsx`): the host's workspace labels with
//! their use counts; rename, recolour and delete. New labels come from a session's label menu.

use std::collections::HashMap;

use leptos::prelude::*;
use serde_json::Value;

use crate::components::{Button, ButtonKind};
use crate::state::config::{need, Action};
use crate::state::projects::{self, LabelDef};
use crate::views::settings::kit::*;

/// The daemon's label colours (`@frogg/protocol/workspace-labels`), tinted by `--label-<c>`.
const COLORS: &[&str] = &[
    "violet", "sky", "emerald", "orange", "pink", "indigo", "teal", "red", "amber", "blue",
];

#[component]
fn Chip(#[prop(into)] name: Signal<String>, #[prop(into)] tone: Signal<String>) -> impl IntoView {
    view! {
        <span class="set-label-chip t-mono" style=move || format!("--tint:var(--label-{}, var(--muted))", tone.get())>
            {move || name.get()}
        </span>
    }
}

#[component]
fn Swatches(value: RwSignal<String>) -> impl IntoView {
    view! {
        <div class="set-swatches">
            {COLORS
                .iter()
                .map(|c| view! {
                    <button
                        class="set-swatch"
                        class:on=move || value.get() == *c
                        style=format!("background:var(--label-{c})")
                        aria-label=*c
                        aria-pressed=move || (value.get() == *c).to_string()
                        on:click=move |_| value.set(c.to_string())
                    ></button>
                })
                .collect_view()}
        </div>
    }
}

#[component]
pub fn SessionLabels() -> impl IntoView {
    let app = crate::state::get();
    let d = projects::get();
    if !d.loaded.get_untracked() {
        d.reload();
    }
    let q = RwSignal::new(String::new());
    let counts = Memo::new(move |_| {
        let mut m = HashMap::<String, usize>::new();
        d.workspaces.with(|ws| {
            for w in ws.values() {
                for l in &w.labels {
                    *m.entry(l.to_lowercase()).or_default() += 1;
                }
            }
        });
        m
    });
    let shown = Memo::new(move |_| {
        let needle = q.get().trim().to_lowercase();
        let mut out: Vec<LabelDef> = d
            .labels
            .get()
            .into_iter()
            .filter(|l| l.name.to_lowercase().contains(&needle))
            .collect();
        out.sort_by(|a, b| a.name.cmp(&b.name));
        out
    });
    let host = move || {
        app.conn
            .active_link()
            .server_name
            .unwrap_or_else(|| "this host".to_owned())
    };
    view! {
        <div class="set-filter">
            <Input value=q placeholder="Search labels" grow=true />
        </div>
        <ErrorLine text=d.error />
        {move || d.error.get().is_some().then(|| view! {
            <Button label="Retry" on_press=Callback::new(move |_| d.reload()) />
        })}
        <section class="set-section">
            <h3 class="set-section-t">{move || format!("Labels on {}", host())}</h3>
            <div class="set-card">
                {move || {
                    let list = shown.get();
                    if list.is_empty() {
                        let loaded = d.loaded.get();
                        let any = d.labels.with(|l| !l.is_empty());
                        let text = if !loaded {
                            "loading labels…"
                        } else if any {
                            "No labels match."
                        } else {
                            "No labels yet."
                        };
                        return view! { <Block><span class="set-muted">{text}</span></Block> }.into_any();
                    }
                    list.into_iter()
                        .map(|l| {
                            let key = l.name.to_lowercase();
                            let count = Signal::derive(move || counts.with(|c| c.get(&key).copied().unwrap_or(0)));
                            view! { <LabelRow label=l count=count /> }
                        })
                        .collect_view()
                        .into_any()
                }}
            </div>
        </section>
        <Note>"New labels are made from a session’s label menu; they appear here for every device."</Note>
    }
}

#[component]
fn LabelRow(label: LabelDef, count: Signal<usize>) -> impl IntoView {
    let d = projects::get();
    let editing = RwSignal::new(false);
    let name = RwSignal::new(label.name.clone());
    let tone = RwSignal::new(label.color.clone());
    let act = Action::new();
    let label = StoredValue::new(label);
    let open = move |_| {
        label.with_value(|l| {
            name.set(l.name.clone());
            tone.set(l.color.clone());
        });
        editing.set(true);
    };
    let save = move || {
        let next = name.get_untracked().trim().to_owned();
        if next.is_empty() || act.busy() {
            return;
        }
        let (old, old_color) = label.with_value(|l| (l.name.clone(), l.color.clone()));
        let color = tone.get_untracked();
        act.run(
            "save",
            async move {
                let new_name = (next != old).then_some(next.as_str());
                let color = (color != old_color).then_some(Value::String(color));
                need()?
                    .update_workspace_label(&old, new_name, color)
                    .await
                    .map(|_| Value::Null)
                    .map_err(|e| e.to_string())
            },
            move |_| {
                editing.set(false);
                d.reload();
            },
        );
    };
    let remove = move |_| {
        let old = label.with_value(|l| l.name.clone());
        act.run(
            "delete",
            async move {
                need()?
                    .delete_workspace_label(&old)
                    .await
                    .map(|_| Value::Null)
                    .map_err(|e| e.to_string())
            },
            move |_| d.reload(),
        );
    };
    let sessions = move || {
        let n = count.get();
        format!("{n} workspace{}", if n == 1 { "" } else { "s" })
    };
    let shown_name = Signal::derive(move || {
        if editing.get() && !name.get().is_empty() {
            name.get()
        } else {
            label.with_value(|l| l.name.clone())
        }
    });
    let shown_tone = Signal::derive(move || {
        if editing.get() {
            tone.get()
        } else {
            label.with_value(|l| l.color.clone())
        }
    });
    view! {
        <div class="set-label-row">
            <div class="set-label-head">
                <Chip name=shown_name tone=shown_tone />
                <span class="set-label-sub">{move || format!("{} · {}", label.with_value(|l| l.color.clone()), sessions())}</span>
                <span class="grow"></span>
                {move || (!editing.get()).then(|| view! {
                    <Button label="Edit" on_press=Callback::new(open) />
                    <Confirm
                        label="Delete…"
                        confirm={ if count.get_untracked() > 0 { format!("Delete from {}", sessions()) } else { "Delete label".to_owned() } }
                        on_confirm=Callback::new(remove)
                        pending=Signal::derive(move || act.pending.get() == Some("delete"))
                    />
                })}
            </div>
            <ErrorLine text=act.error />
            {move || editing.get().then(|| view! {
                <div class="set-label-edit">
                    <Input value=name autofocus=true on_enter=Callback::new(move |_| save()) />
                    <Swatches value=tone />
                    <span class="grow"></span>
                    <Button label="Cancel" on_press=Callback::new(move |_| editing.set(false)) />
                    <Button
                        kind=ButtonKind::Primary
                        label=Signal::derive(move || if act.pending.get() == Some("save") { "Saving…".to_owned() } else { "Save".to_owned() })
                        disabled=Signal::derive(move || name.get().trim().is_empty() || act.busy())
                        on_press=Callback::new(move |_| save())
                    />
                </div>
            })}
        </div>
    }
}
