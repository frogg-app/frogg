//! Provider usage (ui-next `daemon/usage.ts`, per-provider view): the windows, balances and
//! plan each provider reports, with a rate-limit backoff for automatic refreshes.

use std::cell::Cell;

use leptos::prelude::*;
use leptos::task::spawn_local;
use serde::Deserialize;

use super::checkout::{detached, err_text};
use super::get;

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub used_pct: Option<f64>,
    #[serde(default)]
    pub remaining_pct: Option<f64>,
    #[serde(default)]
    pub resets_at: Option<String>,
    #[serde(default)]
    pub runs_out_at: Option<String>,
}

impl Window {
    pub fn used(&self) -> Option<f64> {
        self.used_pct.or(self.remaining_pct.map(|r| 100.0 - r))
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Balance {
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub remaining: Option<serde_json::Value>,
    #[serde(default)]
    pub limit: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsage {
    #[serde(alias = "provider")]
    pub provider_id: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub account_email: Option<String>,
    #[serde(default)]
    pub plan_label: Option<String>,
    #[serde(default)]
    pub windows: Vec<Window>,
    #[serde(default)]
    pub balances: Option<Vec<Balance>>,
    #[serde(default)]
    pub source_label: Option<String>,
    #[serde(default)]
    pub fetched_at: Option<String>,
}

impl ProviderUsage {
    pub fn name(&self) -> String {
        self.display_name
            .clone()
            .unwrap_or_else(|| crate::shell::status_bar::provider_label(&self.provider_id))
    }

    pub fn reports(&self) -> bool {
        self.status != "unavailable"
    }
}

#[derive(Clone, Copy)]
pub struct Usage {
    pub providers: RwSignal<Option<Vec<ProviderUsage>>>,
    pub loading: RwSignal<bool>,
    pub error: RwSignal<Option<String>>,
    /// Epoch ms until which automatic refreshes wait (provider rate-limiting).
    pub backoff_until: RwSignal<Option<f64>>,
}

const BACKOFF_MIN_MS: f64 = 2.0 * 60_000.0;
const BACKOFF_MAX_MS: f64 = 30.0 * 60_000.0;

thread_local! {
    static STORE: Cell<Option<Usage>> = const { Cell::new(None) };
    static BACKOFF: Cell<f64> = const { Cell::new(0.0) };
}

fn reset(u: Usage) {
    BACKOFF.with(|b| b.set(0.0));
    u.providers.set(None);
    u.error.set(None);
    u.backoff_until.set(None);
}

pub fn store() -> Usage {
    if let Some(u) = STORE.with(|s| s.get()) {
        return u;
    }
    let u = detached(
        || Usage {
            providers: RwSignal::new(None),
            loading: RwSignal::new(false),
            error: RwSignal::new(None),
            backoff_until: RwSignal::new(None),
        },
        reset,
    );
    STORE.with(|s| s.set(Some(u)));
    u
}

fn rate_limited(e: &str) -> bool {
    let l = e.to_lowercase();
    l.contains("429")
        || l.contains("rate limit")
        || l.contains("rate-limit")
        || l.contains("too many requests")
}

impl Usage {
    /// `max_age_ms = Some(0)` forces past the daemon's cache; `auto` reads skip while backing off.
    pub fn load(self, max_age_ms: Option<u64>, auto: bool) {
        if self.loading.get_untracked() {
            return;
        }
        let Some(c) = get().conn.client() else { return };
        let backing_off = self
            .backoff_until
            .get_untracked()
            .is_some_and(|u| js_sys::Date::now() < u);
        if auto && backing_off {
            return;
        }
        let max_age = if backing_off && max_age_ms == Some(0) {
            None
        } else {
            max_age_ms
        };
        self.loading.set(true);
        spawn_local(async move {
            let res = c
                .list_provider_usage(None, None, max_age)
                .await
                .map_err(err_text)
                .and_then(|v| serde_json::to_value(v).map_err(err_text));
            self.loading.set(false);
            match res {
                Ok(v) => {
                    let list: Vec<ProviderUsage> = v["providers"]
                        .as_array()
                        .map(|a| {
                            a.iter()
                                .filter_map(|p| serde_json::from_value(p.clone()).ok())
                                .collect()
                        })
                        .unwrap_or_default();
                    let hit = list
                        .iter()
                        .any(|p| p.error.as_deref().is_some_and(rate_limited));
                    let b = BACKOFF.with(|b| {
                        let next = if hit {
                            (b.get() * 2.0).clamp(BACKOFF_MIN_MS, BACKOFF_MAX_MS)
                        } else {
                            0.0
                        };
                        b.set(next);
                        next
                    });
                    self.backoff_until.set(hit.then(|| js_sys::Date::now() + b));
                    self.providers.set(Some(list));
                    self.error.set(None);
                }
                Err(e) => self.error.set(Some(e)),
            }
        });
    }
}
