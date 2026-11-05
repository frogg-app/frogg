//! The checkout's pull request and CI runs (ui-next `PrsPanel.tsx`, `ci/model.ts`).

use std::cell::Cell;

use leptos::prelude::*;
use leptos::task::spawn_local;
use serde::Deserialize;
use serde_json::Value;

use super::checkout::{detached, err_text};
use super::get;

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub name: String,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub name: String,
    pub status: String,
    #[serde(default)]
    pub progress: Option<f64>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub steps: Vec<Step>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub provider: String,
    pub pipeline: String,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub number: Option<f64>,
    #[serde(default)]
    pub trigger: Option<String>,
    pub status: String,
    #[serde(default)]
    pub progress: Option<f64>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub jobs: Vec<Job>,
}

/// Glyph states: the five check states plus cancelled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CiState {
    Ok,
    Fail,
    Run,
    Wait,
    Skip,
    Cancel,
}

impl CiState {
    /// Collapses forge states onto the glyph set; a cancelled run reads as cancelled.
    pub fn of(status: &str) -> Self {
        let v = status.to_lowercase();
        if v.contains("cancel") {
            CiState::Cancel
        } else if v.contains("skip") || v.contains("neutral") {
            CiState::Skip
        } else if v.contains("success") || v.contains("pass") || v.contains("completed") {
            CiState::Ok
        } else if ["fail", "error", "timed_out", "action_required"]
            .iter()
            .any(|k| v.contains(k))
        {
            CiState::Fail
        } else if v.contains("progress") || v.contains("running") {
            CiState::Run
        } else {
            CiState::Wait
        }
    }

    pub fn done(self) -> bool {
        !matches!(self, CiState::Run | CiState::Wait)
    }

    pub fn class(self) -> &'static str {
        match self {
            CiState::Ok => "ok",
            CiState::Fail => "fail",
            CiState::Run => "run",
            CiState::Wait => "wait",
            CiState::Skip => "skip",
            CiState::Cancel => "cancel",
        }
    }
}

impl Run {
    /// 0..1: the provider's figure, else the jobs averaged.
    pub fn progress(&self) -> f64 {
        if let Some(p) = self.progress {
            return p;
        }
        if self.jobs.is_empty() {
            return if CiState::of(&self.status).done() {
                1.0
            } else {
                0.0
            };
        }
        let sum: f64 = self
            .jobs
            .iter()
            .map(|j| {
                let st = CiState::of(&j.status);
                if st.done() {
                    1.0
                } else if st == CiState::Run {
                    j.progress.unwrap_or(0.0)
                } else {
                    0.0
                }
            })
            .sum();
        sum / self.jobs.len() as f64
    }
}

/// Seconds between two ISO stamps (now while open).
pub fn seconds(a: Option<&str>, b: Option<&str>) -> Option<f64> {
    let a = js_sys::Date::parse(a?);
    let b = b.map(js_sys::Date::parse).unwrap_or_else(js_sys::Date::now);
    (a.is_finite() && b.is_finite()).then(|| ((b - a) / 1000.0).max(0.0))
}

/// 42s · 3m 02s · 1h 04m.
pub fn dur(sec: f64) -> String {
    let n = sec.max(0.0).round() as u64;
    if n < 60 {
        format!("{n}s")
    } else if n < 3600 {
        format!("{}m {:02}s", n / 60, n % 60)
    } else {
        format!("{}h {:02}m", n / 3600, (n % 3600) / 60)
    }
}

#[derive(Clone, Copy)]
pub struct Ci {
    /// `checkout_pr_status` payload (`status`, `authState`, `error`).
    pub pr: RwSignal<Option<Value>>,
    pub runs: RwSignal<Option<Vec<Run>>>,
    pub branch: RwSignal<Option<String>>,
    pub provider_errors: RwSignal<Vec<(String, String)>>,
}

thread_local! {
    static STORE: Cell<Option<Ci>> = const { Cell::new(None) };
}

fn reset(c: Ci) {
    c.pr.set(None);
    c.runs.set(None);
    c.branch.set(None);
    c.provider_errors.set(Vec::new());
}

pub fn store() -> Ci {
    if let Some(c) = STORE.with(|s| s.get()) {
        return c;
    }
    let c = detached(
        || Ci {
            pr: RwSignal::new(None),
            runs: RwSignal::new(None),
            branch: RwSignal::new(None),
            provider_errors: RwSignal::new(Vec::new()),
        },
        reset,
    );
    STORE.with(|s| s.set(Some(c)));
    c
}

impl Ci {
    pub fn load(self, cwd: String) {
        let Some(c) = get().conn.client() else { return };
        let c2 = c.clone();
        let cwd2 = cwd.clone();
        spawn_local(async move {
            let v = c
                .checkout_pr_status(&cwd)
                .await
                .map_err(err_text)
                .and_then(|v| serde_json::to_value(v).map_err(err_text));
            self.pr.set(Some(match v {
                Ok(v) => v,
                Err(e) => serde_json::json!({ "status": null, "error": { "message": e } }),
            }));
        });
        spawn_local(async move {
            let Ok(v) = c2
                .checkout_ci_list_runs(&cwd2)
                .await
                .map_err(err_text)
                .and_then(|v| serde_json::to_value(v).map_err(err_text))
            else {
                self.runs.set(Some(Vec::new()));
                return;
            };
            let runs: Vec<Run> = v["runs"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|r| serde_json::from_value(r.clone()).ok())
                        .collect()
                })
                .unwrap_or_default();
            self.branch.set(v["branch"].as_str().map(str::to_owned));
            self.provider_errors.set(
                v["providerErrors"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|e| {
                        (
                            e["provider"].as_str().unwrap_or_default().to_owned(),
                            e["message"].as_str().unwrap_or_default().to_owned(),
                        )
                    })
                    .collect(),
            );
            self.runs.set(Some(runs));
        });
    }

    pub fn find(self, id: &str) -> Option<Run> {
        self.runs.with(|r| {
            r.as_ref()
                .and_then(|r| r.iter().find(|x| x.id == id).cloned())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn states() {
        assert_eq!(CiState::of("SUCCESS"), CiState::Ok);
        assert_eq!(CiState::of("in_progress"), CiState::Run);
        assert_eq!(CiState::of("cancelled"), CiState::Cancel);
        assert_eq!(CiState::of("failure"), CiState::Fail);
        assert_eq!(CiState::of("queued"), CiState::Wait);
        assert_eq!(CiState::of("skipped"), CiState::Skip);
        assert_eq!(dur(42.0), "42s");
        assert_eq!(dur(182.0), "3m 02s");
        assert_eq!(dur(3840.0), "1h 04m");
    }
}
