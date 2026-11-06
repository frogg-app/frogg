//! "Agents" pages (ui-next `Providers.tsx`, `Accounts.tsx`, `PermissionModes.tsx`,
//! `UsageLimits.tsx`): what the host can run and as whom.

use frogg_client_core::DaemonClient;
use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::{json, Value};

use crate::components::{Button, ButtonKind, Ico, Icon, Seg, Select, SelectOption};
use crate::state::config::{self, call, ns, provider_label, s, Action};
use crate::state::hosts::Host;
use crate::state::signin::{open_sign_in, SignInTarget};
use crate::state::Conn;
use crate::views::settings::kit::*;

fn status_tint(st: &str) -> &'static str {
    match st {
        "ready" => "mint",
        "error" | "unavailable" => "coral",
        _ => "amber",
    }
}

fn tokens(n: f64) -> String {
    if n >= 1_000_000.0 {
        format!("{}M", n / 1_000_000.0)
    } else {
        format!("{}k", (n / 1000.0).round())
    }
}

fn entries(v: &Option<Value>) -> Vec<Value> {
    v.as_ref()
        .and_then(|p| p.get("entries"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

#[component]
pub fn Providers() -> impl IntoView {
    let cfg = config::get();
    let open = RwSignal::new(None::<String>);
    // Re-read while a provider is still probing its CLI.
    Effect::new(move |_| {
        let probing = cfg
            .providers
            .with(|p| entries(p).iter().any(|e| s(e, "status") == "loading"));
        if probing {
            set_timeout(
                move || cfg.load_providers(),
                std::time::Duration::from_millis(2500),
            );
        }
    });
    let owner = config::is_owner();
    view! {
        {move || {
            let list = cfg.providers.with(entries);
            if cfg.providers.with(Option::is_none) {
                return view! { <span class="t-label">"loading…"</span> }.into_any();
            }
            view! {
                <Section title="Installed providers">
                    {list.into_iter().map(|e| view! { <ProviderRow entry=e open=open can_edit=owner /> }).collect_view()}
                </Section>
            }
            .into_any()
        }}
        <Note>
            {if owner {
                "A provider that is off stays installed but can't start new agents on this host."
            } else {
                "Only the host's owner can turn providers on or off."
            }}
        </Note>
    }
}

#[component]
fn ProviderRow(entry: Value, open: RwSignal<Option<String>>, can_edit: bool) -> impl IntoView {
    let cfg = config::get();
    let id = s(&entry, "provider");
    let label = entry
        .get("label")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| provider_label(&id));
    let enabled = entry
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let status = s(&entry, "status");
    let error = entry
        .get("error")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let snap_models = entry
        .get("models")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let fresh = RwSignal::new(None::<Vec<Value>>);
    let loading = RwSignal::new(false);
    let models_err = RwSignal::new(None::<String>);
    let busy = RwSignal::new(false);
    let id_s = StoredValue::new(id.clone());
    let is_open = Memo::new(move |_| open.get().as_deref() == Some(id_s.get_value().as_str()));
    // Opening a provider asks it for the full, current list.
    Effect::new(move |_| {
        if !is_open.get() || fresh.get_untracked().is_some() || loading.get_untracked() {
            return;
        }
        let Ok(c) = config::need() else { return };
        loading.set(true);
        let pid = id_s.get_value();
        spawn_local(async move {
            match call(
                &c,
                "list_provider_models_request",
                json!({ "provider": pid }),
                "list_provider_models_response",
                Some(90_000),
            )
            .await
            {
                Ok(v) => fresh.set(Some(
                    v.get("models")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default(),
                )),
                Err(e) => models_err.set(Some(e)),
            }
            loading.set(false);
        });
    });
    let count = snap_models.len();
    let fetched = entry
        .get("fetchedAt")
        .and_then(Value::as_str)
        .map(config::ago);
    let hint = error.clone().unwrap_or_else(|| {
        format!(
            "{count} model{}{}",
            if count == 1 { "" } else { "s" },
            fetched
                .map(|f| format!(" · checked {f}"))
                .unwrap_or_default()
        )
    });
    let snap = StoredValue::new(snap_models);
    let set_enabled = Callback::new(move |on: bool| {
        let pid = id_s.get_value();
        busy.set(true);
        cfg.patch(json!({ "providers": { pid.clone(): { "enabled": on } } }));
        spawn_local(async move {
            if on {
                if let Ok(c) = config::need() {
                    let _ = call(
                        &c,
                        "refresh_providers_snapshot_request",
                        json!({ "providers": [pid] }),
                        "refresh_providers_snapshot_response",
                        Some(120_000),
                    )
                    .await;
                }
            }
            cfg.load();
            busy.set(false);
        });
    });
    let label2 = label.clone();
    view! {
        <div class="prov">
            <div class="prov-head">
                <button
                    class="prov-row"
                    aria-expanded=move || is_open.get().to_string()
                    aria-label=format!("Show {label2} models")
                    on:click=move |_| {
                        let me = id_s.get_value();
                        open.update(|o| *o = if o.as_deref() == Some(me.as_str()) { None } else { Some(me) });
                    }
                >
                    <span class="chev" class:open=move || is_open.get()><Icon ico=Ico::ChevronRight size=13.0 /></span>
                    <span class="prov-text">
                        <span class="set-row-label">{label.clone()}</span>
                        <span class="set-row-hint" class:bad=error.is_some()>{hint}</span>
                    </span>
                    {if enabled {
                        view! { <Pill text=status.clone() tint=status_tint(&status) /> }.into_any()
                    } else {
                        view! { <Pill text="off" /> }.into_any()
                    }}
                </button>
                <span class="prov-switch">
                    <Toggle
                        value=enabled
                        on_change=set_enabled
                        disabled=Signal::derive(move || !can_edit || busy.get())
                        label=format!("{} {label}", if enabled { "Turn off" } else { "Turn on" })
                    />
                </span>
            </div>
            <Show when=move || is_open.get()>
                <div class="prov-models m-enter">
                    {move || {
                        let list = fresh.get().unwrap_or_else(|| snap.get_value());
                        let empty = list.is_empty();
                        view! {
                            {list.into_iter().map(|m| view! { <ModelRow m=m /> }).collect_view()}
                            {(empty && !loading.get()).then(|| view! { <span class="set-row-hint">"This provider reports no models."</span> })}
                            {loading.get().then(|| view! { <span class="set-row-hint">"Asking the provider for its full list…"</span> })}
                            {move || models_err.get().filter(|_| empty).map(|e| view! { <span class="set-err t-mono">{e}</span> })}
                        }
                    }}
                </div>
            </Show>
        </div>
    }
}

#[component]
fn ModelRow(m: Value) -> impl IntoView {
    let label = m
        .get("label")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| s(&m, "id"));
    let hidden = m.get("isSelectable") == Some(&Value::Bool(false));
    let default = m.get("isDefault") == Some(&Value::Bool(true));
    let ctx = m.get("contextWindowMaxTokens").and_then(Value::as_f64);
    view! {
        <div class="model">
            <div class="model-text">
                <span class="model-head">
                    <span class:muted=hidden>{label}</span>
                    {default.then(|| view! { <Pill text="default" tint="cyan2" /> })}
                    {hidden.then(|| view! { <Pill text="hidden" /> })}
                </span>
                {m.get("description").and_then(Value::as_str).map(|d| view! { <span class="set-row-hint clamp2">{d.to_owned()}</span> })}
            </div>
            {ctx.map(|c| view! { <span class="t-mono faint">{format!("{} ctx", tokens(c))}</span> })}
            <span class="t-mono model-id">{s(&m, "id")}</span>
        </div>
    }
}

// ----- accounts -------------------------------------------------------------------------------

const SWATCH: [&str; 5] = ["cyan", "violet", "mint", "amber", "coral"];

/// Accounts plus each account's usage windows (cached figures; a forced read per account trips
/// the provider's rate limit).
async fn load_accounts(c: DaemonClient) -> config::Answer {
    let list = ns(&c, "provider.account.list.request", json!({})).await?;
    let mut usage = serde_json::Map::new();
    for a in list
        .get("accounts")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        let fields = json!({ "provider": s(&a, "provider"), "providerAccountId": s(&a, "id"), "maxAgeMs": 300_000 });
        if let Ok(u) = ns(&c, "provider.usage.list.request", fields).await {
            let p = s(&a, "provider");
            let arr = u
                .get("providers")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let pick = arr
                .iter()
                .find(|x| s(x, "providerId") == p)
                .or(arr.first())
                .cloned();
            if let Some(pick) = pick {
                usage.insert(s(&a, "id"), pick);
            }
        }
    }
    Ok(json!({ "list": list, "usage": usage }))
}

#[component]
pub fn Accounts() -> impl IntoView {
    let app = crate::state::get();
    let ordered = Memo::new(move |_| {
        let active = app.hosts.active_id.get();
        let mut hs = app.hosts.hosts.get();
        hs.sort_by_key(|h| Some(&h.id) != active.as_ref());
        hs
    });
    move || {
        let hs = ordered.get();
        let named = hs.len() > 1;
        hs.into_iter()
            .map(|h| view! { <HostAccounts host=h named=named /> })
            .collect_view()
    }
}

/// Export a host's provider accounts as a JSON bundle, or import one exported elsewhere
/// (ui-next `Accounts.tsx` `Transfer`). Import never overwrites an existing account.
#[component]
fn Transfer(host_id: String, providers: Vec<String>, reload: Callback<()>) -> impl IntoView {
    let app = crate::state::get();
    let hid = StoredValue::new(host_id);
    let providers = StoredValue::new(providers);
    let exported = RwSignal::new(None::<String>);
    let paste = RwSignal::new(None::<String>);
    let note = RwSignal::new(None::<String>);
    let act = Action::new();
    let client = move || {
        app.conn
            .client_of(&hid.get_value())
            .ok_or_else(|| "This host is offline.".to_owned())
    };
    let export = Callback::new(move |_| {
        note.set(None);
        let ps = providers.get_value();
        act.run(
            "export",
            async move {
                let c = client()?;
                let mut bundles = Vec::new();
                for p in ps {
                    let v = ns(
                        &c,
                        "provider.account.export.request",
                        json!({ "provider": p }),
                    )
                    .await?;
                    if let Some(e) = v.get("error").and_then(Value::as_str) {
                        return Err(e.to_owned());
                    }
                    if let Some(b) = v.get("bundle").filter(|b| !b.is_null()) {
                        bundles.push(b.clone());
                    }
                }
                Ok(if bundles.len() == 1 {
                    bundles.remove(0)
                } else {
                    Value::Array(bundles)
                })
            },
            move |v| exported.set(serde_json::to_string_pretty(&v).ok()),
        );
    });
    let import = Callback::new(move |_| {
        note.set(None);
        let parsed: Value = match serde_json::from_str(&paste.get_untracked().unwrap_or_default()) {
            Ok(v) => v,
            Err(_) => {
                note.set(Some("That is not valid JSON.".into()));
                return;
            }
        };
        let list = match parsed {
            Value::Array(a) => a,
            v => vec![v],
        };
        let n = list.len();
        act.run(
            "import",
            async move {
                let c = client()?;
                for bundle in list {
                    let v = ns(
                        &c,
                        "provider.account.import.request",
                        json!({ "bundle": bundle }),
                    )
                    .await?;
                    if let Some(e) = v.get("error").and_then(Value::as_str) {
                        return Err(e.to_owned());
                    }
                }
                Ok(Value::Null)
            },
            move |_| {
                paste.set(None);
                note.set(Some(format!(
                    "Imported {n} bundle{}.",
                    if n == 1 { "" } else { "s" }
                )));
                reload.run(());
            },
        );
    });
    let pending = move |k: &'static str| act.pending.get() == Some(k);
    view! {
        <Section title="Move accounts between hosts">
            <Row label="Export bundle" hint="Contains credentials in plain text">
                {move || if exported.get().is_none() {
                    view! {
                        <Button
                            label=Signal::derive(move || if pending("export") { "Exporting…".to_owned() } else { "Export…".to_owned() })
                            disabled=Signal::derive(move || providers.with_value(Vec::is_empty) || act.busy())
                            on_press=export
                        />
                    }.into_any()
                } else {
                    view! { <Button label="Hide" on_press=Callback::new(move |_| exported.set(None)) /> }.into_any()
                }}
            </Row>
            {move || exported.get().map(|t| view! {
                <Block>
                    <textarea class="set-area tall t-mono" prop:value=t on:input=move |ev| exported.set(Some(event_target_value(&ev)))></textarea>
                </Block>
            })}
            <Row label="Import bundle">
                {move || paste.get().is_none().then(|| view! { <Button label="Paste JSON…" on_press=Callback::new(move |_| paste.set(Some(String::new()))) /> })}
            </Row>
            {move || paste.get().is_some().then(|| view! {
                <Block>
                    <textarea
                        class="set-area t-mono"
                        placeholder="Paste an exported bundle"
                        prop:value=move || paste.get().unwrap_or_default()
                        on:input=move |ev| paste.set(Some(event_target_value(&ev)))
                    ></textarea>
                    <Acts>
                        <Button label="Cancel" on_press=Callback::new(move |_| paste.set(None)) />
                        <Button
                            kind=ButtonKind::Primary
                            label=Signal::derive(move || if pending("import") { "Importing…".to_owned() } else { "Import".to_owned() })
                            disabled=Signal::derive(move || paste.get().unwrap_or_default().trim().is_empty() || act.busy())
                            on_press=import
                        />
                    </Acts>
                </Block>
            })}
            <ErrorLine text=Signal::derive(move || act.error.get().or_else(|| note.get())) />
        </Section>
    }
}

#[component]
fn HostAccounts(host: Host, named: bool) -> impl IntoView {
    let app = crate::state::get();
    let hid = StoredValue::new(host.id.clone());
    let conn = Memo::new(move |_| app.conn.link(&hid.get_value()).conn);
    let data = RwSignal::new(None::<Value>);
    let error = RwSignal::new(None::<String>);
    let tick = RwSignal::new(0u32);
    let alive = StoredValue::new(true);
    on_cleanup(move || {
        let _ = alive.try_set_value(false);
    });
    Effect::new(move |_| {
        tick.track();
        if conn.get() != Conn::Online {
            return;
        }
        let Some(c) = app.conn.client_of(&hid.get_value()) else {
            return;
        };
        spawn_local(async move {
            let r = load_accounts(c).await;
            if !alive.try_get_value().unwrap_or(false) {
                return;
            }
            match r {
                Ok(v) => {
                    data.set(Some(v));
                    error.set(None);
                }
                Err(e) => error.set(Some(e)),
            }
        });
    });
    let reload = Callback::new(move |_| tick.update(|t| *t += 1));
    let name = host.name.clone();
    view! {
        {named.then(|| view! {
            <div class="acct-host">
                <span class="t-label">{name}</span>
                <span class="t-mono faint">
                    {move || match conn.get() {
                        Conn::Online => "connected",
                        Conn::Connecting => "connecting…",
                        Conn::Offline => "offline",
                    }}
                </span>
            </div>
        })}
        {move || {
            if conn.get() != Conn::Online {
                let t = if conn.get() == Conn::Connecting { "Connecting…" } else { "Offline; its accounts show once it is back." };
                return view! { <p class="set-note top">{t}</p> }.into_any();
            }
            if let Some(e) = error.get() {
                return view! {
                    <div class="set-status">
                        <span class="set-status-err">{format!("Couldn’t load accounts: {e}")}</span>
                        <Button label="Retry" on_press=reload />
                    </div>
                }
                .into_any();
            }
            let Some(d) = data.get() else {
                return view! { <div class="set-status"><span class="t-label">"loading accounts…"</span></div> }.into_any();
            };
            let accounts = d.pointer("/list/accounts").and_then(Value::as_array).cloned().unwrap_or_default();
            let mut groups: Vec<(String, Vec<Value>)> = Vec::new();
            for a in accounts {
                let p = s(&a, "provider");
                match groups.iter_mut().find(|g| g.0 == p) {
                    Some(g) => g.1.push(a),
                    None => groups.push((p, vec![a])),
                }
            }
            let rest: Vec<String> = d
                .pointer("/list/capabilities")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|c| s(c, "provider"))
                .filter(|p| !groups.iter().any(|g| &g.0 == p))
                .collect();
            let usage = d.get("usage").cloned().unwrap_or(Value::Null);
            let hid = hid.get_value();
            let all: Vec<String> = groups.iter().map(|g| g.0.clone()).collect();
            let hid_t = hid.clone();
            view! {
                {groups
                    .into_iter()
                    .enumerate()
                    .map(|(i, (prov, accts))| {
                        let tint = SWATCH[i % SWATCH.len()];
                        let hid2 = hid.clone();
                        let hid = hid.clone();
                        let usage = usage.clone();
                        view! {
                            <Section title=provider_label(&prov)>
                                {accts
                                    .into_iter()
                                    .map(|a| {
                                        let u = usage.get(s(&a, "id")).cloned();
                                        view! { <AccountRow host_id=hid.clone() account=a usage=u tint=tint reload=reload /> }
                                    })
                                    .collect_view()}
                                <AddAccount host_id=hid2 provider=prov reload=reload />
                            </Section>
                        }
                    })
                    .collect_view()}
                {(!rest.is_empty()).then(|| view! {
                    <Section title="Other providers">
                        {rest.into_iter().map(|p| view! { <AddAccount host_id=hid.clone() provider=p reload=reload /> }).collect_view()}
                    </Section>
                })}
                <Transfer host_id=hid_t providers=all reload=reload />
            }
            .into_any()
        }}
    }
}

fn client_of(host_id: &str) -> Result<DaemonClient, String> {
    crate::state::get()
        .conn
        .client_of(host_id)
        .filter(|c| c.is_connected())
        .ok_or_else(|| "host offline".to_owned())
}

#[component]
fn AccountRow(
    host_id: String,
    account: Value,
    usage: Option<Value>,
    tint: &'static str,
    reload: Callback<()>,
) -> impl IntoView {
    let open = RwSignal::new(false);
    let act = Action::new();
    let id = s(&account, "id");
    let provider = s(&account, "provider");
    let authed = account.get("authenticated") == Some(&Value::Bool(true));
    let active = account.get("isActive") == Some(&Value::Bool(true));
    let u = usage.clone().unwrap_or(Value::Null);
    let sub = [
        u.get("accountEmail")
            .and_then(Value::as_str)
            .map(str::to_owned),
        u.get("planLabel")
            .and_then(Value::as_str)
            .map(str::to_owned),
        account
            .get("configDir")
            .and_then(Value::as_str)
            .map(str::to_owned),
        Some(if authed {
            "signed in".to_owned()
        } else {
            "signed out".to_owned()
        }),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" · ");
    let windows: Vec<Value> = u
        .get("windows")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .take(2)
        .collect();
    let ctx = StoredValue::new((host_id, id, provider));
    let rpc = move |key: &'static str, req: &'static str, fields: Value| {
        let (h, _, _) = ctx.get_value();
        act.run(
            key,
            async move {
                let c = client_of(&h)?;
                ns(&c, req, fields).await
            },
            move |_| reload.run(()),
        );
    };
    let sign_in = Callback::new(move |_| {
        let (h, id, p) = ctx.get_value();
        open_sign_in(SignInTarget {
            host_id: Some(h),
            provider: p,
            account_id: Some(id),
            account_name: None,
        });
    });
    view! {
        <div class="acct">
            <div class="acct-row">
                <span class="acct-sw" style=format!("background:var(--{tint})")></span>
                <div class="acct-text">
                    <span class="acct-name">
                        {s(&account, "name")}
                        {active.then(|| view! { <Pill text="default" /> })}
                    </span>
                    <span class="set-row-hint ellipsis">{sub}</span>
                </div>
                {(!windows.is_empty()).then(|| view! {
                    <div class="acct-windows">
                        {windows.into_iter().map(|w| {
                            let pct = w.get("usedPct").and_then(Value::as_f64);
                            view! {
                                <span class="acct-window">
                                    <span class="t-label">{s(&w, "label")}</span>
                                    <Meter pct=pct />
                                </span>
                            }
                        }).collect_view()}
                    </div>
                })}
                {(!authed).then(|| view! { <Button kind=ButtonKind::Primary label="Sign in" on_press=sign_in /> })}
                <Button label=Signal::derive(move || if open.get() { "Done".to_owned() } else { "Manage".to_owned() }) on_press=Callback::new(move |_| open.update(|o| *o = !*o)) />
            </div>
            <Show when=move || open.get()>
                <div class="acct-manage m-enter">
                    <ErrorLine text=act.error />
                    <Acts>
                        {(!active).then(|| view! {
                            <Button
                                label="Make default"
                                disabled=Signal::derive(move || act.busy())
                                on_press=Callback::new(move |_| {
                                    let (_, id, p) = ctx.get_value();
                                    rpc("default", "provider.account.set_active.request", json!({ "provider": p, "accountId": id }));
                                })
                            />
                        })}
                        {authed.then(|| view! { <Button label="Sign in again" on_press=sign_in /> })}
                        {authed.then(|| view! {
                            <Confirm
                                label="Sign out"
                                confirm="Sign out"
                                pending=Signal::derive(move || act.pending.get() == Some("signout"))
                                on_confirm=Callback::new(move |_| {
                                    let (_, id, _) = ctx.get_value();
                                    rpc("signout", "provider.account.sign_out.request", json!({ "accountId": id }));
                                })
                            />
                        })}
                        <Confirm
                            label="Remove"
                            confirm="Remove account"
                            pending=Signal::derive(move || act.pending.get() == Some("delete"))
                            on_confirm=Callback::new(move |_| {
                                let (_, id, _) = ctx.get_value();
                                rpc("delete", "provider.account.delete.request", json!({ "accountId": id }));
                            })
                        />
                    </Acts>
                </div>
            </Show>
        </div>
    }
}

#[component]
fn AddAccount(host_id: String, provider: String, reload: Callback<()>) -> impl IntoView {
    let adding = RwSignal::new(false);
    let name = RwSignal::new(String::new());
    let act = Action::new();
    let ctx = StoredValue::new((host_id, provider.clone()));
    let label = provider_label(&provider);
    let create = Callback::new(move |_| {
        let n = name.get_untracked().trim().to_owned();
        if n.is_empty() {
            return;
        }
        let (h, p) = ctx.get_value();
        act.run(
            "create",
            async move {
                let c = client_of(&h)?;
                ns(
                    &c,
                    "provider.account.create.request",
                    json!({ "provider": p, "name": n }),
                )
                .await
            },
            move |_| {
                adding.set(false);
                name.set(String::new());
                reload.run(());
            },
        );
    });
    view! {
        <div class="acct-add">
            {move || if adding.get() {
                view! {
                    <div class="set-acts grow">
                        <Input value=name placeholder="Account name, e.g. work" grow=true autofocus=true on_enter=create />
                        <Button label="Cancel" on_press=Callback::new(move |_| adding.set(false)) />
                        <Button kind=ButtonKind::Primary label="Add" disabled=Signal::derive(move || act.busy()) on_press=create />
                    </div>
                }.into_any()
            } else {
                let label = label.clone();
                view! {
                    <button class="acct-add-btn" on:click=move |_| adding.set(true)>
                        <Icon ico=Ico::Plus size=13.0 class="cyan2" />
                        <span>{format!("Add a {label} account")}</span>
                    </button>
                }.into_any()
            }}
            <ErrorLine text=act.error />
        </div>
    }
}

// ----- permission modes -----------------------------------------------------------------------

const PROVIDERS: [&str; 4] = ["Claude Code", "Codex", "Copilot", "OpenCode"];

const MODES: &[(&str, &str, [&str; 4])] = &[
    (
        "Plan",
        "Read and propose; nothing changes until you approve the plan",
        ["Plan Mode", "Plan feature", "Plan", "Plan"],
    ),
    (
        "Ask",
        "Ask before every edit and command",
        ["Always Ask", "Default Permissions", "Agent", "—"],
    ),
    (
        "Auto-edit",
        "Edit files freely, ask before commands",
        ["Accept File Edits", "Auto-review", "—", "Build"],
    ),
    (
        "Auto",
        "Provider decides what is safe; asks for risky actions",
        ["Auto mode", "—", "—", "—"],
    ),
    (
        "Unattended",
        "Never asks. Use in sandboxes and throwaway worktrees",
        ["Bypass", "Full Access", "Allow All", "—"],
    ),
];

#[component]
pub fn PermissionModes() -> impl IntoView {
    let prefs = crate::state::get().prefs;
    let start = move || {
        let mut o = vec![
            ("plan", "Plan"),
            ("ask", "Ask"),
            ("edits", "Auto-edit"),
            ("auto", "Auto"),
        ];
        if prefs.flag("allowUnattended") {
            o.push(("unattended", "Unattended"));
        }
        opts(&o)
    };
    view! {
        <Lede>"One vocabulary across providers. Each mode maps to the provider’s own name; providers that lack a level skip it in the picker."</Lede>
        <Section title="Modes">
            <div class="set-table-wrap">
                <table class="set-table modes">
                    <thead>
                        <tr>
                            <th class="t-label">"Mode"</th>
                            {PROVIDERS.iter().map(|p| view! { <th class="t-label">{*p}</th> }).collect_view()}
                        </tr>
                    </thead>
                    <tbody>
                        {MODES.iter().map(|(name, desc, map)| view! {
                            <tr>
                                <td class="mode-cell">
                                    <span class="set-row-label">{*name}</span>
                                    <span class="set-row-hint">{*desc}</span>
                                </td>
                                {map.iter().map(|v| view! { <td class="t-mono" class:faint=*v == "—">{*v}</td> }).collect_view()}
                            </tr>
                        }).collect_view()}
                    </tbody>
                </table>
            </div>
        </Section>
        <Section title="Defaults">
            <Row label="New sessions start in">
                {move || view! {
                    <Seg
                        options=start()
                        value=Signal::derive(move || prefs.text("defaultMode"))
                        on_change=Callback::new(move |v: String| prefs.set("defaultMode", v))
                    />
                }}
            </Row>
            <Row label="Allow Unattended" hint="Off hides it from the picker on every client"><PrefToggle key="allowUnattended" /></Row>
            <Row label="Unattended only in worktrees" hint="Never on Local isolation">
                <PrefToggle key="unattendedWorktreesOnly" disabled=Signal::derive(move || !prefs.flag("allowUnattended")) />
            </Row>
            <Row label="⇧Tab cycles"><PrefSeg key="shiftTab" options=&[("safe", "Plan → Ask → Auto-edit"), ("all", "All modes")] /></Row>
        </Section>
    }
}

// ----- usage ----------------------------------------------------------------------------------

/// Plan usage per provider account on the active host, and the meter prefs.
#[component]
pub fn UsageLimits() -> impl IntoView {
    let prefs = crate::state::get().prefs;
    let usage = config::use_rpc(
        |c: DaemonClient| async move {
            ns(
                &c,
                "provider.usage.list.request",
                json!({ "maxAgeMs": 300_000 }),
            )
            .await
        },
        Signal::derive(|| true),
        None,
    );
    let num = move |k: &'static str| {
        Signal::derive(move || prefs.all.with(|m| m.get(k).and_then(Value::as_f64)))
    };
    let set_num = move |k: &'static str| {
        Callback::new(move |v: Option<f64>| {
            if let Some(v) = v {
                prefs.set(k, v);
            }
        })
    };
    view! {
        <Section title="Plan usage">
            <RpcStatus rpc=usage what="usage">
                {move || {
                    let list = usage.data.get().and_then(|d| d.get("providers").and_then(Value::as_array).cloned()).unwrap_or_default();
                    if list.is_empty() {
                        return view! { <Block><span class="set-row-hint">"No provider reports plan usage on this host."</span></Block> }.into_any();
                    }
                    list.into_iter().map(|p| {
                        let title = provider_label(&s(&p, "providerId"));
                        let sub = [s(&p, "accountEmail"), s(&p, "planLabel")].into_iter().filter(|x| !x.is_empty()).collect::<Vec<_>>().join(" · ");
                        let windows = p.get("windows").and_then(Value::as_array).cloned().unwrap_or_default();
                        view! {
                            <Item title=title sub=sub>
                                {windows.into_iter().take(3).map(|w| view! {
                                    <span class="acct-window">
                                        <span class="t-label">{s(&w, "label")}</span>
                                        <Meter pct=w.get("usedPct").and_then(Value::as_f64) />
                                    </span>
                                }).collect_view()}
                            </Item>
                        }
                    }).collect_view().into_any()
                }}
            </RpcStatus>
        </Section>
        <Section title="Meters">
            <Row label="Refresh on a timer" hint="The usage endpoint rate-limits; Frogg backs off on its own when it does">
                <PrefToggle key="meterTimer" />
                <NumField value=num("meterSeconds") on_change=set_num("meterSeconds") unit="s" min=30.0 max=3600.0 />
            </Row>
            <Row label="Refresh on hover" hint="Pointer over the usage panel"><PrefToggle key="meterHover" /></Row>
            <Row label="Refresh after a reply" hint="When a session finishes a turn"><PrefToggle key="meterAfterReply" /></Row>
            <Row label="Warning at"><NumField value=num("warnPct") on_change=set_num("warnPct") unit="%" min=1.0 max=100.0 /></Row>
            <Row label="Critical at"><NumField value=num("criticalPct") on_change=set_num("criticalPct") unit="%" min=1.0 max=100.0 /></Row>
            <Row label="Animate changes"><PrefToggle key="meterAnimate" /></Row>
        </Section>
        <Note>"Device settings for the rings in the composer and status bar"</Note>
        <LimitHit usage=usage />
    }
}

/// "When a limit is hit": the host's auto-resume, the composer countdown, account switching.
#[component]
fn LimitHit(usage: config::Rpc) -> impl IntoView {
    let app = crate::state::get();
    let prefs = app.prefs;
    let cfg = config::get();
    let host = Signal::derive(move || {
        app.conn
            .active_link()
            .server_name
            .unwrap_or_else(|| "host".to_owned())
    });
    // Providers with more than one account reporting usage can suggest a switch.
    let multi = Signal::derive(move || {
        let list = usage
            .data
            .get()
            .and_then(|d| d.get("providers").and_then(Value::as_array).cloned())
            .unwrap_or_default();
        let mut names: Vec<String> = Vec::new();
        for p in &list {
            let id = s(p, "providerId");
            let n = list.iter().filter(|q| s(q, "providerId") == id).count();
            let label = provider_label(&id);
            if n > 1 && !names.contains(&label) {
                names.push(label);
            }
        }
        names
    });
    let countdown = vec![
        SelectOption::new("reset", "Immediately at reset"),
        SelectOption::new("1m", "1 minute after reset"),
        SelectOption::new("5m", "5 minutes after reset"),
        SelectOption::new("off", "No countdown"),
    ];
    view! {
        <Section title="When a limit is hit">
            <Row label="Resume after the window resets" hint=host>
                {move || match cfg.flag("/autoResumeOnUsageLimit") {
                    // COMPAT: daemons before autoResumeOnUsageLimit omit the key.
                    None => view! { <Pill text="needs a newer daemon" /> }.into_any(),
                    Some(_) => view! {
                        <Toggle
                            value=Signal::derive(move || cfg.flag("/autoResumeOnUsageLimit").unwrap_or(false))
                            on_change=Callback::new(move |v: bool| cfg.patch(json!({ "autoResumeOnUsageLimit": v })))
                            label="Resume after the window resets"
                        />
                    }.into_any(),
                }}
            </Row>
            <Row label="Auto-resume countdown" hint="Shown in the composer; cancel any time">
                <Select
                    options=countdown
                    value=Signal::derive(move || prefs.text("resumeCountdown"))
                    on_change=Callback::new(move |v: String| prefs.set("resumeCountdown", v))
                />
            </Row>
            <Row
                label="Suggest moving to another account"
                hint=Signal::derive(move || {
                    let m = multi.get();
                    if m.is_empty() {
                        "Needs a second account on the same provider".to_owned()
                    } else {
                        format!("Offers the {} account with headroom", m.join(" or "))
                    }
                })
            >
                <PrefToggle key="suggestSwitch" />
            </Row>
        </Section>
    }
}
