//! Host › Resources & storage (ui-next `ResourcesStorage.tsx`): live CPU, memory, disk and
//! uptime, the storage Frogg owns on the host with per-category clean, and storage alerts.

use frogg_client_core::DaemonClient;
use leptos::prelude::*;
use serde_json::{json, Value};

use crate::components::Button;
use crate::state::config::{self, call, fmt_bytes, fmt_uptime, need, ns, s, Action, Answer};
use crate::views::settings::kit::*;

const GIB: f64 = 1024.0 * 1024.0 * 1024.0;

fn name_of(id: &str) -> String {
    match id {
        "worktrees" => "Worktrees",
        "agent_worktrees" => "Agent worktrees",
        "agents" => "Agent state",
        "logs" => "Logs",
        "provider_accounts" => "Provider accounts",
        "uploads" => "Uploads",
        "tts_cache" => "Speech cache",
        "models" => "Speech models",
        "daemon_versions" => "Daemon versions",
        "temp" => "Temp",
        "projects" => "Projects",
        "project_import_staging" => "Import staging",
        other => return other.replace('_', " "),
    }
    .to_owned()
}

fn pct(used: f64, total: f64) -> Option<f64> {
    (total > 0.0).then(|| used / total * 100.0)
}

fn num(v: &Value, p: &str) -> f64 {
    v.pointer(p).and_then(Value::as_f64).unwrap_or(0.0)
}

async fn list_storage(c: DaemonClient, refresh: bool) -> Answer {
    call(
        &c,
        "daemon.storage.list.request",
        if refresh {
            json!({ "refresh": true })
        } else {
            json!({})
        },
        "daemon.storage.list.response",
        Some(300_000),
    )
    .await
}

fn cats_of(v: &Value) -> Vec<Value> {
    v.get("categories")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter(|c| c.get("exists") == Some(&Value::Bool(true)) && num(c, "/bytes") > 0.0)
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

/// "Jan 2, 2026, 3:04:05 PM" in the device locale.
fn local_time(iso: &str) -> String {
    let d = js_sys::Date::new(&wasm_bindgen::JsValue::from_str(iso));
    if d.get_time().is_nan() {
        return iso.to_owned();
    }
    d.to_locale_string("default", &wasm_bindgen::JsValue::UNDEFINED)
        .as_string()
        .unwrap_or_else(|| iso.to_owned())
}

#[component]
pub fn ResourcesStorage() -> impl IntoView {
    let supported = config::feature("hostResources");
    let enabled = Signal::derive(move || supported != Some(false));
    let metrics = config::use_rpc(
        |c: DaemonClient| async move { ns(&c, "daemon.host.get_metrics.request", json!({})).await },
        enabled,
        Some(5000),
    );
    let storage = config::use_rpc(|c: DaemonClient| list_storage(c, false), enabled, None);
    if supported == Some(false) {
        return view! { <span class="set-muted">"This daemon is too old to report resources. Update it first."</span> }
            .into_any();
    }
    let title = move || {
        storage
            .data
            .get()
            .map(|d| {
                let total: f64 = cats_of(&d).iter().map(|c| num(c, "/bytes")).sum();
                format!("Storage owned by Frogg · {}", fmt_bytes(total))
            })
            .unwrap_or_else(|| "Storage owned by Frogg".to_owned())
    };
    view! {
        <Section title="Now">
            <RpcStatus rpc=metrics what="host metrics">
                {move || metrics.data.get().and_then(|d| d.get("metrics").filter(|m| m.is_object()).cloned()).map(|m| {
                    let model = s(&m["cpu"], "model");
                    let cpu_hint = format!("{} cores{}", num(&m, "/cpu/cores"), if model.is_empty() { String::new() } else { format!(" · {model}") });
                    let cpu = m.pointer("/cpu/usagePercent").and_then(Value::as_f64);
                    let mem = pct(num(&m, "/memory/usedBytes"), num(&m, "/memory/totalBytes"));
                    let mem_hint = format!("{} / {}", fmt_bytes(num(&m, "/memory/usedBytes")), fmt_bytes(num(&m, "/memory/totalBytes")));
                    let disk = m.get("disk").filter(|d| d.is_object()).map(|d| {
                        let hint = format!("{} / {} · {}", fmt_bytes(num(d, "/usedBytes")), fmt_bytes(num(d, "/totalBytes")), s(d, "path"));
                        let p = pct(num(d, "/usedBytes"), num(d, "/totalBytes"));
                        view! { <Row label="Disk" hint=hint><Meter pct=p /></Row> }
                    });
                    let up_hint = format!("Daemon {} · {} resident", fmt_uptime(num(&m, "/daemon/uptimeSeconds") as u64), fmt_bytes(num(&m, "/daemon/rssBytes")));
                    let up = format!("{} · daemon pid {}", fmt_uptime(num(&m, "/uptimeSeconds") as u64), num(&m, "/daemon/pid"));
                    view! {
                        <Row label="CPU" hint=cpu_hint><Meter pct=cpu /></Row>
                        <Row label="Memory" hint=mem_hint><Meter pct=mem /></Row>
                        {disk}
                        <Row label="Uptime" hint=up_hint><Value text=up /></Row>
                    }
                })}
            </RpcStatus>
        </Section>
        <section class="set-section">
            <h3 class="set-section-t">{title}</h3>
            <div class="set-card">
                <RpcStatus rpc=storage what="storage">
                    {move || {
                        let cats = storage.data.get().map(|d| cats_of(&d)).unwrap_or_default();
                        if cats.is_empty() {
                            view! { <Row label="No owned storage found" /> }.into_any()
                        } else {
                            cats.into_iter()
                                .map(|c| view! { <CategoryRow cat=c on_cleaned=Callback::new(move |_| storage.reload()) /> })
                                .collect_view()
                                .into_any()
                        }
                    }}
                </RpcStatus>
            </div>
        </section>
        {move || storage.data.get().and_then(|d| d.get("computedAt").and_then(Value::as_str).map(str::to_owned)).map(|at| view! {
            <div class="set-measured">
                <span class="set-faint">{format!("Measured {}", local_time(&at))}</span>
                <RefreshStorage on_done=Callback::new(move |_| storage.reload()) />
            </div>
        })}
        <StorageAlerts />
    }
    .into_any()
}

#[component]
fn CategoryRow(cat: Value, on_cleaned: Callback<()>) -> impl IntoView {
    let act = Action::new();
    let id = s(&cat, "id");
    let reclaim = num(&cat, "/reclaimableBytes");
    let confirm = if reclaim > 0.0 {
        format!("Frees {}", fmt_bytes(reclaim))
    } else {
        "Clean".to_owned()
    };
    let path = s(&cat, "path");
    let hint = Signal::derive(move || {
        act.error
            .get()
            .or_else(|| (!path.is_empty()).then(|| path.clone()))
    });
    let size = format!(
        "{}{}",
        if cat.get("truncated") == Some(&Value::Bool(true)) {
            "≥ "
        } else {
            ""
        },
        fmt_bytes(num(&cat, "/bytes"))
    );
    let cleanable = cat.get("cleanable") == Some(&Value::Bool(true));
    let label = name_of(&id);
    let clean = Callback::new(move |_| {
        let id = id.clone();
        act.run(
            "clean",
            async move {
                call(
                    &need()?,
                    "daemon.storage.clean.request",
                    json!({ "categoryId": id }),
                    "daemon.storage.clean.response",
                    Some(600_000),
                )
                .await
            },
            move |_| on_cleaned.run(()),
        );
    });
    view! {
        <Row label=label hint=hint bad=Signal::derive(move || act.error.get().is_some())>
            <Value text=size />
            {cleanable.then(|| view! {
                <Confirm
                    label="Clean…"
                    confirm=confirm.clone()
                    on_confirm=clean
                    pending=Signal::derive(move || act.pending.get() == Some("clean"))
                    disabled=reclaim <= 0.0
                />
            })}
        </Row>
    }
}

#[component]
fn RefreshStorage(on_done: Callback<()>) -> impl IntoView {
    let act = Action::new();
    let run = move |_| {
        act.run(
            "r",
            async move { list_storage(need()?, true).await },
            move |_| on_done.run(()),
        );
    };
    view! {
        <Button
            label=Signal::derive(move || if act.busy() { "Measuring…".to_owned() } else { "Measure again".to_owned() })
            on_press=Callback::new(run)
        />
        <ErrorLine text=act.error />
    }
}

fn set_alerts(patch: Value) {
    config::get().patch(json!({ "storage": { "alerts": patch } }));
}

fn to_bytes(gib: Option<f64>) -> f64 {
    gib.unwrap_or(1.0).max(1.0) * GIB
}

#[component]
fn StorageAlerts() -> impl IntoView {
    let cfg = config::get();
    let supported = config::feature("storageAlerts") == Some(true);
    let alerts = Memo::new(move |_| cfg.at("/storage/alerts").filter(Value::is_object));
    move || {
        let a = alerts.get().filter(|_| supported)?;
        let gib = |k: &str| Some((num(&a, k) / GIB).round());
        let (warn, crit) = (gib("/warnBytes"), gib("/criticalBytes"));
        let enabled = a.get("enabled") == Some(&Value::Bool(true));
        let critical_only = s(&a, "notifyAt") == "critical";
        Some(view! {
            <Section title="Storage alerts">
                <Row label="Alerts" hint="Notify when Frogg-owned storage grows past a threshold">
                    <Toggle
                        value=enabled
                        on_change=Callback::new(|v: bool| set_alerts(json!({ "enabled": v })))
                        label="Alerts"
                    />
                </Row>
                <Row label="Warning at">
                    <NumField
                        value=warn
                        on_change=Callback::new(|v| set_alerts(json!({ "warnBytes": to_bytes(v) })))
                        unit="GiB"
                        min=1.0
                    />
                </Row>
                <Row label="Critical at">
                    <NumField
                        value=crit
                        on_change=Callback::new(|v| set_alerts(json!({ "criticalBytes": to_bytes(v) })))
                        unit="GiB"
                        min=1.0
                    />
                </Row>
                <Row label="Notify only at critical">
                    <Toggle
                        value=critical_only
                        on_change=Callback::new(|v: bool| set_alerts(json!({ "notifyAt": if v { "critical" } else { "warn" } })))
                        label="Notify only at critical"
                    />
                </Row>
            </Section>
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_and_filters() {
        assert_eq!(name_of("tts_cache"), "Speech cache");
        assert_eq!(name_of("some_new"), "some new");
        let v = json!({ "categories": [
            { "id": "logs", "exists": true, "bytes": 10 },
            { "id": "temp", "exists": true, "bytes": 0 },
            { "id": "models", "exists": false, "bytes": 5 },
        ]});
        assert_eq!(cats_of(&v).len(), 1);
        assert_eq!(pct(1.0, 4.0), Some(25.0));
        assert_eq!(pct(1.0, 0.0), None);
    }
}
