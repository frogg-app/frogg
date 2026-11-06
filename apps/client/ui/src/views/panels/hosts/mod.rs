//! Hosts tool (ui-next `HostsPanel.tsx`, `hosts/HostDetail.tsx`, `Routes.tsx`, `Offline.tsx`,
//! `RemoveHost.tsx`, the edit-host and pair-device dialogs). Adding a host and pairing this app
//! open the shell's host sheet.

pub mod access;
pub mod here;
pub mod offline;
pub mod pair;
pub mod routes;
pub mod service_url;
pub mod versions;

use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::{json, Value};

use crate::components::{Brackets, Button, ButtonKind, Cut, Ico, Icon, Sheet};
use crate::shell::panel_head::{GroupHead, PanelHead};
use crate::state::config::{self, fmt_uptime, ns};
use crate::state::hosts::{parse_host_address, Host};
use crate::state::hostview::{self, open_add_host, HostDialog};
use crate::state::Conn;
use crate::views::settings::kit::{ErrorLine, Input, Meter};
use crate::views::settings::pages::host::HostUpdate;
use access::{auth_refusal, identity_mismatch, offline_reason};
use offline::Offline;
use routes::Routes;

pub fn host_kind(h: &Host) -> &'static str {
    if h.is_relay() {
        "Relay"
    } else {
        "Direct"
    }
}

fn last_error(host_id: &str) -> Option<frogg_client_core::ErrorInfo> {
    crate::state::get()
        .conn
        .client_of(host_id)
        .and_then(|c| c.last_error_info())
}

fn restart_daemon() {
    let app = crate::state::get();
    let Some(c) = app.conn.client() else { return };
    spawn_local(async move {
        match c.restart_server(Some("Restart from Hosts")).await {
            Ok(_) => app.toasts.push(crate::shell::toast::Toast::new(
                crate::shell::toast::ToastKind::Info,
                "Restarting the daemon…",
            )),
            Err(e) => app.toasts.push(
                crate::shell::toast::Toast::new(
                    crate::shell::toast::ToastKind::Error,
                    "Couldn't restart the daemon",
                )
                .detail(e.to_string()),
            ),
        };
    });
}

#[component]
pub fn HostsPanel() -> impl IntoView {
    let app = crate::state::get();
    let hv = hostview::get();
    let phone = move || app.viewport.phone();
    view! {
        <div class="panel hosts-panel">
            {move || if phone() && hv.pushed.get() {
                view! { <HostDetailView on_back=Some(Callback::new(move |_| hv.view(None, false))) /> }.into_any()
            } else {
                view! { <HostList /> }.into_any()
            }}
            <HostDialogs />
        </div>
    }
}

#[component]
fn HostList() -> impl IntoView {
    let app = crate::state::get();
    let hv = hostview::get();
    let online = Memo::new(move |_| app.conn.active_link().conn == Conn::Online);
    view! {
        <PanelHead title="Hosts">
            <div class="ph-acts">
                <Show when=move || online.get()>
                    <button class="icon-btn" aria-label="Pair a device" on:click=move |_| hv.open(HostDialog::PairDevice)>
                        <Icon ico=Ico::QrCode size=15.0 />
                    </button>
                </Show>
                <button class="icon-btn" aria-label="Add a host" on:click=move |_| open_add_host(false)>
                    <Icon ico=Ico::Plus size=16.0 />
                </button>
            </div>
        </PanelHead>
        <div class="panel-scroll">
            <For
                each=move || app.hosts.hosts.get()
                key=|h| (h.id.clone(), h.name.clone(), h.endpoint.clone(), h.relay.is_some())
                children=move |h: Host| view! { <HostRow h=h /> }
            />
            <Show when=move || app.hosts.hosts.with(Vec::is_empty)>
                <span class="hosts-empty">"No hosts yet."</span>
            </Show>
            <GroupHead label="Add" />
            <button class="hosts-add" on:click=move |_| open_add_host(false)>
                <Icon ico=Ico::Plus size=14.0 class="cyan2" />
                <span class="hosts-add-text">
                    <span class="hosts-add-t">"Add a host"</span>
                    <span class="hosts-sub">"Paste a pairing link or code, or enter an address"</span>
                </span>
            </button>
        </div>
    }
}

#[component]
fn HostRow(h: Host) -> impl IntoView {
    let app = crate::state::get();
    let hv = hostview::get();
    let id = StoredValue::new(h.id.clone());
    let link = Memo::new(move |_| app.conn.link(&id.get_value()));
    let active =
        Memo::new(move |_| app.hosts.active_id.get().as_deref() == Some(id.get_value().as_str()));
    let shown = Memo::new(move |_| {
        hv.view_id
            .get()
            .or_else(|| app.hosts.active_id.get())
            .as_deref()
            == Some(id.get_value().as_str())
    });
    let count = Memo::new(move |_| app.agents.list(Some(&id.get_value())).len());
    let status = move || {
        let l = link.get();
        match l.conn {
            Conn::Online => format!("{} sessions", count.get()),
            Conn::Connecting if l.attempt > 0 => format!("retrying (attempt {})…", l.attempt + 1),
            Conn::Connecting => "connecting…".to_owned(),
            Conn::Offline if l.paused => "stopped retrying".to_owned(),
            Conn::Offline => "offline".to_owned(),
        }
    };
    let reason = move || {
        let l = link.get();
        (l.conn != Conn::Online && (l.error.is_some() || l.attempt > 0))
            .then(|| offline_reason(last_error(&id.get_value()).as_ref(), l.error.as_deref()))
    };
    let kind = host_kind(&h);
    view! {
        <div class="host-item">
            <button
                class="hrow"
                class:on=move || shown.get()
                on:click=move |_| hv.view(Some(id.get_value()), true)
            >
                <Brackets on=shown />
                <span class="hrow-line">
                    <span class=move || format!("hdot {}", link.get().conn.id()) class:flag=move || reason().is_some()></span>
                    <span class="hrow-name">{h.name.clone()}</span>
                    <span class="hrow-badge t-mono">{kind}</span>
                    {move || active.get().then(|| view! { <span class="t-label hrow-active">"active"</span> })}
                </span>
                <span class="hrow-line">
                    <span class="t-mono hrow-endpoint">{h.endpoint.clone()}</span>
                    <span class="t-mono hosts-sub">{status}</span>
                </span>
                {move || reason().map(|r| view! { <span class="t-mono hrow-err">{r}</span> })}
            </button>
            <span class="hrow-tools">
                <button class="icon-btn" aria-label=format!("Edit {}", h.name) on:click=move |_| hv.open(HostDialog::Edit(id.get_value()))>
                    <Icon ico=Ico::Pencil size=13.0 />
                </button>
                <button class="icon-btn danger" aria-label=format!("Remove {}", h.name) on:click=move |_| hv.open(HostDialog::Remove(id.get_value()))>
                    <Icon ico=Ico::Trash2 size=13.0 />
                </button>
            </span>
        </div>
    }
}

/// Desktop/tablet main pane of the Hosts tool.
#[component]
pub fn HostDetail() -> impl IntoView {
    view! { <HostDetailView on_back=None /> }
}

#[component]
fn HostDetailView(on_back: Option<Callback<()>>) -> impl IntoView {
    let app = crate::state::get();
    let hv = hostview::get();
    let host = Memo::new(move |_| {
        let id = hv.view_id.get().or_else(|| app.hosts.active_id.get())?;
        app.hosts.find(&id)
    });
    let active = Memo::new(move |_| {
        host.get()
            .map(|h| Some(h.id) == app.hosts.active_id.get())
            .unwrap_or(false)
    });
    view! {
        <div class="detail host-detail">
            <div class="set-scroll">
                <div class="host-detail-in m-enter">
                    {move || match host.get() {
                        None => view! { <span class="faint">"No host selected."</span> }.into_any(),
                        Some(h) if active.get() => view! { <ActiveHost host=h on_back=on_back /> }.into_any(),
                        Some(h) => view! { <SavedHost host=h on_back=on_back /> }.into_any(),
                    }}
                </div>
            </div>
        </div>
    }
}

#[component]
fn Head(
    #[prop(into)] name: String,
    #[prop(into)] eyebrow: Signal<String>,
    #[prop(optional, into)] status: MaybeProp<String>,
    on_back: Option<Callback<()>>,
    #[prop(optional)] children: Option<Children>,
) -> impl IntoView {
    view! {
        <div class="hd-head">
            {on_back.map(|b| view! {
                <button class="icon-btn" aria-label="Back" on:click=move |_| b.run(())>
                    <Icon ico=Ico::ArrowLeft size=18.0 />
                </button>
            })}
            <div class="hd-main">
                <span class="t-label">{move || eyebrow.get()}</span>
                <span class="t-display hd-title">{name}</span>
                {move || status.get().map(|s| view! {
                    <span class="hd-status"><span class="hdot online"></span><span class="muted">{s}</span></span>
                })}
            </div>
            {children.map(|c| view! { <div class="set-acts">{c()}</div> })}
        </div>
    }
}

#[component]
fn Card(#[prop(into)] title: String, children: Children) -> impl IntoView {
    view! {
        <Cut size=10.0 flip=true class="hd-card">
            <span class="hd-card-t">{title}</span>
            {children()}
        </Cut>
    }
}

#[component]
fn ActiveHost(host: Host, on_back: Option<Callback<()>>) -> impl IntoView {
    let app = crate::state::get();
    let hv = hostview::get();
    let hid = StoredValue::new(host.id.clone());
    let online = Memo::new(move |_| app.conn.active_link().conn == Conn::Online);
    let metrics = RwSignal::new(None::<Value>);
    let alive = StoredValue::new(true);
    on_cleanup(move || {
        let _ = alive.try_set_value(false);
    });
    let read = move || {
        let Ok(c) = config::need() else { return };
        spawn_local(async move {
            if let Ok(v) = ns(&c, "daemon.host.get_metrics.request", json!({})).await {
                if alive.try_get_value().unwrap_or(false) {
                    metrics.set(v.get("metrics").cloned());
                }
            }
        });
    };
    Effect::new(move |_| {
        if online.get() {
            read();
        } else {
            metrics.set(None);
        }
    });
    if let Ok(h) = set_interval_with_handle(
        move || {
            if alive.try_get_value().unwrap_or(false) && online.get_untracked() {
                read();
            }
        },
        std::time::Duration::from_millis(5000),
    ) {
        on_cleanup(move || h.clear());
    }
    let kind = host_kind(&host);
    let name = host.name.clone();
    let host_s = StoredValue::new(host);
    move || {
        if !online.get() {
            // Only the link's state re-renders the head; the offline banner stays mounted.
            let head_btn = move || {
                let link = app.conn.active_link();
                let err = last_error(&hid.get_value());
                let fixable = auth_refusal(err.as_ref()).is_none()
                    && identity_mismatch(err.as_ref()).is_none();
                let connecting = link.conn == Conn::Connecting;
                fixable.then(|| {
                    view! {
                        <Button
                            kind=ButtonKind::Primary
                            label=if connecting { "Retrying…" } else { "Retry" }
                            disabled=connecting
                            on_press=Callback::new(move |_| app.conn.activate(&hid.get_value()))
                        />
                    }
                })
            };
            return view! {
                <Head name=name.clone() eyebrow=format!("Host · {kind}") on_back=on_back>
                    {head_btn}
                </Head>
                <Offline host=host_s.get_value() />
            }
            .into_any();
        }
        let info = app.conn.client().and_then(|c| c.server_info());
        let version = info
            .as_ref()
            .and_then(|i| i.version_str().map(str::to_owned));
        let role = info
            .as_ref()
            .and_then(|i| i.caller_role.clone())
            .or_else(|| host_s.get_value().role);
        let owner = role.as_deref().map(|r| r == "owner").unwrap_or(true);
        let eyebrow = ["Host".to_owned(), kind.to_owned()]
            .into_iter()
            .chain(version.clone().map(|v| format!("v{v}")))
            .collect::<Vec<_>>()
            .join(" · ");
        let via = if kind == "Relay" {
            "Connected via relay"
        } else if here::over_tailscale(&host_s.get_value()) {
            "Connected over Tailscale"
        } else {
            "Connected directly"
        };
        let raw_info = info.as_ref().map(|i| i.raw.clone());
        let status = Signal::derive(move || {
            let m = metrics.get();
            format!(
                "{via}{}",
                m.map(|m| format!(
                    " · {} · {} · up {}",
                    config::s(&m, "platform"),
                    config::s(&m, "arch"),
                    fmt_uptime(
                        m.get("uptimeSeconds")
                            .and_then(Value::as_f64)
                            .unwrap_or(0.0) as u64
                    )
                ))
                .unwrap_or_default()
            )
        });
        let sessions = app.agents.list(Some(&hid.get_value())).len();
        let fp = host_s.get_value().fingerprint;
        let role_t = role.clone();
        view! {
            <Head name=name.clone() eyebrow=eyebrow status=status on_back=on_back>
                {owner.then(|| view! { <Button label="Pair a device" on_press=Callback::new(move |_| hv.open(HostDialog::PairDevice)) /> })}
                {owner.then(|| view! { <Button label="Restart daemon" on_press=Callback::new(move |_| restart_daemon()) /> })}
                <Button label="Edit" on_press=Callback::new(move |_| hv.open(HostDialog::Edit(hid.get_value()))) />
            </Head>
            <div class="hd-grid">
                <Card title="Load">
                    {move || match metrics.get() {
                        None => view! { <span class="muted">"Reading host metrics…"</span> }.into_any(),
                        Some(m) => {
                            let gb = |n: f64| format!("{:.1} GiB", n / 1024f64.powi(3));
                            let f = |p: &str| m.pointer(p).and_then(Value::as_f64);
                            let mem = f("/memory/usedBytes").zip(f("/memory/totalBytes"));
                            let disk = f("/disk/usedBytes").zip(f("/disk/totalBytes"));
                            view! {
                                <MeterLine label="CPU" pct=f("/cpu/usagePercent") detail=format!("{} cores", f("/cpu/cores").unwrap_or(0.0)) />
                                {mem.map(|(u, t)| view! { <MeterLine label="Memory" pct=Some(u / t * 100.0) detail=format!("{} / {}", gb(u), gb(t)) /> })}
                                {disk.map(|(u, t)| view! { <MeterLine label="Disk" pct=Some(u / t * 100.0) detail=format!("{} / {}", gb(u), gb(t)) /> })}
                                <span class="t-mono faint">
                                    {format!(
                                        "daemon pid {} · {} MiB · {sessions} sessions",
                                        f("/daemon/pid").unwrap_or(0.0),
                                        (f("/daemon/rssBytes").unwrap_or(0.0) / 1024f64.powi(2)).round()
                                    )}
                                </span>
                            }.into_any()
                        }
                    }}
                </Card>
                {owner.then(|| view! { <here::HereNow owner=owner role=role.clone() /> })}
                <Card title="Connections">
                    <Routes host_id=hid.get_value() />
                    {fp.map(|f| view! { <span class="t-mono faint">{format!("key {}…", f.chars().take(20).collect::<String>())}</span> })}
                </Card>
                <Card title="Daemon">
                    <span class="hd-strong">{version.clone().unwrap_or_else(|| "unknown version".to_owned())}</span>
                    <span class="muted">{role_t.map(|r| format!("This device is {} {r}.", if r.starts_with(['a', 'e', 'i', 'o', 'u']) { "an" } else { "a" })).unwrap_or_default()}</span>
                    {owner.then(|| view! { <HostUpdate version=version.clone() /> })}
                </Card>
                <here::TailscaleCard host=host_s.get_value() info=raw_info />
            </div>
        }
        .into_any()
    }
}

#[component]
fn MeterLine(
    #[prop(into)] label: String,
    pct: Option<f64>,
    #[prop(into)] detail: String,
) -> impl IntoView {
    view! {
        <div class="meter-line">
            <span class="meter-line-l">{label}</span>
            <Meter pct=pct />
            <span class="t-mono faint">{detail}</span>
        </div>
    }
}

#[component]
fn SavedHost(host: Host, on_back: Option<Callback<()>>) -> impl IntoView {
    let app = crate::state::get();
    let hv = hostview::get();
    let id = StoredValue::new(host.id.clone());
    let link = Memo::new(move |_| app.conn.link(&id.get_value()));
    let count = Memo::new(move |_| app.agents.list(Some(&id.get_value())).len());
    let last = host.last_online_at.as_deref().map(config::ago);
    let mismatch = identity_mismatch(last_error(&host.id).as_ref());
    let status = move || {
        let last = last.clone();
        let l = link.get();
        match l.conn {
            Conn::Online => format!("Connected in the background · {} sessions.", count.get()),
            Conn::Connecting => "Connecting…".to_owned(),
            Conn::Offline => format!(
                "Can't reach it right now{}. {}",
                last.map(|l| format!("; last connected {l}"))
                    .unwrap_or_default(),
                if l.paused {
                    "Frogg stopped retrying; switch to it to try again."
                } else {
                    "Frogg keeps retrying."
                }
            ),
        }
    };
    view! {
        <Head name=host.name.clone() eyebrow=format!("Host · {}", host_kind(&host)) on_back=on_back>
            <Button
                kind=ButtonKind::Primary
                label="Switch to this host"
                on_press=Callback::new(move |_| {
                    hv.view(None, false);
                    app.conn.activate(&id.get_value());
                })
            />
        </Head>
        {mismatch.map(|(e, a)| view! {
            <div class="hd-banner warn">
                <Icon ico=Ico::AlertTriangle size=18.0 class="amber" />
                <div class="hd-banner-text">
                    <span class="hd-strong">{format!("A different Frogg daemon is answering at {}", host.endpoint)}</span>
                    <span class="muted t-mono">{format!("saved {e} · answering {a}")}</span>
                </div>
            </div>
        })}
        <div class="hd-grid">
            <Card title="Connections">
                <Routes host_id=host.id.clone() />
                <span class="muted">{status}</span>
                {host.role.clone().map(|r| view! { <span class="muted">{format!("Paired as {r}.")}</span> })}
                <div class="set-acts">
                    <Button label="Edit host…" on_press=Callback::new(move |_| hv.open(HostDialog::Edit(id.get_value()))) />
                    <Button kind=ButtonKind::Danger label="Remove host…" on_press=Callback::new(move |_| hv.open(HostDialog::Remove(id.get_value()))) />
                </div>
            </Card>
        </div>
    }
}

/// The Hosts tool's own dialogs: edit, remove, pair a device.
#[component]
fn HostDialogs() -> impl IntoView {
    let hv = hostview::get();
    let app = crate::state::get();
    let pairing = Memo::new(move |_| hv.dialog.get() == Some(HostDialog::PairDevice));
    let open = Signal::derive(move || hv.dialog.get().is_some() && !pairing.get());
    let close = Callback::new(move |_| hv.close());
    let title = move || match hv.dialog.get() {
        Some(HostDialog::Edit(_)) => "Edit host",
        Some(HostDialog::Remove(_)) => "Remove host",
        _ => "",
    };
    let host_name = move || {
        app.hosts
            .active()
            .map(|h| h.name)
            .unwrap_or_else(|| "host".into())
    };
    view! {
        <Sheet open=open on_close=close width=520.0>
            <div class="sheet-head">
                <span class="t-display sheet-title">{title}</span>
                <button class="icon-btn" aria-label="Close" on:click=move |_| hv.close()>
                    <Icon ico=Ico::X size=16.0 />
                </button>
            </div>
            {move || match hv.dialog.get() {
                Some(HostDialog::Edit(id)) => view! { <EditHost id=id /> }.into_any(),
                Some(HostDialog::Remove(id)) => view! { <RemoveHost id=id /> }.into_any(),
                _ => ().into_any(),
            }}
        </Sheet>
        <Sheet open=pairing on_close=close width=740.0>
            <div class="sheet-head">
                <span class="sheet-titles">
                    <span class="t-label">{move || format!("{} · devices", host_name())}</span>
                    <span class="t-display sheet-title">"Pair a device"</span>
                </span>
                <button class="icon-btn" aria-label="Close" on:click=move |_| hv.close()>
                    <Icon ico=Ico::X size=16.0 />
                </button>
            </div>
            <Show when=move || pairing.get()>
                <pair::PairDevice />
            </Show>
        </Sheet>
    }
}

#[component]
fn EditHost(id: String) -> impl IntoView {
    let app = crate::state::get();
    let hv = hostview::get();
    let Some(h) = app.hosts.find_untracked(&id) else {
        return view! { <span class="muted">"This host is gone."</span> }.into_any();
    };
    let name = RwSignal::new(h.name.clone());
    let address = RwSignal::new(h.endpoint.clone());
    let password = RwSignal::new(String::new());
    let tls = RwSignal::new(h.tls == Some(true));
    let error = RwSignal::new(None::<String>);
    let relay = h.is_relay();
    let id = StoredValue::new(id);
    let save = Callback::new(move |_| {
        let n = name.get_untracked().trim().to_owned();
        let endpoint = if relay {
            None
        } else {
            match parse_host_address(&address.get_untracked()) {
                Some((e, _)) => Some(e),
                None => {
                    error.set(Some("Enter host:port, e.g. 192.168.1.20:6767".to_owned()));
                    return;
                }
            }
        };
        let pw = password.get_untracked();
        let t = tls.get_untracked();
        let updated = app.hosts.update(&id.get_value(), |host| {
            if !n.is_empty() {
                host.name = n;
            }
            if let Some(e) = endpoint {
                host.endpoint = e;
                host.tls = t.then_some(true);
            }
            if !pw.is_empty() {
                host.password = Some(pw);
            }
        });
        if updated.is_some() {
            if app.hosts.active_id.get_untracked().as_deref() == Some(id.get_value().as_str()) {
                app.conn.activate(&id.get_value());
            }
            hv.close();
        }
    });
    view! {
        <div class="dlg-form">
            <label class="field"><span class="t-label">"Name"</span><Input value=name autofocus=true on_enter=save /></label>
            {(!relay).then(|| view! {
                <label class="field">
                    <span class="t-label">"Address"</span>
                    <Input value=address mono=true on_enter=save />
                </label>
                <label class="dlg-check">
                    <input type="checkbox" prop:checked=move || tls.get() on:change=move |ev| tls.set(event_target_checked(&ev)) />
                    <span>"Use TLS (wss://)"</span>
                </label>
            })}
            <label class="field">
                <span class="t-label">"Daemon password"</span>
                <Input value=password password=true mono=true placeholder=if h.password.is_some() { "saved; type to replace" } else { "only if the daemon asks for one" } on_enter=save />
            </label>
            <ErrorLine text=error />
            <div class="set-acts end">
                <Button label="Cancel" on_press=Callback::new(move |_| hv.close()) />
                <Button kind=ButtonKind::Primary label="Save" on_press=save />
            </div>
        </div>
    }
    .into_any()
}

#[component]
fn RemoveHost(id: String) -> impl IntoView {
    let app = crate::state::get();
    let hv = hostview::get();
    let name = app
        .hosts
        .find_untracked(&id)
        .map(|h| h.name)
        .unwrap_or_else(|| "this host".to_owned());
    let id = StoredValue::new(id);
    view! {
        <div class="dlg-form">
            <span class="muted">
                {format!("Forget {name} on this device? The daemon keeps running, and its sessions keep going. Add it again any time with its address or a pairing code.")}
            </span>
            <div class="set-acts end">
                <Button label="Cancel" on_press=Callback::new(move |_| hv.close()) />
                <Button
                    kind=ButtonKind::Danger
                    label="Remove host"
                    on_press=Callback::new(move |_| {
                        let rid = id.get_value();
                        if hv.view_id.get_untracked().as_deref() == Some(rid.as_str()) {
                            hv.view(None, false);
                        }
                        app.hosts.remove(&rid);
                        hv.close();
                    })
                />
            </div>
        </div>
    }
}
