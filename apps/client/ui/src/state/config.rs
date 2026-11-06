//! Host config for the settings pages (ui-next `daemon/config.ts`, `settings/pages/kit.tsx`,
//! `host-state.tsx`): the active host's `config.json`, its providers snapshot and status, plus
//! small helpers to call the daemon and read the answer as JSON.
//!
//! Settings read daemon answers as `serde_json::Value` rather than the generated outbound types:
//! these pages touch many optional fields across daemon versions, and a generated struct that
//! rejects one field would blank a whole page.

use std::cell::Cell;
use std::future::Future;

use frogg_client_core::DaemonClient;
use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::{json, Value};

use super::Conn;

/// The daemon's answer to one request, or why there is none.
pub type Answer = Result<Value, String>;

/// `payload.error` as text: a string, or an object with `message`.
pub fn payload_error(v: &Value) -> Option<String> {
    match v.get("error") {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        Some(Value::Object(o)) => Some(
            o.get("message")
                .and_then(Value::as_str)
                .unwrap_or("Request failed")
                .to_owned(),
        ),
        _ => None,
    }
}

/// ui-next `checked`: an `error`, `accepted: false` or `success: false` answer is a failure.
pub fn checked(v: Value) -> Answer {
    if let Some(e) = payload_error(&v) {
        return Err(e);
    }
    if v.get("accepted") == Some(&Value::Bool(false))
        || v.get("success") == Some(&Value::Bool(false))
    {
        return Err("The host did not accept this change.".into());
    }
    Ok(v)
}

/// Sends `req_type` with `fields` and returns the `resp_type` answer's payload.
pub async fn call(
    client: &DaemonClient,
    req_type: &str,
    fields: Value,
    resp_type: &str,
    timeout_ms: Option<u64>,
) -> Answer {
    let frame = client
        .rpc_frame(req_type, fields, resp_type, timeout_ms)
        .await
        .map_err(|e| e.to_string())?;
    let payload: Value = frame.payload().map_err(|e| e.to_string())?;
    checked(payload)
}

/// A namespaced request (`daemon.get_status.request` → `daemon.get_status.response`).
pub async fn ns(client: &DaemonClient, req_type: &str, fields: Value) -> Answer {
    let resp = format!("{}.response", req_type.trim_end_matches(".request"));
    call(client, req_type, fields, &resp, None).await
}

/// The active host's client, or the error a page shows when there is none.
pub fn need() -> Result<DaemonClient, String> {
    super::get()
        .conn
        .client()
        .filter(|c| c.is_connected())
        .ok_or_else(|| "Host offline. Reconnect first.".to_owned())
}

/// `server_info.features.<name>` on the active host; None while it is not online.
pub fn feature(name: &str) -> Option<bool> {
    let app = super::get();
    if app.conn.active_link().conn != Conn::Online {
        return None;
    }
    Some(
        app.conn
            .client()
            .map(|c| c.has_feature(name))
            .unwrap_or(false),
    )
}

/// Whether the active host runs the Companion (ui-next `refreshPluginGate`): its
/// `server_info.capabilities.companion` is present and names no missing plugin. Reactive on the
/// active link, so a reconnect (which re-sends server_info) re-reads it.
pub fn companion_gate() -> bool {
    let app = super::get();
    if app.conn.active_link().conn != Conn::Online {
        return false;
    }
    app.conn
        .client()
        .and_then(|c| c.server_info())
        .is_some_and(|i| companion_capability(&i.raw))
}

/// The gate rule over a raw server_info payload.
pub fn companion_capability(info: &Value) -> bool {
    info.pointer("/capabilities/companion")
        .is_some_and(|cap| cap.is_object() && cap.get("plugin").is_none_or(Value::is_null))
}

/// This device's role on the active host (`callerRole`); None from an older daemon.
pub fn caller_role() -> Option<String> {
    super::get()
        .conn
        .client()
        .and_then(|c| c.server_info())
        .and_then(|i| i.caller_role)
}

/// Owners change host config; an older daemon reports no role and acts as owner.
pub fn is_owner() -> bool {
    caller_role().map(|r| r == "owner").unwrap_or(true)
}

/// The active host's daemon version from its `server_info`.
pub fn host_version() -> Option<String> {
    super::get()
        .conn
        .client()
        .and_then(|c| c.server_info())
        .and_then(|i| i.version_str().map(str::to_owned))
}

/// The active host's config, providers and status, shared by every settings page.
#[derive(Clone, Copy)]
pub struct HostConfig {
    pub config: RwSignal<Option<Value>>,
    pub providers: RwSignal<Option<Value>>,
    pub status: RwSignal<Option<Value>>,
    pub saving: RwSignal<bool>,
    pub error: RwSignal<Option<String>>,
    /// Bumped on every host switch, so a late answer for the previous host is dropped.
    epoch: StoredValue<u64>,
}

thread_local! {
    static STORE: Cell<Option<HostConfig>> = const { Cell::new(None) };
}

/// Builds the store; `state::init` calls it once.
pub fn init() -> HostConfig {
    let store = HostConfig {
        config: RwSignal::new(None),
        providers: RwSignal::new(None),
        status: RwSignal::new(None),
        saving: RwSignal::new(false),
        error: RwSignal::new(None),
        epoch: StoredValue::new(0),
    };
    STORE.with(|s| s.set(Some(store)));
    let app = super::get();
    // A host switch must not show the previous host's settings under the new one.
    Effect::new(move |prev: Option<Option<String>>| {
        let id = app.hosts.active_id.get();
        if prev.is_some() && prev.as_ref() != Some(&id) {
            store.clear();
        }
        id
    });
    store
}

/// The config store. Panics before `init()`.
pub fn get() -> HostConfig {
    STORE
        .with(|s| s.get())
        .expect("state::config::init() runs first")
}

impl HostConfig {
    fn clear(&self) {
        self.epoch.update_value(|e| *e += 1);
        self.config.set(None);
        self.providers.set(None);
        self.status.set(None);
        self.saving.set(false);
        self.error.set(None);
    }

    /// Reads config, providers and status from the active host.
    pub fn load(&self) {
        let Ok(client) = need() else { return };
        let this = *self;
        let epoch = self.epoch.get_value();
        spawn_local(async move {
            let cfg = call(
                &client,
                "get_daemon_config_request",
                json!({}),
                "get_daemon_config_response",
                None,
            )
            .await;
            let providers = call(
                &client,
                "get_providers_snapshot_request",
                json!({}),
                "get_providers_snapshot_response",
                None,
            )
            .await;
            let status = ns(&client, "daemon.get_status.request", json!({}))
                .await
                .ok();
            if this.epoch.get_value() != epoch {
                return;
            }
            match (cfg, providers) {
                (Ok(c), Ok(p)) => {
                    this.config.set(c.get("config").cloned());
                    this.providers.set(Some(p));
                    this.status.set(status);
                    this.error.set(None);
                }
                (Err(e), _) | (_, Err(e)) => this.error.set(Some(e)),
            }
        });
    }

    /// Re-reads only the providers snapshot (while a provider is still probing).
    pub fn load_providers(&self) {
        let Ok(client) = need() else { return };
        let this = *self;
        let epoch = self.epoch.get_value();
        spawn_local(async move {
            let p = call(
                &client,
                "get_providers_snapshot_request",
                json!({}),
                "get_providers_snapshot_response",
                None,
            )
            .await;
            if this.epoch.get_value() == epoch {
                if let Ok(p) = p {
                    this.providers.set(Some(p));
                }
            }
        });
    }

    /// A value in the loaded config by JSON pointer (`/relay/enabled`). Reactive.
    pub fn at(&self, pointer: &str) -> Option<Value> {
        self.config.with(|c| c.as_ref()?.pointer(pointer).cloned())
    }

    pub fn flag(&self, pointer: &str) -> Option<bool> {
        self.at(pointer).and_then(|v| v.as_bool())
    }

    /// Optimistic patch: the page shows the change at once and settles on the daemon's answer;
    /// a failure restores the previous config and shows the error.
    pub fn patch(&self, patch: Value) {
        let client = match need() {
            Ok(c) => c,
            Err(e) => {
                self.error.set(Some(e));
                return;
            }
        };
        let Some(prev) = self.config.get_untracked() else {
            return;
        };
        let mut next = prev.clone();
        merge(&mut next, &patch);
        self.config.set(Some(next));
        self.saving.set(true);
        let this = *self;
        let epoch = self.epoch.get_value();
        spawn_local(async move {
            let res = call(
                &client,
                "set_daemon_config_request",
                json!({ "config": patch }),
                "set_daemon_config_response",
                None,
            )
            .await;
            if this.epoch.get_value() != epoch {
                return;
            }
            match res {
                Ok(v) => {
                    if let Some(c) = v.get("config") {
                        this.config.set(Some(c.clone()));
                    }
                    this.error.set(None);
                }
                Err(e) => {
                    this.config.set(Some(prev));
                    this.error.set(Some(e));
                }
            }
            this.saving.set(false);
        });
    }
}

/// Deep-merges `patch` into `base` (objects merge, everything else replaces).
pub fn merge(base: &mut Value, patch: &Value) {
    match (base, patch) {
        (Value::Object(b), Value::Object(p)) => {
            for (k, v) in p {
                merge(b.entry(k.clone()).or_insert(Value::Null), v);
            }
        }
        (b, p) => *b = p.clone(),
    }
}

/// A daemon read a page owns: data, error and loading, re-run on reconnect, host switch and
/// `reload()` (ui-next `useRpc`). Keeps the last good data while a reload runs.
#[derive(Clone, Copy)]
pub struct Rpc {
    pub data: RwSignal<Option<Value>>,
    pub error: RwSignal<Option<String>>,
    pub loading: RwSignal<bool>,
    tick: RwSignal<u64>,
}

impl Rpc {
    pub fn reload(&self) {
        self.tick.update(|t| *t += 1);
    }
}

/// Runs `load` against the active host whenever it is online (and `enabled`), on reload, and
/// every `poll_ms` when set.
pub fn use_rpc<F, Fut>(load: F, enabled: Signal<bool>, poll_ms: Option<u32>) -> Rpc
where
    F: Fn(DaemonClient) -> Fut + Clone + 'static,
    Fut: Future<Output = Answer> + 'static,
{
    let app = super::get();
    let rpc = Rpc {
        data: RwSignal::new(None),
        error: RwSignal::new(None),
        loading: RwSignal::new(false),
        tick: RwSignal::new(0),
    };
    let alive = StoredValue::new(true);
    on_cleanup(move || {
        let _ = alive.try_set_value(false);
    });
    let load = StoredValue::new_local(load);
    Effect::new(move |prev_host: Option<Option<String>>| {
        let host = app.hosts.active_id.get();
        let online = app.conn.active_link().conn == Conn::Online;
        rpc.tick.track();
        if prev_host.is_some() && prev_host.as_ref() != Some(&host) {
            rpc.data.set(None);
        }
        if !online || !enabled.get() {
            return host;
        }
        let Some(client) = app.conn.client() else {
            return host;
        };
        rpc.loading.set(true);
        let f = load.with_value(|l| l.clone());
        let tick = rpc.tick.get_untracked();
        spawn_local(async move {
            let res = f(client).await;
            // The owner may be gone (page left mid-request): its values are disposed then.
            if !alive.try_get_value().unwrap_or(false) || rpc.tick.try_get_untracked() != Some(tick)
            {
                return;
            }
            match res {
                Ok(v) => {
                    rpc.data.set(Some(v));
                    rpc.error.set(None);
                }
                Err(e) => rpc.error.set(Some(e)),
            }
            rpc.loading.set(false);
        });
        host
    });
    if let Some(ms) = poll_ms {
        if let Ok(h) = set_interval_with_handle(
            move || {
                if alive.try_get_value().unwrap_or(false) {
                    rpc.reload();
                }
            },
            std::time::Duration::from_millis(ms as u64),
        ) {
            on_cleanup(move || h.clear());
        }
    }
    rpc
}

/// One fallible action at a time with pending and error state (ui-next `useAction`).
#[derive(Clone, Copy)]
pub struct Action {
    pub pending: RwSignal<Option<&'static str>>,
    pub error: RwSignal<Option<String>>,
}

impl Action {
    pub fn new() -> Self {
        Self {
            pending: RwSignal::new(None),
            error: RwSignal::new(None),
        }
    }

    pub fn busy(&self) -> bool {
        self.pending.get().is_some()
    }

    /// Runs `fut` (skipped while another runs); `done` gets the answer on success.
    pub fn run<Fut>(&self, key: &'static str, fut: Fut, done: impl FnOnce(Value) + 'static)
    where
        Fut: Future<Output = Answer> + 'static,
    {
        if self.pending.get_untracked().is_some() {
            return;
        }
        self.pending.set(Some(key));
        self.error.set(None);
        let this = *self;
        spawn_local(async move {
            let res = fut.await;
            this.pending.set(None);
            match res {
                Ok(v) => done(v),
                Err(e) => this.error.set(Some(e)),
            }
        });
    }
}

impl Default for Action {
    fn default() -> Self {
        Self::new()
    }
}

/// "3m ago" from an ISO timestamp (ui-next `agoText`).
pub fn ago(iso: &str) -> String {
    let then = js_sys::Date::parse(iso);
    if !then.is_finite() {
        return iso.to_owned();
    }
    ago_ms(js_sys::Date::now() - then)
}

pub fn ago_ms(ms: f64) -> String {
    let s = (ms / 1000.0).max(0.0) as u64;
    match s {
        0..=44 => "just now".into(),
        45..=3599 => format!("{}m ago", (s / 60).max(1)),
        3600..=86_399 => format!("{}h ago", s / 3600),
        _ => format!("{}d ago", s / 86_400),
    }
}

pub fn fmt_bytes(n: f64) -> String {
    if !n.is_finite() {
        return "—".into();
    }
    let units = ["B", "KiB", "MiB", "GiB", "TiB"];
    let mut v = n;
    let mut i = 0;
    while v >= 1024.0 && i < units.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if v >= 100.0 || i == 0 {
        format!("{} {}", v.round(), units[i])
    } else {
        format!("{v:.1} {}", units[i])
    }
}

pub fn fmt_uptime(sec: u64) -> String {
    let d = sec / 86_400;
    let h = (sec % 86_400) / 3600;
    let m = (sec % 3600) / 60;
    if d > 0 {
        format!("{d}d {h}h")
    } else if h > 0 {
        format!("{h}h {m}m")
    } else {
        format!("{m}m")
    }
}

/// Text of a JSON field, or "".
pub fn s(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

/// Display names of the providers Frogg knows.
pub fn provider_label(id: &str) -> String {
    match id {
        "claude" => "Claude Code".into(),
        "codex" => "Codex".into(),
        "copilot" => "Copilot".into(),
        "opencode" => "OpenCode".into(),
        "gemini" => "Gemini".into(),
        other => other.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_nested() {
        let mut a = json!({ "relay": { "enabled": true, "endpoint": "x" }, "n": 1 });
        merge(&mut a, &json!({ "relay": { "enabled": false }, "n": 2 }));
        assert_eq!(
            a,
            json!({ "relay": { "enabled": false, "endpoint": "x" }, "n": 2 })
        );
    }

    #[test]
    fn companion_gate_rule() {
        assert!(!companion_capability(&json!({})));
        assert!(companion_capability(
            &json!({ "capabilities": { "companion": { "enabled": true } } })
        ));
        assert!(!companion_capability(&json!({
            "capabilities": { "companion": { "enabled": false, "plugin": { "id": "frogg.companion" } } }
        })));
    }

    #[test]
    fn checks_errors() {
        assert!(checked(json!({ "error": "nope" })).is_err());
        assert!(checked(json!({ "error": { "message": "m" } })).is_err());
        assert!(checked(json!({ "accepted": false })).is_err());
        assert!(checked(json!({ "error": null, "ok": 1 })).is_ok());
    }

    #[test]
    fn formats() {
        assert_eq!(fmt_bytes(512.0), "512 B");
        assert_eq!(fmt_bytes(1536.0), "1.5 KiB");
        assert_eq!(fmt_uptime(90_000), "1d 1h");
        assert_eq!(ago_ms(120_000.0), "2m ago");
    }
}
