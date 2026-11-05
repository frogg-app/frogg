//! Settings building blocks (ui-next `settings/controls.tsx`, `settings/pages/kit.tsx`):
//! sections, rows, toggles, short fields, banners, list items, inline confirms and request state.
//! Styles live in `styles/flows.css`.

use leptos::prelude::*;

use crate::components::{Button, ButtonKind, Ico, Icon};
use crate::state::config::Rpc;
use crate::state::Conn;

#[component]
pub fn Section(#[prop(into)] title: String, children: Children) -> impl IntoView {
    view! {
        <section class="set-section">
            <h3 class="set-section-t">{title}</h3>
            <div class="set-card">{children()}</div>
        </section>
    }
}

#[component]
pub fn Row(
    #[prop(into)] label: Signal<String>,
    #[prop(optional, into)] hint: MaybeProp<String>,
    /// Hint in the error colour.
    #[prop(optional, into)]
    bad: Signal<bool>,
    #[prop(optional)] children: Option<Children>,
) -> impl IntoView {
    view! {
        <div class="set-row">
            <div class="set-row-text">
                <span class="set-row-label">{move || label.get()}</span>
                {move || hint.get().filter(|h| !h.is_empty()).map(|h| view! {
                    <span class="set-row-hint" class:bad=move || bad.get()>{h}</span>
                })}
            </div>
            {children.map(|c| view! { <div class="set-row-ctl">{c()}</div> })}
        </div>
    }
}

#[component]
pub fn Toggle(
    #[prop(into)] value: Signal<bool>,
    on_change: Callback<bool>,
    #[prop(optional, into)] disabled: Signal<bool>,
    #[prop(optional, into)] label: String,
) -> impl IntoView {
    view! {
        <button
            class="toggle"
            class:on=move || value.get()
            role="switch"
            aria-checked=move || value.get().to_string()
            aria-label=label
            disabled=move || disabled.get()
            on:click=move |_| on_change.run(!value.get_untracked())
        >
            <span class="toggle-knob"></span>
        </button>
    }
}

/// A toggle bound to a boolean device pref.
#[component]
pub fn PrefToggle(
    key: &'static str,
    #[prop(optional, into)] disabled: Signal<bool>,
) -> impl IntoView {
    let prefs = crate::state::get().prefs;
    view! {
        <Toggle
            value=Signal::derive(move || prefs.flag(key))
            on_change=Callback::new(move |v: bool| prefs.set(key, v))
            disabled=disabled
        />
    }
}

/// A segmented control bound to a string device pref.
#[component]
pub fn PrefSeg(
    key: &'static str,
    options: &'static [(&'static str, &'static str)],
) -> impl IntoView {
    let prefs = crate::state::get().prefs;
    view! {
        <crate::components::Seg
            options=opts(options)
            value=Signal::derive(move || prefs.text(key))
            on_change=Callback::new(move |v: String| prefs.set(key, v))
        />
    }
}

pub fn opts(options: &[(&str, &str)]) -> Vec<(String, String)> {
    options
        .iter()
        .map(|(v, l)| (v.to_string(), l.to_string()))
        .collect()
}

/// A short numeric field with a unit; commits on blur or Enter, clamped to [min, max].
#[component]
pub fn NumField(
    #[prop(into)] value: Signal<Option<f64>>,
    on_change: Callback<Option<f64>>,
    #[prop(optional, into)] unit: Option<String>,
    #[prop(default = 0.0)] min: f64,
    #[prop(default = 1e15)] max: f64,
    #[prop(default = 1.0)] step: f64,
    #[prop(optional, into)] placeholder: String,
    #[prop(default = 72.0)] width: f64,
) -> impl IntoView {
    let draft = RwSignal::new(None::<String>);
    let commit = move || {
        let Some(d) = draft.get_untracked() else {
            return;
        };
        draft.set(None);
        let raw = d.replace(',', "");
        let raw = raw.trim();
        if raw.is_empty() {
            return on_change.run(None);
        }
        let Ok(n) = raw.parse::<f64>() else { return };
        if !n.is_finite() {
            return;
        }
        let r = ((n / step).round() * step * 10_000.0).round() / 10_000.0;
        on_change.run(Some(r.clamp(min, max)));
    };
    view! {
        <span class="numfield">
            <input
                class="set-input t-mono"
                style=format!("width:{width}px")
                inputmode="decimal"
                placeholder=placeholder
                prop:value=move || draft.get().unwrap_or_else(|| value.get().map(fmt_num).unwrap_or_default())
                on:input=move |ev| draft.set(Some(event_target_value(&ev)))
                on:blur=move |_| commit()
                on:keydown=move |ev| if ev.key() == "Enter" { commit() }
            />
            {unit.map(|u| view! { <span class="numfield-unit">{u}</span> })}
        </span>
    }
}

fn fmt_num(n: f64) -> String {
    if n.fract() == 0.0 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

/// A short single-line text field; commits on blur or Enter.
#[component]
pub fn TextField(
    #[prop(into)] value: Signal<String>,
    on_change: Callback<String>,
    #[prop(default = 80.0)] width: f64,
    #[prop(optional, into)] placeholder: Signal<String>,
    #[prop(optional)] mono: bool,
    #[prop(optional, into)] disabled: Signal<bool>,
) -> impl IntoView {
    let draft = RwSignal::new(None::<String>);
    let commit = move || {
        if let Some(d) = draft.get_untracked() {
            draft.set(None);
            on_change.run(d.trim().to_owned());
        }
    };
    view! {
        <input
            class=if mono { "set-input t-mono" } else { "set-input" }
            style=format!("width:{width}px")
            spellcheck="false"
            autocomplete="off"
            disabled=move || disabled.get()
            placeholder=move || placeholder.get()
            prop:value=move || draft.get().unwrap_or_else(|| value.get())
            on:input=move |ev| draft.set(Some(event_target_value(&ev)))
            on:blur=move |_| commit()
            on:keydown=move |ev| if ev.key() == "Enter" { commit() }
        />
    }
}

/// A free text input bound to a signal (forms, not auto-committing).
#[component]
pub fn Input(
    value: RwSignal<String>,
    #[prop(optional, into)] placeholder: String,
    #[prop(optional)] mono: bool,
    #[prop(optional)] grow: bool,
    #[prop(optional)] password: bool,
    #[prop(optional)] autofocus: bool,
    #[prop(optional, into)] on_enter: Option<Callback<()>>,
) -> impl IntoView {
    view! {
        <input
            class=format!("set-input{}{}", if mono { " t-mono" } else { "" }, if grow { " grow" } else { "" })
            type=if password { "password" } else { "text" }
            spellcheck="false"
            autocomplete="off"
            autofocus=autofocus
            placeholder=placeholder
            prop:value=move || value.get()
            on:input=move |ev| value.set(event_target_value(&ev))
            on:keydown=move |ev| {
                if ev.key() == "Enter" {
                    if let Some(cb) = on_enter {
                        ev.prevent_default();
                        cb.run(());
                    }
                }
            }
        />
    }
}

/// Intro paragraph above a page's first section.
#[component]
pub fn Lede(children: Children) -> impl IntoView {
    view! { <p class="set-lede">{children()}</p> }
}

/// Faint note under a section.
#[component]
pub fn Note(children: Children) -> impl IntoView {
    view! { <p class="set-note">{children()}</p> }
}

/// A small outlined tag; `tint` is a theme token (`mint`, `coral`, `cyan2`…).
#[component]
pub fn Pill(
    #[prop(into)] text: Signal<String>,
    #[prop(optional, into)] tint: Signal<String>,
) -> impl IntoView {
    view! {
        <span
            class="pill t-mono"
            style=move || {
                let t = tint.get();
                format!("--tint:var(--{})", if t.is_empty() { "muted".to_owned() } else { t })
            }
        >
            {move || text.get()}
        </span>
    }
}

/// The wide call-out at the top of a page.
#[component]
pub fn Banner(
    ico: Ico,
    #[prop(into)] title: Signal<String>,
    #[prop(optional, into)] body: Option<String>,
    #[prop(optional)] children: Option<Children>,
) -> impl IntoView {
    view! {
        <div class="set-banner">
            <Icon ico=ico size=22.0 class="cyan2" />
            <div class="set-banner-text">
                <span class="set-banner-t">{move || title.get()}</span>
                {body.map(|b| view! { <span class="set-banner-b">{b}</span> })}
            </div>
            {children.map(|c| view! { <div class="set-acts">{c()}</div> })}
        </div>
    }
}

/// One list entry: icon, title, sub-line, trailing actions.
#[component]
pub fn Item(
    #[prop(optional)] ico: Option<Ico>,
    #[prop(into)] title: Signal<String>,
    #[prop(optional, into)] sub: MaybeProp<String>,
    #[prop(optional)] mono: bool,
    #[prop(optional)] children: Option<Children>,
) -> impl IntoView {
    view! {
        <div class="set-item">
            {ico.map(|i| view! { <Icon ico=i size=16.0 class="faint" /> })}
            <div class="set-item-text">
                <span class="set-item-t">{move || title.get()}</span>
                {move || sub.get().filter(|s| !s.is_empty()).map(|s| view! {
                    <span class=if mono { "set-item-sub t-mono" } else { "set-item-sub" }>{s}</span>
                })}
            </div>
            {children.map(|c| view! { <div class="set-acts">{c()}</div> })}
        </div>
    }
}

/// A plain block inside a section card, for forms and editors.
#[component]
pub fn Block(children: Children) -> impl IntoView {
    view! { <div class="set-block">{children()}</div> }
}

#[component]
pub fn Acts(children: Children) -> impl IntoView {
    view! { <div class="set-acts">{children()}</div> }
}

#[component]
pub fn ErrorLine(#[prop(into)] text: Signal<Option<String>>) -> impl IntoView {
    move || {
        text.get()
            .map(|t| view! { <span class="set-err t-mono" role="alert">{t}</span> })
    }
}

#[component]
pub fn Value(#[prop(into)] text: Signal<String>) -> impl IntoView {
    view! { <span class="set-value t-mono">{move || text.get()}</span> }
}

/// A destructive button that asks once more inline before it acts.
#[component]
pub fn Confirm(
    #[prop(into)] label: String,
    #[prop(into)] confirm: String,
    on_confirm: Callback<()>,
    #[prop(optional, into)] pending: Signal<bool>,
    #[prop(optional, into)] disabled: Signal<bool>,
) -> impl IntoView {
    let asking = RwSignal::new(false);
    let label = StoredValue::new(label);
    let confirm = StoredValue::new(confirm);
    move || {
        if pending.get() {
            view! { <Button label="Working…" disabled=true /> }.into_any()
        } else if !asking.get() {
            view! {
                <Button label=label.get_value() disabled=disabled on_press=Callback::new(move |_| asking.set(true)) />
            }
            .into_any()
        } else {
            view! {
                <span class="set-acts m-enter">
                    <Button label="Cancel" on_press=Callback::new(move |_| asking.set(false)) />
                    <Button
                        kind=ButtonKind::Danger
                        label=confirm.get_value()
                        on_press=Callback::new(move |_| {
                            asking.set(false);
                            on_confirm.run(());
                        })
                    />
                </span>
            }
            .into_any()
        }
    }
}

/// Loading, failed or offline placeholder for a section body; `children` renders once data is in.
#[component]
pub fn RpcStatus(rpc: Rpc, #[prop(into)] what: String, children: ChildrenFn) -> impl IntoView {
    let app = crate::state::get();
    let what = StoredValue::new(what);
    view! {
        {move || rpc.data.with(|d| d.is_some()).then(|| children())}
        {move || {
            let err = rpc.error.get();
            let has = rpc.data.with(|d| d.is_some());
            if has && err.is_none() {
                return None;
            }
            let online = app.conn.active_link().conn == Conn::Online;
            Some(view! {
                <div class="set-status">
                    {match err {
                        Some(e) => view! {
                            <span class="set-status-err">{format!("Couldn’t load {}: {e}", what.get_value())}</span>
                            <Button label="Retry" on_press=Callback::new(move |_| rpc.reload()) />
                        }.into_any(),
                        None => view! {
                            <span class="t-label">
                                {if online { format!("loading {}…", what.get_value()) } else { "host offline".to_owned() }}
                            </span>
                        }.into_any(),
                    }}
                </div>
            })
        }}
    }
}

/// A continuous meter with its percentage; amber from 70, coral from 90.
#[component]
pub fn Meter(#[prop(into)] pct: Signal<Option<f64>>) -> impl IntoView {
    let level = move || match pct.get() {
        Some(p) if p >= 90.0 => "crit",
        Some(p) if p >= 70.0 => "warn",
        _ => "ok",
    };
    view! {
        <span class=move || format!("meter {}", level())>
            <span class="meter-track">
                <span class="meter-fill" style=move || format!("width:{}%", pct.get().unwrap_or(0.0).clamp(0.0, 100.0))></span>
            </span>
            <span class="meter-t t-mono">
                {move || pct.get().map(|p| format!("{}%", p.round())).unwrap_or_else(|| "—".to_owned())}
            </span>
        </span>
    }
}
