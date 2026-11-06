//! Usage (ui-next `UsagePanel.tsx`, `Meter.tsx`): each provider's limit windows as segmented
//! meters, balances, plan and source. Full width: cards sit side by side.

use std::collections::HashSet;
use std::time::Duration;

use leptos::prelude::*;

use super::util::ago;
use crate::components::{Ico, Icon};
use crate::shell::panel_head::PanelHead;
use crate::state::checkout::online;
use crate::state::usage::{store, AccountUsage, ProviderUsage};
use crate::state::{self, Tool};

const CELLS: usize = 20;
/// Per-cell delay of the fill sweep.
const STAGGER_MS: usize = 18;
/// Figures older than this are flagged stale.
const STALE_MS: f64 = 15.0 * 60_000.0;
/// The automatic refresh period for the `meterSeconds` pref (at least 30 s).
fn auto_ms(secs: f64) -> u64 {
    (secs.max(30.0) * 1000.0) as u64
}

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
        <div
            class="pn-meter"
            on:pointerenter=move |_| {
                // `meterHover`: pointer over a meter refreshes when the user turned that on.
                if state::get().prefs.get_untracked::<bool>("meterHover") {
                    store().load(Some(60_000), true);
                }
            }
        >
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
    // ui-next `daemon/usage.ts` `syncTimer`: the `meterTimer`/`meterSeconds` prefs drive the
    // automatic refresh; changing either restarts it.
    let timer = StoredValue::new_local(None::<IntervalHandle>);
    Effect::new(move |_| {
        let on: bool = app.prefs.get("meterTimer");
        let secs: f64 = app.prefs.get("meterSeconds");
        if let Some(h) = timer.get_value() {
            h.clear();
        }
        let ms = auto_ms(secs);
        timer.set_value(
            on.then(|| {
                set_interval_with_handle(
                    move || u.load(Some(ms.saturating_sub(5_000)), true),
                    Duration::from_millis(ms),
                )
                .ok()
            })
            .flatten(),
        );
    });
    on_cleanup(move || {
        if let Some(h) = timer.get_value() {
            h.clear();
        }
    });
    // `meterAfterReply`: a turn finishing spends quota, so refresh when one stops running.
    Effect::new(move |prev: Option<HashSet<String>>| {
        let running: HashSet<String> = app.agents.by_host.with(|m| {
            m.values()
                .flat_map(|s| s.values())
                .filter(|s| s.agent.status == "running")
                .map(|s| s.agent.id.clone())
                .collect()
        });
        if let Some(prev) = prev {
            let finished = prev.iter().any(|id| !running.contains(id));
            if finished && app.prefs.get_untracked::<bool>("meterAfterReply") {
                u.load(Some(30_000), true);
            }
        }
        running
    });
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

const SWATCH: [&str; 5] = [
    "var(--cyan)",
    "var(--violet)",
    "var(--mint)",
    "var(--amber)",
    "var(--coral)",
];

/// An account's identity colour: its own preference, else a stable slot by position.
fn account_tint(a: &AccountUsage, i: usize) -> String {
    match a.color.as_deref() {
        Some(c @ ("cyan" | "violet" | "mint" | "amber" | "coral")) => format!("var(--{c})"),
        _ => SWATCH[i % SWATCH.len()].to_owned(),
    }
}

/// A provider card: its figures, or with two or more sign-ins one block per account (in
/// columns when wide) that collapses to a one-line-per-account summary.
#[component]
fn ProviderCard(p: ProviderUsage) -> impl IntoView {
    let u = store();
    let id = p.provider_id.clone();
    let accounts = Memo::new(move |_| u.accounts.with(|m| m.get(&id).cloned().unwrap_or_default()));
    let open = RwSignal::new(true);
    let p = StoredValue::new(p);
    move || {
        let list = accounts.get();
        let p = p.get_value();
        if list.is_empty() {
            return view! {
                <div class="pn-ucard cut flip" style="--c:10px">
                    <div class="pn-ucard-head">
                        <div class="pn-ucard-titles">
                            <span class="pn-ucard-name">{p.name()}</span>
                            {p.account_email.clone().map(|e| view! { <span class="t-mono pn-row-meta">{e}</span> })}
                        </div>
                        {p.plan_label.clone().map(|l| view! { <span class="pn-pill t-mono">{l}</span> })}
                    </div>
                    <Figures p=p quiet=true />
                </div>
            }
            .into_any();
        }
        let n = list.len();
        let name = p.name();
        view! {
            <div class="pn-ucard pn-ucard-multi cut flip" style="--c:10px">
                <button
                    class="pn-ucard-head pn-ucard-toggle"
                    aria-label=move || format!("{} {}", if open.get() { "Collapse" } else { "Expand" }, name)
                    on:click=move |_| open.update(|o| *o = !*o)
                >
                    <span class="pn-chev" class:open=move || open.get()><Icon ico=Ico::ChevronRight size=13.0 /></span>
                    <span class="pn-ucard-name">{p.name()}</span>
                    <span class="t-mono faint pn-small">{format!("{n} accounts")}</span>
                </button>
                {move || {
                    let list = accounts.get();
                    if open.get() {
                        view! {
                            <div class="pn-accounts">
                                {list.into_iter().enumerate().map(|(i, a)| {
                                    let tint = account_tint(&a, i);
                                    view! { <AccountBlock a=a tint=tint /> }
                                }).collect_view()}
                            </div>
                            <button class="pn-link t-mono pn-manage" on:click=move |_| {
                                let app = state::get();
                                app.ui.set_tool(Tool::Settings);
                                app.ui.open_settings(Some("accounts".into()));
                            }>"Manage accounts"</button>
                        }
                        .into_any()
                    } else {
                        view! { <Summary list=list /> }.into_any()
                    }
                }}
            </div>
        }
        .into_any()
    }
}

fn top_pct(a: &AccountUsage) -> Option<f64> {
    a.usage
        .as_ref()?
        .windows
        .iter()
        .filter_map(|w| w.used())
        .fold(None, |m: Option<f64>, v| Some(m.map_or(v, |m| m.max(v))))
}

fn state_word(a: &AccountUsage) -> &'static str {
    if !a.authenticated {
        "signed out"
    } else if a.error.is_some() || a.usage.as_ref().is_some_and(|u| u.status == "error") {
        "error"
    } else {
        "—"
    }
}

/// The collapsed card: one line per account with its fullest window, and the overall peak.
#[component]
fn Summary(list: Vec<AccountUsage>) -> impl IntoView {
    let peak = list
        .iter()
        .flat_map(|a| {
            a.usage
                .iter()
                .flat_map(|u| u.windows.iter())
                .filter_map(move |w| w.used().map(|p| (p, w.label.clone(), a.label())))
        })
        .fold(None, |m: Option<(f64, String, String)>, x| match m {
            Some(m) if m.0 >= x.0 => Some(m),
            _ => Some(x),
        });
    view! {
        <div class="pn-usum">
            {list.iter().enumerate().map(|(i, a)| {
                let pct = top_pct(a);
                view! {
                    <div class="pn-usum-row">
                        <span class="pn-sw" style=format!("background:{}", account_tint(a, i))></span>
                        <span class="pn-usum-name">{a.label()}</span>
                        {a.is_active.then(|| view! { <span class="pn-pill t-mono cyan2">"new sessions"</span> })}
                        <span class="t-mono" style=format!("color:{}", tone_for(pct))>
                            {pct.map(|p| format!("{}%", p.round())).unwrap_or_else(|| state_word(a).to_owned())}
                        </span>
                    </div>
                }
            }).collect_view()}
            {peak.map(|(p, label, who)| view! {
                <span class="t-mono pn-source">
                    "highest "<span style=format!("color:{}", tone_for(Some(p)))>{format!("{}%", p.round())}</span>
                    {format!(" · {label} · {who}")}
                </span>
            })}
        </div>
    }
}

/// One sign-in inside a provider card: who it is, whether it is in use, and its windows.
#[component]
fn AccountBlock(a: AccountUsage, tint: String) -> impl IntoView {
    view! {
        <div class="pn-acct">
            <div class="pn-acct-head">
                <span class="pn-sw" style=format!("background:{tint}")></span>
                <span class="pn-acct-name">{a.label()}</span>
                {a.is_active.then(|| view! { <span class="pn-pill t-mono cyan2">"new sessions"</span> })}
                <span class="spacer"></span>
                {a.usage.as_ref().and_then(|u| u.plan_label.clone()).map(|l| view! { <span class="t-mono faint pn-small">{l}</span> })}
            </div>
            {a.usage.as_ref().and_then(|u| u.account_email.clone()).map(|e| view! { <span class="t-mono pn-row-meta">{e}</span> })}
            {(!a.authenticated).then(|| view! {
                <div class="pn-acct-state">
                    <span class="pn-pill t-mono coral">"signed out"</span>
                    <span class="pn-muted pn-small">"Sign in from a terminal with this account selected."</span>
                </div>
            })}
            {a.error.clone().map(|e| view! { <span class="t-mono pn-error-inline">{e}</span> })}
            {a.usage.clone().filter(|_| a.authenticated).map(|u| view! { <Figures p=u quiet=false /> })}
        </div>
    }
}

/// Windows, balances and freshness for one usage read.
#[component]
fn Figures(p: ProviderUsage, quiet: bool) -> impl IntoView {
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
    let unreported = !quiet && p.status == "unavailable" && p.error.is_none();
    view! {
        <>
            {p.error.clone().map(|e| view! { <span class="t-mono pn-error-inline">{e}</span> })}
            {unreported.then(|| view! { <span class="pn-muted pn-small">"No usage reported for this sign-in."</span> })}
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
        </>
    }
}
