//! "Host" pages (ui-next `HostOverview.tsx`, `DevicesAccess.tsx`, the Automation page,
//! `DaemonUpdates.tsx`, and `hosts/HostUpdate.tsx` which the Hosts tool reuses).

use frogg_client_core::DaemonClient;
use leptos::prelude::*;
use serde_json::{json, Value};

use crate::components::{Button, ButtonKind, Ico, Seg, Select, SelectOption};
use crate::state::config::{self, ago, fmt_bytes, need, ns, s, Action};
use crate::views::panels::hosts::access::{pairing_error_text, registered_via};
use crate::views::panels::hosts::versions::{
    channel_of, compare_versions, daemon_versions, is_next_daemon_version, Release, RELEASE_REPO,
};
use crate::views::settings::kit::*;

// ----- overview -------------------------------------------------------------------------------

#[component]
pub fn HostOverview() -> impl IntoView {
    let app = crate::state::get();
    let cfg = config::get();
    let host = Memo::new(move |_| app.hosts.active());
    let name = Signal::derive(move || {
        host.get()
            .map(|h| h.name)
            .or_else(|| app.conn.active_link().server_name)
            .unwrap_or_else(|| "this host".to_owned())
    });
    let rename = Callback::new(move |v: String| {
        if let (Some(id), false) = (app.hosts.active_id.get_untracked(), v.is_empty()) {
            app.hosts.rename(&id, &v);
        }
    });
    let relay = Memo::new(move |_| cfg.at("/relay"));
    view! {
        <Section title="Identity">
            <Row label="Name" hint="Shown on this device only">
                <TextField value=name on_change=rename width=200.0 />
            </Row>
        </Section>
        <Section title="Connections">
            <Row
                label=Signal::derive(move || if host.get().is_some_and(|h| h.is_relay()) { "Relay".to_owned() } else { "Direct".to_owned() })
                hint=Signal::derive(move || host.get().map(|h| format!("{}{}", h.endpoint, if h.tls == Some(true) { " · TLS" } else { "" })).unwrap_or_else(|| "Connection address unavailable".to_owned()))
            >
                <Pill text="this device" tint="cyan2" />
            </Row>
            {move || relay.get().map(|r| {
                let mutable = r.get("endpointMutable") != Some(&Value::Bool(false));
                let enabled = r.get("enabled").and_then(Value::as_bool).unwrap_or(false);
                let tls = r.get("useTls").and_then(Value::as_bool).unwrap_or(true);
                let endpoint = s(&r, "endpoint");
                view! {
                    <Row label="Relay" hint="Reach this host from anywhere, end-to-end encrypted">
                        <Toggle value=enabled on_change=Callback::new(move |v: bool| cfg.patch(json!({ "relay": { "enabled": v } }))) label="Relay" />
                    </Row>
                    <Row
                        label="Relay endpoint"
                        hint=if mutable { "Overridden by FROGG_RELAY_ENDPOINT if set" } else { "Overridden by FROGG_RELAY_ENDPOINT" }
                    >
                        {if mutable {
                            view! {
                                <TextField
                                    value=endpoint.clone()
                                    on_change=Callback::new(move |v: String| cfg.patch(json!({ "relay": { "endpoint": v } })))
                                    width=200.0
                                    mono=true
                                />
                            }.into_any()
                        } else {
                            view! { <Value text=if endpoint.is_empty() { "—".to_owned() } else { endpoint.clone() } /> }.into_any()
                        }}
                        <Toggle
                            value=tls
                            disabled=!mutable
                            on_change=Callback::new(move |v: bool| cfg.patch(json!({ "relay": { "useTls": v } })))
                            label="Relay TLS"
                        />
                        <Value text="TLS" />
                    </Row>
                }
            })}
        </Section>
        <WebClient />
        <Section title="Danger zone">
            <Row label="Remove host" hint=Signal::derive(move || format!("Forget {} on this device. The daemon keeps running", name.get()))>
                <Confirm
                    label="Remove…"
                    confirm="Remove host"
                    disabled=Signal::derive(move || app.hosts.active_id.get().is_none())
                    on_confirm=Callback::new(move |_| {
                        if let Some(id) = app.hosts.active_id.get_untracked() {
                            app.hosts.remove(&id);
                        }
                    })
                />
            </Row>
        </Section>
    }
}

#[component]
fn WebClient() -> impl IntoView {
    let supported = config::feature("webUiControl") == Some(true);
    if !supported {
        return ().into_any();
    }
    let web = config::use_rpc(
        |c: DaemonClient| async move { ns(&c, "daemon.web_ui.get_status.request", json!({})).await },
        Signal::derive(|| true),
        None,
    );
    let act = Action::new();
    let run = move |key: &'static str, req: &'static str, fields: Value| {
        act.run(
            key,
            async move { ns(&need()?, req, fields).await },
            move |_| web.reload(),
        );
    };
    view! {
        <Section title="Web client">
            <RpcStatus rpc=web what="web client">
                {move || web.data.get().map(|w| {
                    let running = w.get("running") == Some(&Value::Bool(true));
                    let hint = if running {
                        format!("Running on {}:{}", s(&w, "host"), w.get("port").map(|p| p.to_string()).unwrap_or_default())
                    } else {
                        w.get("lastError").and_then(Value::as_str).unwrap_or("Stopped").to_owned()
                    };
                    let available = w.get("available") != Some(&Value::Bool(false));
                    let pinned = w.get("startOnLaunchPinned") == Some(&Value::Bool(true));
                    let launch = w.get("startOnLaunch") == Some(&Value::Bool(true));
                    let iface = if s(&w, "host") == "0.0.0.0" { "0.0.0.0" } else { "127.0.0.1" };
                    view! {
                        <Row label="Status" hint=hint>
                            <Pill text=if running { "running" } else { "stopped" } tint=if running { "mint" } else { "faint" } />
                            {if running {
                                view! { <Button label="Stop" disabled=Signal::derive(move || act.busy()) on_press=Callback::new(move |_| run("stop", "daemon.web_ui.stop.request", json!({}))) /> }.into_any()
                            } else {
                                view! { <Button label="Start" disabled=Signal::derive(move || act.busy() || !available) on_press=Callback::new(move |_| run("start", "daemon.web_ui.start.request", json!({}))) /> }.into_any()
                            }}
                        </Row>
                        <Row label="Start with the daemon" hint=if pinned { "Set by the daemon’s environment" } else { "" }>
                            <Toggle value=launch disabled=pinned on_change=Callback::new(move |v: bool| run("launch", "daemon.web_ui.update.request", json!({ "startOnLaunch": v }))) />
                        </Row>
                        <Row label="Interface">
                            <Seg
                                options=opts(&[("127.0.0.1", "This machine only"), ("0.0.0.0", "All interfaces")])
                                value=iface.to_owned()
                                on_change=Callback::new(move |v: String| run("iface", "daemon.web_ui.update.request", json!({ "host": v })))
                            />
                        </Row>
                    }
                })}
            </RpcStatus>
            <ErrorLine text=act.error />
        </Section>
    }
    .into_any()
}

// ----- devices --------------------------------------------------------------------------------

const ROLES: &[(&str, &str)] = &[
    ("owner", "Owner"),
    ("operator", "Operator"),
    ("viewer", "Viewer"),
];
const INVITE_ROLES: &[(&str, &str)] = &[("operator", "Operator"), ("viewer", "Viewer")];

pub fn device_icon(name: &str) -> Ico {
    let n = name.to_lowercase();
    if ["phone", "pixel", "android", "iphone", "galaxy"]
        .iter()
        .any(|k| n.contains(k))
    {
        Ico::Smartphone
    } else if ["firefox", "chrome", "safari", "edge", "browser", "web"]
        .iter()
        .any(|k| n.contains(k))
    {
        Ico::Globe
    } else {
        Ico::Laptop
    }
}

pub fn seen_text(d: &Value) -> String {
    let connected = d.get("connected") == Some(&Value::Bool(true));
    let current = d.get("current") == Some(&Value::Bool(true));
    let mut seen = match d.get("lastSeenAt").and_then(Value::as_str) {
        Some(t) => format!("Last seen {}", ago(t)),
        None => "Never connected".to_owned(),
    };
    if connected {
        seen = "Connected".to_owned();
    }
    if current {
        seen = if connected {
            "This app · connected".to_owned()
        } else {
            "This app".to_owned()
        };
    }
    match registered_via(d.get("pairedVia").and_then(Value::as_str)) {
        Some(via) => format!("{seen} · {via}"),
        None => seen,
    }
}

fn an(word: &str) -> &'static str {
    if word.starts_with(['a', 'e', 'i', 'o', 'u']) {
        "an"
    } else {
        "a"
    }
}

#[component]
pub fn DevicesAccess() -> impl IntoView {
    let supported = config::feature("deviceAccess");
    let role = config::caller_role();
    let owner = role.as_deref().map(|r| r == "owner").unwrap_or(true);
    let devices = config::use_rpc(
        |c: DaemonClient| async move { ns(&c, "auth.device.list.request", json!({})).await },
        Signal::derive(move || supported != Some(false)),
        Some(15_000),
    );
    let requests = config::use_rpc(
        |c: DaemonClient| async move { ns(&c, "auth.pairing_request.list.request", json!({})).await },
        Signal::derive(move || supported != Some(false) && owner),
        Some(5_000),
    );
    if supported == Some(false) {
        return view! { <p class="set-note top">"This daemon is too old for per-device access. Update it first."</p> }.into_any();
    }
    let role2 = StoredValue::new(role.clone().unwrap_or_else(|| "owner".to_owned()));
    view! {
        {if owner {
            view! { <PairBar /> }.into_any()
        } else {
            let r = role.clone().unwrap_or_default();
            view! {
                <p class="set-note top">
                    {format!("This app is registered as {} {r}. Only an owner device can pair new devices or approve pairing requests.", an(&r))}
                </p>
            }.into_any()
        }}
        {move || {
            let waiting = requests.data.get().and_then(|d| d.get("requests").and_then(Value::as_array).cloned()).unwrap_or_default();
            (!waiting.is_empty()).then(|| view! {
                <Section title="Waiting for approval">
                    {waiting.into_iter().map(|r| view! { <PendingRow req=r on_done=Callback::new(move |_| { requests.reload(); devices.reload(); }) /> }).collect_view()}
                </Section>
            })
        }}
        <ErrorLine text=requests.error />
        <Section title="Devices">
            <RpcStatus rpc=devices what="devices">
                {move || {
                    let list = devices.data.get().and_then(|d| d.get("devices").and_then(Value::as_array).cloned()).unwrap_or_default();
                    let unregistered = !list.iter().any(|d| d.get("current") == Some(&Value::Bool(true)));
                    let r = role2.get_value();
                    view! {
                        {unregistered.then(|| view! {
                            <Item ico=Ico::Globe title="This app" sub="Connected without registering: this daemon predates device registration. Update it so every connection is a device.">
                                <span class="t-mono">{r.clone()}</span>
                            </Item>
                        })}
                        {if list.is_empty() {
                            view! { <Block><span class="set-row-hint">"No devices registered yet."</span></Block> }.into_any()
                        } else {
                            list.into_iter().map(|d| view! { <DeviceRow device=d on_change=Callback::new(move |_| devices.reload()) /> }).collect_view().into_any()
                        }}
                    }
                }}
            </RpcStatus>
        </Section>
        <Section title="Roles">
            <Row label="Owner" hint="Everything, including pairing and security" />
            <Row label="Operator" hint="Drive sessions, approve, run terminals" />
            <Row label="Viewer" hint="Read-only" />
        </Section>
    }
    .into_any()
}

/// "Pair a device": mint a code and links on the active host for another device to use.
#[component]
pub fn PairBar() -> impl IntoView {
    let role = RwSignal::new("operator".to_owned());
    let code = RwSignal::new(None::<Value>);
    let act = Action::new();
    let create = Callback::new(move |_| {
        let r = role.get_untracked();
        act.run(
            "pair",
            async move {
                ns(
                    &need()?,
                    "auth.pairing_code.create.request",
                    json!({ "role": r }),
                )
                .await
            },
            move |v| code.set(Some(v)),
        );
    });
    view! {
        <Banner ico=Ico::QrCode title="Pair a device" body="One flow for phones, browsers and other computers: a link and 8-character code that carry the same offer.">
            <Seg options=opts(INVITE_ROLES) value=role on_change=Callback::new(move |v| role.set(v)) />
            <Button
                kind=ButtonKind::Primary
                label=Signal::derive(move || if act.busy() { "Creating…".to_owned() } else { "Pair a device…".to_owned() })
                disabled=Signal::derive(move || act.busy())
                on_press=create
            />
        </Banner>
        <ErrorLine text=Signal::derive(move || act.error.get().map(|e| pairing_error_text(&e, config::caller_role().as_deref()))) />
        {move || code.get().filter(|c| c.get("code").and_then(Value::as_str).is_some()).map(|c| view! {
            <PairingCode code=c on_done=Callback::new(move |_| code.set(None)) />
        })}
    }
}

/// A minted pairing code with its links.
#[component]
pub fn PairingCode(code: Value, on_done: Callback<()>) -> impl IntoView {
    let raw = s(&code, "code").replace('-', "");
    let shown = if raw.len() > 4 {
        format!("{}-{}", &raw[..4], &raw[4..])
    } else {
        raw
    };
    let role = code
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or("operator")
        .to_owned();
    let expires = code
        .get("expiresAt")
        .and_then(Value::as_str)
        .map(|t| {
            let d = js_sys::Date::new(&wasm_bindgen::JsValue::from_str(t));
            format!(
                " · expires {}",
                String::from(d.to_locale_string("default", &wasm_bindgen::JsValue::UNDEFINED))
            )
        })
        .unwrap_or_default();
    let endpoints = code
        .get("endpoints")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    view! {
        <Section title="Pairing code">
            <Block>
                <span class="pair-code t-mono">{shown}</span>
                <span class="set-row-hint">{format!("Enter it on the new device, or open the link there. Grants {role}{expires}.")}</span>
            </Block>
            {endpoints.into_iter().map(|e| view! {
                <Item title=format!("{}:{}", s(&e, "host"), e.get("port").map(|p| p.to_string()).unwrap_or_default()) sub=s(&e, "deepLink") mono=true />
            }).collect_view()}
            <Block><Acts><Button label="Done" on_press=on_done /></Acts></Block>
        </Section>
    }
}

#[component]
fn PendingRow(req: Value, on_done: Callback<()>) -> impl IntoView {
    let role = RwSignal::new("operator".to_owned());
    let act = Action::new();
    let id = StoredValue::new(s(&req, "id"));
    let decide = move |decision: &'static str| {
        let mut fields = json!({ "pairingRequestId": id.get_value(), "decision": decision });
        if decision == "approve" {
            fields["role"] = json!(role.get_untracked());
        }
        act.run(
            decision,
            async move { ns(&need()?, "auth.pairing_request.decide.request", fields).await },
            move |_| on_done.run(()),
        );
    };
    let sub = format!(
        "Match code {}{} · {}",
        s(&req, "matchCode"),
        req.get("remoteAddress")
            .and_then(Value::as_str)
            .map(|a| format!(" · {a}"))
            .unwrap_or_default(),
        req.get("createdAt")
            .and_then(Value::as_str)
            .map(ago)
            .unwrap_or_default()
    );
    view! {
        <Item ico=Ico::ShieldAlert title=s(&req, "deviceName") sub=sub>
            <Seg options=opts(INVITE_ROLES) value=role on_change=Callback::new(move |v| role.set(v)) />
            <Button label="Deny" disabled=Signal::derive(move || act.busy()) on_press=Callback::new(move |_| decide("deny")) />
            <Button
                kind=ButtonKind::Primary
                label=Signal::derive(move || if act.pending.get() == Some("approve") { "Approving…".to_owned() } else { "Approve".to_owned() })
                disabled=Signal::derive(move || act.busy())
                on_press=Callback::new(move |_| decide("approve"))
            />
        </Item>
        <ErrorLine text=act.error />
    }
}

#[component]
fn DeviceRow(device: Value, on_change: Callback<()>) -> impl IntoView {
    let act = Action::new();
    let current = device.get("current") == Some(&Value::Bool(true));
    let owner = config::caller_role().is_none_or(|r| r == "owner");
    let can_roles = config::feature("deviceRoleManagement") == Some(true) && owner && !current;
    let name = RwSignal::new(None::<String>);
    let draft = RwSignal::new(String::new());
    let id = StoredValue::new(s(&device, "id"));
    let dname = s(&device, "name");
    let role = s(&device, "role");
    let seen = seen_text(&device);
    let run = move |key: &'static str, req: &'static str, fields: Value| {
        act.run(
            key,
            async move { ns(&need()?, req, fields).await },
            move |_| {
                name.set(None);
                on_change.run(());
            },
        );
    };
    let save = Callback::new(move |_| {
        let n = draft.get_untracked().trim().to_owned();
        if !n.is_empty() {
            run(
                "rename",
                "auth.device.rename.request",
                json!({ "deviceId": id.get_value(), "name": n }),
            );
        }
    });
    let dname2 = dname.clone();
    view! {
        <Item ico=device_icon(&dname) title=dname.clone() sub=Signal::derive(move || act.error.get().unwrap_or_else(|| seen.clone()))>
            {move || if name.get().is_some() {
                view! {
                    <Input value=draft autofocus=true on_enter=save />
                    <Button label="Cancel" on_press=Callback::new(move |_| name.set(None)) />
                    <Button kind=ButtonKind::Primary label="Save" disabled=Signal::derive(move || act.busy()) on_press=save />
                }.into_any()
            } else {
                let dn = dname2.clone();
                view! {
                    {if can_roles {
                        view! {
                            <Select
                                options=ROLES.iter().map(|(v, l)| SelectOption::new(*v, *l)).collect()
                                value=role.clone()
                                on_change=Callback::new(move |r: String| run("role", "auth.device.set_role.request", json!({ "credentialId": id.get_value(), "role": r })))
                            />
                        }.into_any()
                    } else {
                        view! { <span class="t-mono">{role.clone()}</span> }.into_any()
                    }}
                    <Button label="Rename" on_press=Callback::new(move |_| { draft.set(dn.clone()); name.set(Some(String::new())); }) />
                    {(!current).then(|| view! {
                        <Confirm
                            label="Revoke…"
                            confirm="Revoke access"
                            pending=Signal::derive(move || act.pending.get() == Some("revoke"))
                            on_confirm=Callback::new(move |_| run("revoke", "auth.device.revoke.request", json!({ "deviceId": id.get_value() })))
                        />
                    })}
                }.into_any()
            }}
        </Item>
    }
}

// ----- automation -----------------------------------------------------------------------------

#[component]
pub fn Automation() -> impl IntoView {
    let cfg = config::get();
    move || {
        if cfg.config.with(Option::is_none) {
            return view! { <span class="t-label">"loading…"</span> }.into_any();
        }
        let resume = cfg.flag("/autoResumeOnUsageLimit");
        let choose = cfg
            .at("/metadataGeneration/providers")
            .and_then(|v| v.as_array().map(|a| !a.is_empty()))
            .unwrap_or(false);
        view! {
            <Section title="Sessions">
                <Row label="Archive sessions when their PR merges" hint="The worktree is kept; the session leaves the list.">
                    <Toggle
                        value=Signal::derive(move || cfg.flag("/autoArchiveAfterMerge").unwrap_or(false))
                        on_change=Callback::new(move |v: bool| cfg.patch(json!({ "autoArchiveAfterMerge": v })))
                    />
                </Row>
                <Row label="Resume after a usage limit resets" hint="Sends the interrupted turn again once the provider allows it.">
                    <Toggle
                        value=Signal::derive(move || cfg.flag("/autoResumeOnUsageLimit").unwrap_or(false))
                        disabled=resume.is_none()
                        on_change=Callback::new(move |v: bool| cfg.patch(json!({ "autoResumeOnUsageLimit": v })))
                    />
                </Row>
            </Section>
            <Section title="Generated names, commits and PR text">
                <Row label="Model" hint="Which provider writes titles, branch names and commit messages.">
                    <Value text=if choose { "Chosen per provider" } else { "Automatic" } />
                </Row>
            </Section>
        }
        .into_any()
    }
}

// ----- daemon & updates -----------------------------------------------------------------------

#[component]
pub fn DaemonUpdates() -> impl IntoView {
    let app = crate::state::get();
    let cfg = config::get();
    let runs = config::feature("daemonUpdateRuns") == Some(true);
    let status = config::use_rpc(
        |c: DaemonClient| async move { ns(&c, "daemon.get_status.request", json!({})).await },
        Signal::derive(|| true),
        None,
    );
    let update = config::use_rpc(
        |c: DaemonClient| async move { ns(&c, "daemon.update.get_status.request", json!({})).await },
        Signal::derive(move || runs),
        Some(4000),
    );
    let host = Signal::derive(move || {
        app.conn
            .active_link()
            .server_name
            .unwrap_or_else(|| "This host".to_owned())
    });
    let version = Signal::derive(move || {
        status
            .data
            .get()
            .and_then(|d| d.get("version").and_then(Value::as_str).map(str::to_owned))
            .or_else(|| {
                update.data.get().and_then(|d| {
                    d.get("currentVersion")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
            })
            .or_else(config::host_version)
    });
    let auto = Memo::new(move |_| cfg.at("/autoUpdate"));
    let set_auto = move |patch: Value| cfg.patch(json!({ "autoUpdate": patch }));
    let show_full = RwSignal::new(false);
    let restart = Action::new();
    view! {
        <Banner
            ico=Ico::Upload
            title=Signal::derive(move || format!("{} runs {}", host.get(), version.get().unwrap_or_else(|| "an unknown version".to_owned())))
            body="Pick a channel or an exact version, check, then update. The daemon restarts into the new version and rolls back on its own if it fails to start."
        />
        <Section title="Update this host">
            <Block>{move || view! { <HostUpdate version=version.get() /> }}</Block>
        </Section>
        <ErrorLine text=Signal::derive(move || status.error.get().or_else(|| update.error.get())) />
        {move || update.data.get().and_then(|u| u.get("run").filter(|r| !r.is_null()).cloned()).map(|r| view! {
            <Section title="Updating">
                <Row
                    label=format!("{} → {}", r.get("from").and_then(Value::as_str).unwrap_or("?"), s(&r, "to"))
                    hint=r.get("message").and_then(Value::as_str).map(str::to_owned).unwrap_or_else(|| s(&r, "phase"))
                >
                    <Value text=s(&r, "phase") />
                </Row>
            </Section>
        })}
        <Section title="Updates">
            {move || match auto.get() {
                None => view! { <Row label="Automatic updates" hint="Configuration unavailable" /> }.into_any(),
                Some(a) => {
                    let quiet = a.get("quietHours").and_then(Value::as_array).cloned();
                    let q = |i: usize| quiet.as_ref().and_then(|q| q.get(i)).and_then(Value::as_f64);
                    let (q0, q1) = (q(0), q(1));
                    let enabled = a.get("enabled") == Some(&Value::Bool(true));
                    let channel = a.get("channel").and_then(Value::as_str).unwrap_or("stable").to_owned();
                    let every = a.get("checkIntervalHours").and_then(Value::as_f64);
                    view! {
                        <Row label="Update automatically" hint="When idle">
                            <Toggle value=enabled on_change=Callback::new(move |v: bool| set_auto(json!({ "enabled": v }))) />
                        </Row>
                        <Row label="Channel" hint="Release channel for this daemon">
                            <Seg
                                options=opts(&[("stable", "Stable"), ("beta", "Beta")])
                                value=channel
                                on_change=Callback::new(move |v: String| set_auto(json!({ "channel": v })))
                            />
                        </Row>
                        <Row label="Quiet hours" hint="Never applied inside this window (host’s local hours)">
                            <NumField
                                value=q0
                                on_change=Callback::new(move |v: Option<f64>| set_auto(json!({ "quietHours": v.map(|v| json!([v, q1.unwrap_or((v + 3.0) % 24.0)])) })))
                                max=23.0 unit="–" placeholder="hh" width=56.0
                            />
                            <NumField
                                value=q1
                                on_change=Callback::new(move |v: Option<f64>| set_auto(json!({ "quietHours": v.map(|v| json!([q0.unwrap_or((v + 21.0) % 24.0), v])) })))
                                max=23.0 unit="h" placeholder="hh" width=56.0
                            />
                        </Row>
                        <Row label="Check every">
                            <NumField
                                value=every
                                on_change=Callback::new(move |v: Option<f64>| set_auto(json!({ "checkIntervalHours": v.unwrap_or(24.0) })))
                                min=1.0 max=168.0 unit="h"
                            />
                        </Row>
                    }.into_any()
                }
            }}
            <Row
                label="Method"
                hint=Signal::derive(move || update.data.get().map(|u| if u.get("updatable") == Some(&Value::Bool(true)) { "Detected".to_owned() } else { u.get("reason").and_then(Value::as_str).unwrap_or("Detected").to_owned() }).unwrap_or_else(|| "Detected".to_owned()))
            >
                <Value text=Signal::derive(move || match update.data.get() {
                    None => "—".to_owned(),
                    Some(u) if u.get("updatable") != Some(&Value::Bool(true)) => "manual install".to_owned(),
                    Some(u) => match u.get("installDir").and_then(Value::as_str) {
                        Some(d) => format!("self-update · {d}"),
                        None => "self-update".to_owned(),
                    },
                }) />
            </Row>
        </Section>
        <Section title="Service">
            <Row label="Restart daemon" hint=Signal::derive(move || restart.error.get().unwrap_or_else(|| "Interrupts active work and briefly disconnects this host".to_owned()))>
                <Confirm
                    label="Restart"
                    confirm="Restart now"
                    pending=Signal::derive(move || restart.busy())
                    on_confirm=Callback::new(move |_| {
                        restart.run(
                            "restart",
                            async move {
                                let c = need()?;
                                c.restart_server(Some("settings")).await.map_err(|e| e.to_string())
                            },
                            |_| {},
                        );
                    })
                />
            </Row>
            <Row label="Full status">
                <Button label=Signal::derive(move || if show_full.get() { "Hide".to_owned() } else { "Show".to_owned() }) on_press=Callback::new(move |_| show_full.update(|o| *o = !*o)) />
            </Row>
            <Show when=move || show_full.get()>
                <Block>
                    <RpcStatus rpc=status what="status">
                        {move || status.data.get().map(|d| {
                            let relay = d.get("relay").cloned().unwrap_or(Value::Null);
                            let relay_t = if relay.get("enabled") == Some(&Value::Bool(true)) {
                                format!("{}{}", s(&relay, "publicEndpoint"), if relay.get("publicUseTls") == Some(&Value::Bool(true)) { " · TLS" } else { "" })
                            } else {
                                "off".to_owned()
                            };
                            let mut lines = vec![
                                ("Server id".to_owned(), s(&d, "serverId")),
                                ("Version".to_owned(), d.get("version").and_then(Value::as_str).unwrap_or("—").to_owned()),
                                ("Process".to_owned(), format!("pid {} · {}", d.get("pid").map(|p| p.to_string()).unwrap_or_default(), s(&d, "nodePath"))),
                                ("Started".to_owned(), d.get("startedAt").and_then(Value::as_str).map(ago).unwrap_or_else(|| "—".to_owned())),
                                ("Listening".to_owned(), d.get("listen").and_then(Value::as_str).unwrap_or("—").to_owned()),
                                ("Relay".to_owned(), relay_t),
                            ];
                            for p in d.get("providers").and_then(Value::as_array).cloned().unwrap_or_default() {
                                let v = if p.get("available") == Some(&Value::Bool(true)) { "available".to_owned() } else { p.get("error").and_then(Value::as_str).unwrap_or("unavailable").to_owned() };
                                lines.push((s(&p, "provider"), v));
                            }
                            view! {
                                <pre class="status-lines t-mono">
                                    {lines.into_iter().map(|(k, v)| format!("{k:<12} {v}\n")).collect::<String>()}
                                </pre>
                            }
                        })}
                    </RpcStatus>
                </Block>
            </Show>
        </Section>
        {move || update.data.get().and_then(|u| u.get("lastResult").filter(|r| !r.is_null()).cloned()).map(|r| view! {
            <Section title="Recent updates">
                <Row label=s(&r, "to") hint=last_text(&r) />
            </Section>
        })}
    }
}

fn last_text(r: &Value) -> String {
    let when = r
        .get("at")
        .and_then(Value::as_str)
        .map(ago)
        .unwrap_or_default();
    let reason = r
        .get("reason")
        .and_then(Value::as_str)
        .map(|x| format!(" · {x}"))
        .unwrap_or_default();
    match s(r, "status").as_str() {
        "applied" => format!("applied {when}"),
        "rolled_back" => format!("rolled back{reason} · {when}"),
        _ => format!("failed{reason} · {when}"),
    }
}

fn check_line(c: &Value) -> String {
    if let Some(e) = config::payload_error(c) {
        return e;
    }
    let channel = s(c, "channel");
    let latest = c.get("latestVersion").and_then(Value::as_str);
    if c.get("updatable") == Some(&Value::Bool(false)) {
        return c
            .get("reason")
            .and_then(Value::as_str)
            .unwrap_or("This install can't update itself.")
            .to_owned();
    }
    match (c.get("updateAvailable") == Some(&Value::Bool(true)), latest) {
        (true, Some(l)) => format!("{l} available on {channel}"),
        (false, Some(l)) => format!("Up to date on {channel} ({l})"),
        _ => "Up to date".to_owned(),
    }
}

fn run_line(run: &Value) -> String {
    let bytes = match run.get("receivedBytes").and_then(Value::as_f64) {
        Some(r) => format!(
            " · {}{}",
            fmt_bytes(r),
            run.get("totalBytes")
                .and_then(Value::as_f64)
                .map(|t| format!(" of {}", fmt_bytes(t)))
                .unwrap_or_default()
        ),
        None => String::new(),
    };
    format!(
        "{} → {} · {}{bytes}",
        run.get("from").and_then(Value::as_str).unwrap_or("?"),
        s(run, "to"),
        run.get("message")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| s(run, "phase"))
    )
}

/// Update the active host's daemon: pick a channel or type an exact version, check, then
/// install. Daemons without versioned self-update get the npm-era update. Failures show.
/// The version picker lists the repository's GitHub releases that ship this daemon's bundle.
#[component]
pub fn HostUpdate(version: Option<String>) -> impl IntoView {
    let runs = config::feature("daemonUpdateRuns");
    let channel = RwSignal::new(channel_of(version.as_deref()).to_owned());
    let pin = RwSignal::new(String::new());
    let check = RwSignal::new(None::<Value>);
    let status = RwSignal::new(None::<Value>);
    let act = Action::new();
    let alive = StoredValue::new(true);
    on_cleanup(move || {
        let _ = alive.try_set_value(false);
    });
    Effect::new(move |_| {
        channel.track();
        check.set(None);
    });
    if runs == Some(true) {
        let read = move || {
            let Ok(c) = need() else { return };
            leptos::task::spawn_local(async move {
                if let Ok(s) = ns(&c, "daemon.update.get_status.request", json!({})).await {
                    if alive.try_get_value().unwrap_or(false) {
                        status.set(Some(s));
                    }
                }
            });
        };
        read();
        if let Ok(h) = set_interval_with_handle(
            move || {
                if alive.try_get_value().unwrap_or(false) {
                    read();
                }
            },
            std::time::Duration::from_millis(5000),
        ) {
            on_cleanup(move || h.clear());
        }
    }
    let next_daemon = is_next_daemon_version(version.as_deref());
    let releases = RwSignal::new(None::<Result<Vec<Release>, String>>);
    if runs == Some(true) {
        leptos::task::spawn_local(async move {
            let r = fetch_releases().await;
            if alive.try_get_value().unwrap_or(false) {
                releases.set(Some(r));
            }
        });
    }
    let current = StoredValue::new(version);
    let version_options = Memo::new(move |_| {
        let ch = channel.get();
        let cur = current.get_value();
        let mut opts = vec![SelectOption::new("", format!("Latest {ch}"))];
        if let Some(Ok(rs)) = releases.get() {
            opts.extend(
                daemon_versions(&rs, &ch, cur.as_deref())
                    .into_iter()
                    .map(|v| {
                        let hint = [
                            (Some(v.version.as_str())
                                == cur.as_deref().map(|c| c.trim_start_matches('v')))
                            .then(|| "installed".to_owned()),
                            v.prerelease.then(|| "beta".to_owned()),
                            v.published_at.as_deref().map(ago),
                        ]
                        .into_iter()
                        .flatten()
                        .collect::<Vec<_>>()
                        .join(" · ");
                        SelectOption {
                            value: v.version.clone(),
                            label: v.version,
                            hint: (!hint.is_empty()).then_some(hint),
                        }
                    }),
            );
        }
        opts
    });
    match runs {
        None => return ().into_any(),
        Some(false) => return view! { <NpmUpdate /> }.into_any(),
        Some(true) => {}
    }
    let running = move || {
        status.with(|s| {
            s.as_ref()
                .and_then(|s| s.get("run"))
                .is_some_and(|r| !r.is_null())
        })
    };
    let target = move || {
        let p = pin.get().trim().to_owned();
        if !p.is_empty() {
            Some(p)
        } else {
            check.get().and_then(|c| {
                c.get("latestVersion")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
        }
    };
    let can_start = move || {
        !running()
            && !act.busy()
            && status
                .with(|s| s.as_ref().and_then(|s| s.get("updatable")) != Some(&Value::Bool(false)))
            && (!pin.get().trim().is_empty()
                || check.with(|c| {
                    c.as_ref().and_then(|c| c.get("updateAvailable")) == Some(&Value::Bool(true))
                }))
    };
    let run_check = Callback::new(move |_| {
        let ch = channel.get_untracked();
        act.run(
            "check",
            async move {
                ns(
                    &need()?,
                    "daemon.update.check.request",
                    json!({ "channel": ch }),
                )
                .await
            },
            move |v| check.set(Some(v)),
        );
    });
    let start = Callback::new(move |_| {
        let ch = channel.get_untracked();
        let t = target();
        act.run(
            "start",
            async move {
                let c = need()?;
                let mut fields = json!({ "channel": ch });
                if let Some(t) = t {
                    fields["version"] = json!(t.trim_start_matches('v'));
                }
                let r = ns(&c, "daemon.update.start.request", fields).await?;
                ns(&c, "daemon.update.get_status.request", json!({}))
                    .await
                    .or(Ok(r))
            },
            move |v| status.set(Some(v)),
        );
    });
    let newer = move || {
        let (Some(cur), Some(t)) = (current.get_value(), target()) else {
            return true;
        };
        compare_versions(&t, &cur) != std::cmp::Ordering::Equal
    };
    view! {
        <div class="hu">
            <div class="hu-line">
                <span class="hu-label">"Channel"</span>
                <Seg options=opts(&[("stable", "Stable"), ("beta", "Beta")]) value=channel on_change=Callback::new(move |v| channel.set(v)) />
            </div>
            <div class="hu-line">
                <span class="hu-label">"Version"</span>
                {move || {
                    let options = version_options.get();
                    let placeholder = if releases.with(Option::is_none) { "Loading versions…" } else { "Typed version" };
                    // A typed version that isn't listed leaves the picker on its placeholder.
                    let picked = Signal::derive(move || pin.get().trim().to_owned());
                    view! {
                        <Select options=options value=picked on_change=Callback::new(move |v: String| pin.set(v)) placeholder=placeholder mono=true />
                    }
                }}
            </div>
            <div class="hu-line">
                <span class="hu-label"></span>
                <Input value=pin placeholder="or type one" mono=true />
            </div>
            {move || releases.get().and_then(Result::err).map(|e| view! {
                <span class="set-row-hint">{format!("Could not list releases ({e}). Type a version instead.")}</span>
            })}
            {next_daemon.then(|| view! {
                <span class="set-row-hint">"A Frogg Next daemon installs only Frogg Next (-next) releases, on either channel."</span>
            })}
            <div class="set-acts">
                <Button
                    label=Signal::derive(move || if act.pending.get() == Some("check") { "Checking…".to_owned() } else { "Check for updates".to_owned() })
                    disabled=Signal::derive(move || act.busy() || running())
                    on_press=run_check
                />
                <Button
                    kind=ButtonKind::Primary
                    label=Signal::derive(move || if act.pending.get() == Some("start") { "Starting…".to_owned() } else { target().map(|t| format!("Update to {t}")).unwrap_or_else(|| "Update".to_owned()) })
                    disabled=Signal::derive(move || !can_start() || !newer())
                    on_press=start
                />
            </div>
            {move || check.get().map(|c| {
                let err = config::payload_error(&c).is_some();
                view! { <span class=if err { "set-err" } else { "set-row-hint" }>{check_line(&c)}</span> }
            })}
            {move || status.get().map(|st| {
                if let Some(r) = st.get("run").filter(|r| !r.is_null()) {
                    view! { <span class="t-mono hu-run">{run_line(r)}</span> }.into_any()
                } else if st.get("updatable") == Some(&Value::Bool(false)) {
                    view! { <span class="set-row-hint">{st.get("reason").and_then(Value::as_str).unwrap_or("This install can't update itself.").to_owned()}</span> }.into_any()
                } else if let Some(r) = st.get("lastResult").filter(|r| !r.is_null()) {
                    let ok = s(r, "status") == "applied";
                    view! { <span class=if ok { "set-row-hint" } else { "set-err" }>{last_text(r)}</span> }.into_any()
                } else {
                    ().into_any()
                }
            })}
            <ErrorLine text=act.error />
        </div>
    }
    .into_any()
}

/// Older npm installs: the npm-era update RPC, which answers once the update is done.
#[component]
fn NpmUpdate() -> impl IntoView {
    let act = Action::new();
    let done = RwSignal::new(None::<Value>);
    view! {
        <div class="hu">
            <span class="set-row-hint">
                "This daemon has no versioned self-update. Frogg can run its npm update instead; the host restarts when it finishes."
            </span>
            <div class="set-acts">
                <Button
                    kind=ButtonKind::Primary
                    label=Signal::derive(move || if act.busy() { "Updating…".to_owned() } else { "Update host".to_owned() })
                    disabled=Signal::derive(move || act.busy())
                    on_press=Callback::new(move |_| {
                        act.run(
                            "npm",
                            async move {
                                let c = need()?;
                                config::call(&c, "daemon.update.request", json!({}), "daemon.update.response", Some(300_000)).await
                            },
                            move |v| done.set(Some(v)),
                        );
                    })
                />
            </div>
            {move || done.get().map(|v| view! {
                <span class="set-ok">
                    {format!("Updated {} → {}. Reconnecting…", s(&v, "previousVersion"), v.get("newVersion").and_then(Value::as_str).unwrap_or("latest"))}
                </span>
            })}
            <ErrorLine text=act.error />
        </div>
    }
}

/// The repository's recent releases (GitHub API), fetched once per app run.
#[cfg(target_arch = "wasm32")]
async fn fetch_releases() -> Result<Vec<Release>, String> {
    use wasm_bindgen::JsCast;
    use wasm_bindgen_futures::JsFuture;
    thread_local! {
        static CACHE: std::cell::RefCell<Option<Vec<Release>>> = const { std::cell::RefCell::new(None) };
    }
    if let Some(c) = CACHE.with(|c| c.borrow().clone()) {
        return Ok(c);
    }
    let window = web_sys::window().ok_or("no window")?;
    let url = format!("https://api.github.com/repos/{RELEASE_REPO}/releases?per_page=50");
    let res = JsFuture::from(window.fetch_with_str(&url))
        .await
        .map_err(|_| "network error".to_owned())?
        .dyn_into::<web_sys::Response>()
        .map_err(|_| "bad response".to_owned())?;
    if !res.ok() {
        return Err(format!("GitHub releases answered HTTP {}", res.status()));
    }
    let text = JsFuture::from(res.text().map_err(|_| "bad body".to_owned())?)
        .await
        .ok()
        .and_then(|t| t.as_string())
        .unwrap_or_default();
    let list: Vec<Release> = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    CACHE.with(|c| *c.borrow_mut() = Some(list.clone()));
    Ok(list)
}

#[cfg(not(target_arch = "wasm32"))]
async fn fetch_releases() -> Result<Vec<Release>, String> {
    let _ = RELEASE_REPO;
    Err("not available off the web".to_owned())
}
