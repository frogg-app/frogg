//! Usage (ui-next `UsagePanel.tsx`, `Meter.tsx`): each provider's limit windows as segmented
//! meters, balances, plan and source. Full width: cards sit side by side.

use std::time::Duration;

use leptos::prelude::*;

use super::util::ago;
use crate::components::{Ico, Icon};
use crate::shell::panel_head::PanelHead;
use crate::state::checkout::online;
use crate::state::usage::{store, ProviderUsage};
use crate::state::{self, Tool};

const CELLS: usize = 20;
/// Per-cell delay of the fill sweep.
const STAGGER_MS: usize = 18;
/// Figures older than this are flagged stale.
const STALE_MS: f64 = 15.0 * 60_000.0;
/// Automatic refresh while the panel is open.
const AUTO_MS: u64 = 120_000;

/// "resets in 3h" for a window's reset time.
pub fn until(iso: Option<&str>) -> Option<String> {
    let t = js_sys::Date::parse(iso?);
    if !t.is_finite() {
        return None;
    }
    let m = ((t - js_sys::Date::now()) / 60_000.0).round() as i64;
    Some(if m <= 0 {
        "resets now".into()
    } else if m < 60 {
        format!("resets in {m}m")
    } else if m < 2880 {
        format!("resets in {}h", (m as f64 / 60.0).round())
    } else {
        format!("resets in {}d", (m as f64 / 1440.0).round())
    })
}

/// Meter tint from the device's warning and critical thresholds.
pub fn tone_for(pct: Option<f64>) -> &'static str {
    let prefs = state::get().prefs;
    let warn: f64 = prefs.get("warnPct");
    let crit: f64 = prefs.get("criticalPct");
    match pct {
        None => "var(--faint)",
        Some(p) if p >= crit => "var(--coral)",
        Some(p) if p >= warn => "var(--amber)",
        Some(_) => "var(--cyan)",
    }
}

/// A segmented meter: 20 cells that fill on a short stagger, tinted by level.
#[component]
pub fn Meter(
    #[prop(into)] label: String,
    #[prop(into)] pct: Signal<Option<f64>>,
    #[prop(optional, into)] detail: Option<String>,
) -> impl IntoView {
    let p = Memo::new(move |_| pct.get().map(|p| p.clamp(0.0, 100.0)));
    let filled = Memo::new(move |_| p.get().map(|p| (p / 5.0).round() as usize).unwrap_or(0));
    let tint = Memo::new(move |_| tone_for(p.get()));
    view! {
        <div class="pn-meter">
            <div class="pn-meter-head">
                <span class="pn-meter-label">{label}</span>
                <span class="t-mono pn-meter-pct" class:crit=move || tint.get() == "var(--coral)">
                    {move || p.get().map(|p| format!("{}%", p.round())).unwrap_or_else(|| "—".into())}
                </span>
            </div>
            <div class="pn-meter-bar" style=move || format!("--tint:{}", tint.get())>
                {(0..CELLS)
                    .map(|n| {
                        view! {
                            <span
                                class="pn-cell"
                                class:on=move || n < filled.get()
                                style=format!("transition-delay:{}ms", n * STAGGER_MS)
                            ></span>
                        }
                    })
                    .collect_view()}
            </div>
            {detail.map(|d| view! { <span class="t-mono pn-meter-detail">{d}</span> })}
        </div>
    }
}

#[component]
pub fn UsagePanel() -> impl IntoView {
    let app = state::get();
    let u = store();
    Effect::new(move |_| {
        if online() {
            u.load(None, true);
        }
    });
    if let Ok(h) =
        set_interval_with_handle(move || u.load(None, true), Duration::from_millis(AUTO_MS))
    {
        on_cleanup(move || h.clear());
    }
    let open_settings = move |_| {
        app.ui.set_tool(Tool::Settings);
        app.ui.open_settings(Some("usage".into()));
    };
    view! {
        <div class="panel pn">
            <PanelHead title="Usage">
                <button class="icon-btn" aria-label="Refresh usage" disabled=move || u.loading.get() on:click=move |_| u.load(Some(0), false)>
                    <span class=move || if u.loading.get() { "cyan2" } else { "faint" }><Icon ico=Ico::RefreshCw size=14.0 /></span>
                </button>
                <button class="icon-btn" aria-label="Meter settings" on:click=open_settings>
                    <Icon ico=Ico::Settings size=14.0 class="faint" />
                </button>
            </PanelHead>
            <div class="panel-scroll pn-usage">
                {move || u.error.get().map(|e| view! { <div class="pn-error-inline t-mono">{e}</div> })}
                {move || (u.providers.with(|p| p.is_none()) && u.error.with(|e| e.is_none())).then(|| view! { <span class="t-label">"loading…"</span> })}
                {move || u.providers.with(|p| p.as_ref().is_some_and(|p| p.is_empty())).then(|| view! {
                    <span class="faint">"No provider reports usage on this host."</span>
                })}
                {move || u.backoff_until.get().map(|t| {
                    let at = js_sys::Date::new(&wasm_bindgen::JsValue::from_f64(t));
                    let hm = format!("{:02}:{:02}", at.get_hours(), at.get_minutes());
                    view! { <span class="t-mono faint pn-small">{format!("Provider is rate-limiting usage reads · next automatic refresh {hm}")}</span> }
                })}
                <div class="pn-usage-cards" on:pointerenter=move |_| u.load(None, true)>
                    {move || {
                        u.providers
                            .get()
                            .unwrap_or_default()
                            .into_iter()
                            .filter(|p| p.reports())
                            .map(|p| view! { <ProviderCard p=p /> })
                            .collect_view()
                    }}
                </div>
                {move || {
                    let unset: Vec<String> = u
                        .providers
                        .get()
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|p| !p.reports())
                        .map(|p| p.name())
                        .collect();
                    (!unset.is_empty()).then(|| view! { <span class="t-mono faint pn-small">{format!("not set up: {}", unset.join(", "))}</span> })
                }}
            </div>
        </div>
    }
}

#[component]
fn ProviderCard(p: ProviderUsage) -> impl IntoView {
    let stale = p
        .fetched_at
        .as_deref()
        .map(js_sys::Date::parse)
        .is_some_and(|t| t.is_finite() && js_sys::Date::now() - t > STALE_MS);
    let source = (p.status != "unavailable").then(|| {
        format!(
            "{}{}{}",
            if stale { "stale · " } else { "" },
            p.source_label.clone().unwrap_or_else(|| p.status.clone()),
            p.fetched_at
                .as_deref()
                .map(|f| format!(" · {}", ago(f)))
                .unwrap_or_default()
        )
    });
    view! {
        <div class="pn-ucard cut flip" style="--c:10px">
            <div class="pn-ucard-head">
                <div class="pn-ucard-titles">
                    <span class="pn-ucard-name">{p.name()}</span>
                    {p.account_email.clone().map(|e| view! { <span class="t-mono pn-row-meta">{e}</span> })}
                </div>
                {p.plan_label.clone().map(|l| view! { <span class="pn-pill t-mono">{l}</span> })}
            </div>
            {p.error.clone().map(|e| view! { <span class="t-mono pn-error-inline">{e}</span> })}
            {p.windows
                .iter()
                .map(|w| {
                    let detail = [
                        until(w.resets_at.as_deref()),
                        until(w.runs_out_at.as_deref()).map(|t| t.replacen("resets", "runs out", 1)),
                    ]
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join(" · ");
                    let pct = w.used();
                    if detail.is_empty() {
                        view! { <Meter label=w.label.clone() pct=pct /> }.into_any()
                    } else {
                        view! { <Meter label=w.label.clone() pct=pct detail=detail /> }.into_any()
                    }
                })
                .collect_view()}
            {p.balances
                .clone()
                .unwrap_or_default()
                .into_iter()
                .map(|b| {
                    let show = |v: &Option<serde_json::Value>| v.as_ref().map(|v| v.to_string().trim_matches('"').to_owned());
                    view! {
                        <div class="pn-balance">
                            <span>{b.label.clone()}</span>
                            <span class="t-mono">
                                {show(&b.remaining).unwrap_or_else(|| "—".into())}
                                {show(&b.limit).map(|l| format!(" / {l}"))}
                            </span>
                        </div>
                    }
                })
                .collect_view()}
            {source.map(|s| view! { <span class={if stale { "t-mono pn-stale" } else { "t-mono pn-source" }}>{s}</span> })}
        </div>
    }
}
