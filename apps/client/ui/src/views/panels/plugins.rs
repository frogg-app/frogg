//! Plugins (ui-next `PluginsPanel.tsx`, `daemon/plugins.ts`): installed plugins with enable /
//! update / uninstall, the catalog with a permission confirm before install, and plugin sources.

use leptos::prelude::*;
use leptos::task::spawn_local;
use serde::Serialize;
use serde_json::Value;

use super::util::{Ask, Confirm};
use crate::components::{Button, ButtonKind, Ico, Icon, Seg, Select, SelectOption, TextInput};
use crate::shell::panel_head::PanelHead;
use crate::state::checkout::online;
use crate::state::{self};

fn val<T: Serialize>(r: frogg_client_core::Result<T>) -> Result<Value, String> {
    let v = r
        .map_err(|e| e.to_string())
        .and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string()))?;
    match &v["error"] {
        Value::String(s) => Err(s.clone()),
        Value::Object(o) => Err(o
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("failed")
            .to_owned()),
        _ => Ok(v),
    }
}

#[derive(Clone, Copy)]
struct Lists {
    installed: RwSignal<Option<Vec<Value>>>,
    policy: RwSignal<Value>,
    catalog: RwSignal<Option<Vec<Value>>>,
    repos: RwSignal<Option<Vec<Value>>>,
    error: RwSignal<Option<String>>,
    busy: RwSignal<Option<String>>,
}

impl Lists {
    fn load_installed(self) {
        let Some(c) = state::get().conn.client() else {
            return;
        };
        spawn_local(async move {
            match val(c.plugins_list().await) {
                Ok(v) => {
                    self.installed
                        .set(Some(v["plugins"].as_array().cloned().unwrap_or_default()));
                    self.policy.set(v["policy"].clone());
                }
                Err(e) => self.error.set(Some(e)),
            }
        });
    }

    fn load_catalog(self, refresh: bool) {
        let Some(c) = state::get().conn.client() else {
            return;
        };
        spawn_local(async move {
            match val(c.plugins_get_catalog(refresh).await) {
                Ok(v) => self
                    .catalog
                    .set(Some(v["plugins"].as_array().cloned().unwrap_or_default())),
                Err(e) => {
                    self.catalog.set(Some(Vec::new()));
                    self.error.set(Some(e));
                }
            }
        });
    }

    fn load_repos(self) {
        let Some(c) = state::get().conn.client() else {
            return;
        };
        spawn_local(async move {
            match val(c.plugins_repos_list().await) {
                Ok(v) => self
                    .repos
                    .set(Some(v["repos"].as_array().cloned().unwrap_or_default())),
                Err(e) => self.error.set(Some(e)),
            }
        });
    }

    /// Runs an action for one plugin, then reloads the lists.
    fn act<F, Fut>(self, id: String, f: F)
    where
        F: FnOnce(frogg_client_core::DaemonClient) -> Fut + 'static,
        Fut: std::future::Future<Output = Result<Value, String>> + 'static,
    {
        let Some(c) = state::get().conn.client() else {
            return;
        };
        self.busy.set(Some(id));
        self.error.set(None);
        spawn_local(async move {
            if let Err(e) = f(c).await {
                self.error.set(Some(e));
            }
            self.busy.set(None);
            self.load_installed();
            if self.catalog.with_untracked(|c| c.is_some()) {
                self.load_catalog(false);
            }
        });
    }
}

fn s(v: &Value, k: &str) -> String {
    v[k].as_str().unwrap_or_default().to_owned()
}

#[component]
pub fn PluginsPanel() -> impl IntoView {
    let l = Lists {
        installed: RwSignal::new(None),
        policy: RwSignal::new(Value::Null),
        catalog: RwSignal::new(None),
        repos: RwSignal::new(None),
        error: RwSignal::new(None),
        busy: RwSignal::new(None),
    };
    let tab = RwSignal::new("installed".to_owned());
    let query = RwSignal::new(String::new());
    let ask = RwSignal::new(None::<Ask>);
    Effect::new(move |_| {
        if online() {
            l.load_installed();
        }
    });
    Effect::new(move |_| match tab.get().as_str() {
        "browse" if l.catalog.with_untracked(|c| c.is_none()) => l.load_catalog(false),
        "sources" => l.load_repos(),
        _ => {}
    });
    // Live: the host announces plugin changes.
    if let Some(c) = state::get().conn.client() {
        let id = c.subscribe(move |e| {
            if let frogg_client_core::Event::Session(f) = e {
                if f.kind == "plugins.changed" {
                    l.load_installed();
                }
            }
        });
        let c = leptos::__reexports::send_wrapper::SendWrapper::new(c);
        on_cleanup(move || c.unsubscribe(id));
    }
    let refresh = move |_| {
        l.error.set(None);
        l.load_installed();
        match tab.get_untracked().as_str() {
            "browse" => l.load_catalog(true),
            "sources" => l.load_repos(),
            _ => {}
        }
    };
    let tabs = move || {
        let n = l.installed.with(|i| i.as_ref().map(|i| i.len()));
        vec![
            (
                "installed".to_owned(),
                n.map(|n| format!("Installed {n}"))
                    .unwrap_or_else(|| "Installed".into()),
            ),
            ("browse".to_owned(), "Browse".to_owned()),
            ("sources".to_owned(), "Sources".to_owned()),
        ]
    };
    let off = move || l.policy.with(|p| p["enabled"] == false);
    view! {
        <div class="panel pn">
            <PanelHead title="Plugins">
                <button class="icon-btn" aria-label="Refresh" on:click=refresh>
                    <Icon ico=Ico::RefreshCw size=14.0 class="faint" />
                </button>
            </PanelHead>
            <div class="pn-views">
                {move || view! { <Seg options=tabs() value=tab on_change=Callback::new(move |v| tab.set(v)) /> }}
            </div>
            {move || (tab.get() == "browse").then(|| view! {
                <div class="pn-search pn-search-pad">
                    <Icon ico=Ico::Search size=13.0 class="faint" />
                    <TextInput value=query placeholder="Search plugins" />
                </div>
            })}
            <div class="panel-scroll pn-usage">
                {move || l.error.get().map(|e| view! { <span class="pn-error-inline t-mono">{e}</span> })}
                {move || off().then(|| view! { <span class="faint">"Plugins are turned off for this build."</span> })}
                {move || match tab.get().as_str() {
                    "installed" => view! { <Installed l=l ask=ask /> }.into_any(),
                    "browse" => view! { <Browse l=l ask=ask query=query /> }.into_any(),
                    _ => view! { <Sources l=l ask=ask /> }.into_any(),
                }}
            </div>
            <Confirm ask=ask />
        </div>
    }
}

/// Capabilities that let an outside identity drive agents: granted like any other but inert
/// until the host owner turns remote control on (protocol `PLUGIN_REMOTE_CONTROL_CAPABILITIES`).
const REMOTE_CONTROL_CAPS: [&str; 3] = ["agent.manage", "agent.permissions", "todos.write"];

fn is_remote_control(c: &str) -> bool {
    REMOTE_CONTROL_CAPS.contains(&c)
}

/// Plain-English capability names (ui-next `daemon/plugins.ts`).
fn describe_capability(c: &str) -> String {
    match c {
        "network" => "Make network requests",
        "filesystem.workspace" => "Read and write files in workspaces",
        "process.spawn" => "Run programs on the host",
        "agent.read" => "Read agent sessions and their events",
        "agent.write" => "Send messages to agents",
        "settings.store" => "Store its own settings",
        "ui.contribute" => "Add commands, buttons and panels",
        "rpc" => "Answer requests from the app",
        "ui.view" => "Show its own views in the app",
        "media.microphone" => "Use the microphone",
        "media.audio" => "Play audio",
        "composer" => "Add composer buttons and insert text",
        "speech" => "Use the host's speech recognition and voices",
        "agent.manage" => "Start, stop and archive agents",
        "agent.permissions" => "Approve or deny agents' permission requests",
        "workspaces.read" => "See projects and workspaces",
        "todos.read" => "Read project to-dos",
        "todos.write" => "Create and update project to-dos",
        "ui.external" => "Open links in your browser",
        other => other,
    }
    .to_owned()
}

/// A consent line: the capability, flagged when it only works with remote control on.
fn capability_line(c: &str, forbidden: bool) -> String {
    if !is_remote_control(c) {
        return format!("· {}", describe_capability(c));
    }
    let note = if forbidden {
        "remote control is off for this build"
    } else {
        "off until you turn on remote control"
    };
    format!("· {} ({note})", describe_capability(c))
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|c| c.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

#[component]
fn Installed(l: Lists, ask: RwSignal<Option<Ask>>) -> impl IntoView {
    move || {
        let Some(list) = l.installed.get() else {
            return view! { <span class="t-label">"Loading plugins…"</span> }.into_any();
        };
        if list.is_empty() {
            return view! { <span class="faint">"No plugins installed. Browse the catalog to add one."</span> }.into_any();
        }
        list.into_iter()
            .map(|p| view! { <InstalledRow l=l ask=ask p=p /> })
            .collect_view()
            .into_any()
    }
}

/// One installed plugin: enable, granted capabilities, remote control, panels, update,
/// unlink or uninstall (ui-next `tools/PluginInstalled.tsx`).
#[component]
fn InstalledRow(l: Lists, ask: RwSignal<Option<Ask>>, p: Value) -> impl IntoView {
    let id = s(&p, "id");
    let name = s(&p, "name");
    let enabled = p["enabled"].as_bool().unwrap_or(false);
    let busy = {
        let id = id.clone();
        Signal::derive(move || l.busy.get().as_deref() == Some(id.as_str()))
    };
    let forbidden = l
        .policy
        .with_untracked(|p| p["remoteControl"] == "forbidden");
    let update = p["updateAvailable"].as_str().map(str::to_owned);
    let is_dev = p["source"] == "dev" || p["devPath"].as_str().is_some();
    let preinstalled = p["preinstalled"].as_bool().unwrap_or(false);
    let granted = strings(&p["grantedCapabilities"]);
    let remote = p["remoteControl"].as_bool();
    let wants_remote = remote.is_some() && granted.iter().any(|c| is_remote_control(c));
    let remote_on = remote == Some(true);
    let api = p["apiVersion"].as_f64().unwrap_or(1.0);
    let status = s(&p, "status");
    let has_error = p["error"].is_string();
    let panels = RwSignal::new(false);
    let toggle_enabled = {
        let id = id.clone();
        move |_| {
            let id = id.clone();
            l.act(id.clone(), move |c| async move {
                val(c.plugins_set_enabled(&id, !enabled).await)
            })
        }
    };
    let toggle_remote = {
        let id = id.clone();
        move |_| {
            let id = id.clone();
            l.act(id.clone(), move |c| async move {
                val(c.plugins_set_remote_control(&id, !remote_on).await)
            })
        }
    };
    // An update that asks for more than was granted goes back through consent: the new
    // capabilities come from the catalog's latest version.
    let on_update = {
        let (id, name, granted, version) =
            (id.clone(), name.clone(), granted.clone(), update.clone());
        Callback::new(move |_| {
            let (id, name, granted, version) =
                (id.clone(), name.clone(), granted.clone(), version.clone());
            let Some(c) = state::get().conn.client() else {
                return;
            };
            l.busy.set(Some(id.clone()));
            l.error.set(None);
            spawn_local(async move {
                let r = c.plugins_update(&id, None, None).await;
                let consent = matches!(&r, Err(frogg_client_core::Error::Rpc { code: Some(code), .. }) if code == "consent_required");
                l.busy.set(None);
                if !consent {
                    if let Err(e) = val(r) {
                        l.error.set(Some(e));
                    }
                    l.load_installed();
                    return;
                }
                let latest = val(c.plugins_get_catalog(false).await)
                    .ok()
                    .and_then(|v| {
                        v["plugins"]
                            .as_array()?
                            .iter()
                            .find(|x| x["id"] == id.as_str())
                            .map(|x| strings(&x["latest"]["capabilities"]))
                    })
                    .unwrap_or_default();
                let added: Vec<String> = latest
                    .into_iter()
                    .filter(|c| !granted.contains(c))
                    .collect();
                let body = format!(
                    "Version {} asks for more:\n{}",
                    version.clone().unwrap_or_else(|| "latest".into()),
                    if added.is_empty() {
                        "· New permissions (the catalog doesn't list them)".to_owned()
                    } else {
                        added
                            .iter()
                            .map(|c| capability_line(c, forbidden))
                            .collect::<Vec<_>>()
                            .join("\n")
                    }
                );
                let mut all = granted.clone();
                all.extend(added.into_iter().filter(|c| !granted.contains(c)));
                ask.set(Some(Ask::new(
                    format!("Update {name}?"),
                    body,
                    "Grant and update",
                    move || {
                        let (id, all) = (id.clone(), all.clone());
                        l.act(id.clone(), move |c| async move {
                            val(c.plugins_update(&id, None, Some(&all)).await)
                        })
                    },
                )));
            });
        })
    };
    let on_unlink = {
        let id = id.clone();
        Callback::new(move |_| {
            let id = id.clone();
            l.act(id.clone(), move |c| async move {
                val(c.plugins_dev_unlink(&id).await)
            })
        })
    };
    let on_uninstall = {
        let (id, n) = (id.clone(), name.clone());
        Callback::new(move |_| {
            let id = id.clone();
            ask.set(Some(
                Ask::new(
                    format!("Uninstall {n}?"),
                    format!("{n} and its stored settings will be removed from this host."),
                    "Uninstall",
                    move || {
                        let id = id.clone();
                        l.act(id.clone(), move |c| async move {
                            val(c.plugins_uninstall(&id).await)
                        })
                    },
                )
                .danger(),
            ))
        })
    };
    let pid = id.clone();
    view! {
        <div class="pn-ucard pn-plugin cut flip" style="--c:10px">
            <div class="pn-ucard-head">
                <Icon ico=Ico::Puzzle size=15.0 class=if enabled { "violet" } else { "faint" } />
                <span class="pn-ucard-name pn-grow">{name.clone()}</span>
                <button
                    class="pn-toggle"
                    class:on=enabled
                    role="switch"
                    aria-checked=enabled.to_string()
                    aria-label=format!("{} {name}", if enabled { "Disable" } else { "Enable" })
                    disabled=move || busy.get()
                    on:click=toggle_enabled
                >
                    <span></span>
                </button>
            </div>
            {p["description"].as_str().map(|d| view! { <span class="pn-card-desc pn-flush">{d.to_owned()}</span> })}
            <div class="pn-plugin-pills">
                <span class="t-mono pn-small">{format!("v{}", s(&p, "version"))}</span>
                {(api > 1.0).then(|| view! { <span class="pn-pill t-mono cyan2">{format!("api v{api}")}</span> })}
                {is_dev.then(|| view! { <span class="pn-pill t-mono amber">"dev link"</span> })}
                {preinstalled.then(|| view! { <span class="pn-pill t-mono">"built in"</span> })}
                {update.clone().map(|u| view! { <span class="pn-pill t-mono cyan2">{format!("update {u}")}</span> })}
                {(status != "active" && status != "ok" && !status.is_empty()).then(|| view! {
                    <span class="pn-pill t-mono" class:coral=has_error>{status.clone()}</span>
                })}
            </div>
            {(!granted.is_empty()).then(|| view! {
                <div class="pn-caps">
                    {granted.iter().map(|c| {
                        let rc = is_remote_control(c);
                        let live = !rc || remote_on;
                        view! {
                            <div class="pn-cap" class:off=!live>
                                <i class="pn-cap-dot" class:remote=rc></i>
                                <span>{describe_capability(c)}</span>
                            </div>
                        }
                    }).collect_view()}
                </div>
            })}
            {wants_remote.then(|| view! {
                <div class="pn-remote">
                    <div class="pn-ucard-head">
                        <Icon ico=Ico::Radio size=14.0 class=if remote_on { "amber" } else { "faint" } />
                        <span class="pn-ucard-name pn-grow">"Remote control"</span>
                        <button
                            class="pn-toggle"
                            class:on=remote_on
                            role="switch"
                            aria-checked=remote_on.to_string()
                            aria-label="Remote control"
                            disabled=move || busy.get() || forbidden
                            on:click=toggle_remote
                        >
                            <span></span>
                        </button>
                    </div>
                    <span class="pn-remote-hint">
                        {if forbidden {
                            "Remote control is turned off for this build."
                        } else {
                            "Lets this plugin start agents, answer permission requests, change to-dos and send messages for people outside Frogg. Only turn it on if you trust everyone the plugin lets in."
                        }}
                    </span>
                </div>
            })}
            <div class="pn-sync">
                <Button
                    label=Signal::derive(move || if panels.get() { "Close panels".to_owned() } else { "Open panels".to_owned() })
                    disabled=!enabled
                    on_press=Callback::new(move |_| panels.update(|v| *v = !*v))
                />
                {(update.is_some() && !is_dev).then(|| view! {
                    <Button kind=ButtonKind::Primary label="Update" disabled=busy on_press=on_update />
                })}
                {is_dev.then(|| view! { <Button label="Unlink" disabled=busy on_press=on_unlink /> })}
                {(!is_dev && !preinstalled).then(|| view! {
                    <Button kind=ButtonKind::Danger label="Uninstall…" disabled=busy on_press=on_uninstall />
                })}
            </div>
            {move || panels.get().then(|| view! { <PluginPanels plugin_id=pid.clone() /> })}
            {p["error"].as_str().map(|e| view! { <span class="pn-error-inline t-mono">{e.to_owned()}</span> })}
        </div>
    }
}

/// The plugin's declarative panels: each renders through `panel.<id>.render` as markdown, a
/// list or a form (submitted to `panel.<id>.submit`) (ui-next `tools/PluginPanels.tsx`).
#[component]
fn PluginPanels(plugin_id: String) -> impl IntoView {
    let panels = LocalResource::new({
        let id = plugin_id.clone();
        move || {
            let id = id.clone();
            async move {
                let c = state::get().conn.client().ok_or("Host is not connected.")?;
                let v = val(c.plugins_get_contributions().await)?;
                Ok::<Vec<Value>, String>(
                    v["contributions"]
                        .as_array()
                        .and_then(|a| a.iter().find(|c| c["pluginId"] == id.as_str()))
                        .and_then(|c| c["panels"].as_array().cloned())
                        .unwrap_or_default(),
                )
            }
        }
    });
    let pid = StoredValue::new(plugin_id);
    view! {
        <div class="pn-plugin-panels">
            {move || match panels.get() {
                None => view! { <span class="faint">"Loading panels…"</span> }.into_any(),
                Some(Err(e)) => view! { <span class="pn-error-inline t-mono">{e}</span> }.into_any(),
                Some(Ok(list)) if list.is_empty() => view! {
                    <span class="faint">"This plugin contributes no declarative panels."</span>
                }
                .into_any(),
                Some(Ok(list)) => list
                    .into_iter()
                    .map(|p| view! { <PluginPanel plugin_id=pid.get_value() id=s(&p, "id") title=s(&p, "title") /> })
                    .collect_view()
                    .into_any(),
            }}
        </div>
    }
}

async fn plugin_rpc(
    plugin_id: String,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    let c = state::get().conn.client().ok_or("Host is not connected.")?;
    let v = val(c.plugins_rpc_call(&plugin_id, &method, params).await)?;
    Ok(v["result"].clone())
}

#[component]
fn PluginPanel(plugin_id: String, id: String, title: String) -> impl IntoView {
    let content = RwSignal::new(None::<Value>);
    let error = RwSignal::new(None::<String>);
    let ids = StoredValue::new((plugin_id, id));
    let load = move || {
        error.set(None);
        let (p, i) = ids.get_value();
        spawn_local(async move {
            match plugin_rpc(p, format!("panel.{i}.render"), None).await {
                Ok(v) if matches!(v["kind"].as_str(), Some("markdown" | "list" | "form")) => {
                    let _ = content.try_set(Some(v));
                }
                Ok(_) => {
                    let _ = error.try_set(Some(
                        "Plugin returned an unsupported panel response.".into(),
                    ));
                }
                Err(e) => {
                    let _ = error.try_set(Some(e));
                }
            }
        });
    };
    load();
    view! {
        <div class="pn-plugin-panel">
            <div class="pn-ucard-head">
                <span class="pn-ucard-name pn-grow">{title}</span>
                <Button label="Refresh panel" on_press=Callback::new(move |_| load()) />
            </div>
            {move || error.get().map(|e| view! { <span class="pn-error-inline t-mono">{e}</span> })}
            {move || {
                let Some(v) = content.get() else {
                    return error.with(Option::is_none).then(|| view! { <span class="faint">"Loading…"</span> }.into_any());
                };
                Some(match v["kind"].as_str().unwrap_or_default() {
                    "markdown" => {
                        let md = s(&v, "markdown");
                        view! { <frogg_render::Markdown text=md on_link=Callback::new(|u: String| crate::native::open_external(&u)) /> }.into_any()
                    }
                    "list" => {
                        let items = v["items"].as_array().cloned().unwrap_or_default();
                        if items.is_empty() {
                            let empty = v["emptyText"].as_str().unwrap_or("No items.").to_owned();
                            view! { <span class="faint">{empty}</span> }.into_any()
                        } else {
                            items
                                .into_iter()
                                .map(|item| view! { <PanelItem plugin_id=ids.get_value().0 item=item reload=Callback::new(move |_| load()) /> })
                                .collect_view()
                                .into_any()
                        }
                    }
                    _ => {
                        let fields = v["fields"].as_array().cloned().unwrap_or_default();
                        let label = v["submitLabel"].as_str().unwrap_or("Save").to_owned();
                        let (p, i) = ids.get_value();
                        view! {
                            <PluginForm
                                fields=fields
                                initial=v["values"].clone()
                                label=label
                                submit=Callback::new(move |values: Value| {
                                    let (p, i) = (p.clone(), i.clone());
                                    Box::pin(async move {
                                        plugin_rpc(p, format!("panel.{i}.submit"), Some(serde_json::json!({ "values": values }))).await.map(|_| ())
                                    }) as SubmitFuture
                                })
                            />
                        }
                        .into_any()
                    }
                })
            }}
        </div>
    }
}

fn http_url(u: &str) -> bool {
    let l = u.to_ascii_lowercase();
    l.starts_with("http://") || l.starts_with("https://")
}

#[component]
fn PanelItem(plugin_id: String, item: Value, reload: Callback<()>) -> impl IntoView {
    let error = RwSignal::new(None::<String>);
    let busy = RwSignal::new(false);
    let action = item["action"].clone();
    let url = item["url"]
        .as_str()
        .filter(|u| http_url(u))
        .map(str::to_owned);
    let can = !action.is_null() || url.is_some();
    let run = move |_| {
        if busy.get_untracked() {
            return;
        }
        if action.is_null() {
            if let Some(u) = &url {
                crate::native::open_external(u);
            }
            return;
        }
        busy.set(true);
        error.set(None);
        let (p, a) = (plugin_id.clone(), action.clone());
        spawn_local(async move {
            let r = plugin_rpc(
                p,
                s(&a, "method"),
                (!a["params"].is_null()).then(|| a["params"].clone()),
            )
            .await;
            let _ = busy.try_set(false);
            match r {
                Ok(_) => reload.run(()),
                Err(e) => {
                    let _ = error.try_set(Some(e));
                }
            }
        });
    };
    view! {
        <div class="pn-plugin-item">
            <div class="pn-plugin-item-text">
                <span>{s(&item, "title")}</span>
                {item["subtitle"].as_str().map(|t| view! { <span class="t-mono pn-small faint">{t.to_owned()}</span> })}
            </div>
            {item["badge"].as_str().map(|b| view! { <span class="pn-pill t-mono">{b.to_owned()}</span> })}
            {can.then(|| view! {
                <Button
                    label=Signal::derive(move || if busy.get() { "Opening…".to_owned() } else { "Open".to_owned() })
                    disabled=busy
                    on_press=Callback::new(run.clone())
                />
            })}
            {move || error.get().map(|e| view! { <span class="pn-error-inline t-mono">{e}</span> })}
        </div>
    }
}

type SubmitFuture = std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>>>>;

/// A plugin-declared form: text, secret, number, boolean and select fields, required and number
/// checks, then submit (ui-next `tools/PluginForm.tsx`).
#[component]
fn PluginForm(
    fields: Vec<Value>,
    initial: Value,
    label: String,
    submit: Callback<Value, SubmitFuture>,
) -> impl IntoView {
    let values = RwSignal::new(
        fields
            .iter()
            .map(|f| {
                let k = s(f, "key");
                let v = if !initial[&k].is_null() {
                    initial[&k].clone()
                } else if !f["default"].is_null() {
                    f["default"].clone()
                } else if f["type"] == "boolean" {
                    Value::Bool(false)
                } else {
                    Value::String(String::new())
                };
                (k, v)
            })
            .collect::<serde_json::Map<String, Value>>(),
    );
    let busy = RwSignal::new(false);
    let error = RwSignal::new(None::<String>);
    let saved = RwSignal::new(false);
    let fields = StoredValue::new(fields);
    let save = move |_| {
        if busy.get_untracked() {
            return;
        }
        let mut out = values.get_untracked();
        for f in fields.get_value() {
            let k = s(&f, "key");
            let v = out.get(&k).cloned().unwrap_or(Value::Null);
            let empty = v.is_null() || v == "";
            if f["required"].as_bool().unwrap_or(false) && empty {
                error.set(Some(format!("{} is required.", s(&f, "title"))));
                return;
            }
            if f["type"] == "number" && !empty {
                let n = v
                    .as_f64()
                    .or_else(|| v.as_str().and_then(|t| t.trim().parse::<f64>().ok()))
                    .filter(|n| n.is_finite());
                match n {
                    Some(n) => {
                        out.insert(k, serde_json::json!(n));
                    }
                    None => {
                        error.set(Some(format!("{} must be a number.", s(&f, "title"))));
                        return;
                    }
                }
            }
        }
        busy.set(true);
        error.set(None);
        saved.set(false);
        let fut = submit.run(Value::Object(out));
        spawn_local(async move {
            let r = fut.await;
            let _ = busy.try_set(false);
            match r {
                Ok(()) => {
                    let _ = saved.try_set(true);
                }
                Err(e) => {
                    let _ = error.try_set(Some(e));
                }
            }
        });
    };
    view! {
        <div class="pn-plugin-form">
            {fields.get_value().into_iter().map(|f| {
                let k = s(&f, "key");
                let title = format!("{}{}", s(&f, "title"), if f["required"].as_bool().unwrap_or(false) { " *" } else { "" });
                let ty = s(&f, "type");
                let set = {
                    let k = k.clone();
                    move |v: Value| {
                        values.update(|m| {
                            m.insert(k.clone(), v);
                        });
                        saved.set(false);
                    }
                };
                let get = {
                    let k = k.clone();
                    move || values.with(|m| m.get(&k).cloned().unwrap_or(Value::Null))
                };
                let control = match ty.as_str() {
                    "boolean" => {
                        let get2 = get.clone();
                        view! {
                            <button
                                class="pn-toggle"
                                class:on=move || get2() == Value::Bool(true)
                                role="switch"
                                aria-label=s(&f, "title")
                                on:click=move |_| set(Value::Bool(get() != Value::Bool(true)))
                            >
                                <span></span>
                            </button>
                        }
                        .into_any()
                    }
                    "select" => {
                        let options = f["options"]
                            .as_array()
                            .map(|o| o.iter().map(|x| SelectOption::new(s(x, "value"), s(x, "label"))).collect())
                            .unwrap_or_default();
                        view! {
                            <Select
                                options=options
                                value=Signal::derive(move || get().as_str().unwrap_or_default().to_owned())
                                on_change=Callback::new(move |v: String| set(Value::String(v)))
                            />
                        }
                        .into_any()
                    }
                    _ => view! {
                        <input
                            class="input"
                            aria-label=s(&f, "title")
                            type=if ty == "secret" { "password" } else { "text" }
                            inputmode=if ty == "number" { "decimal" } else { "text" }
                            autocapitalize="off"
                            prop:value=move || match get() {
                                Value::String(t) => t,
                                Value::Null => String::new(),
                                other => other.to_string(),
                            }
                            on:input=move |e| set(Value::String(event_target_value(&e)))
                        />
                    }
                    .into_any(),
                };
                view! {
                    <label class="pn-plugin-field">
                        <span>{title}</span>
                        {f["description"].as_str().map(|d| view! { <span class="t-mono pn-small faint">{d.to_owned()}</span> })}
                        {control}
                    </label>
                }
            }).collect_view()}
            {move || error.get().map(|e| view! { <span class="pn-error-inline t-mono">{e}</span> })}
            {move || saved.get().then(|| view! { <span class="mint pn-small">"Saved."</span> })}
            <Button
                label=Signal::derive(move || if busy.get() { "Saving…".to_owned() } else { label.clone() })
                disabled=busy
                on_press=Callback::new(save)
            />
        </div>
    }
}

/// Why a listed plugin has no version this host can load.
fn incompatible(p: &Value) -> String {
    let api = p["versions"]
        .as_array()
        .map(|v| {
            v.iter()
                .filter_map(|x| x["apiVersion"].as_f64())
                .fold(0.0f64, f64::max)
        })
        .unwrap_or(0.0);
    if api > 0.0 {
        format!("needs a newer host (plugin API v{api})")
    } else {
        "no compatible version".into()
    }
}

#[component]
fn Browse(l: Lists, ask: RwSignal<Option<Ask>>, query: RwSignal<String>) -> impl IntoView {
    move || {
        let forbidden = l.policy.with(|p| p["remoteControl"] == "forbidden");
        let Some(list) = l.catalog.get() else {
            return view! { <span class="t-label">"loading catalog…"</span> }.into_any();
        };
        if list.is_empty() {
            return view! { <span class="faint">"No plugin sources configured."</span> }.into_any();
        }
        let q = query.get().to_lowercase();
        list.into_iter()
            .filter(|p| format!("{} {} {}", s(p, "name"), s(p, "description"), s(p, "category")).to_lowercase().contains(&q))
            .map(|p| {
                let id = s(&p, "id");
                let name = s(&p, "name");
                let latest = p["latest"].clone();
                let caps: Vec<String> = latest["capabilities"]
                    .as_array()
                    .map(|a| a.iter().filter_map(|c| c.as_str().map(str::to_owned)).collect())
                    .unwrap_or_default();
                let compatible = latest["compatible"].as_bool().unwrap_or(!latest.is_null());
                let version = latest["version"].as_str().map(str::to_owned);
                let installed = p["installedVersion"].as_str().map(str::to_owned);
                let busy = {
                    let id = id.clone();
                    Signal::derive(move || l.busy.get().as_deref() == Some(id.as_str()))
                };
                let meta = [
                    Some(s(&p, "repoName")),
                    p["category"].as_str().map(str::to_owned),
                    Some(s(&p, "tier")),
                    Some(version.clone().map(|v| format!("v{v}")).unwrap_or_else(|| incompatible(&p))),
                ]
                .into_iter()
                .flatten()
                .filter(|x| !x.is_empty())
                .collect::<Vec<_>>()
                .join(" · ");
                let repo = s(&p, "repoUrl");
                let repo_name = s(&p, "repoName");
                let (n2, caps2) = (name.clone(), caps.clone());
                view! {
                    <div class="pn-ucard">
                        <div class="pn-ucard-head">
                            <span class="pn-ucard-name pn-grow">{name.clone()}</span>
                            {match installed {
                                Some(v) => view! { <span class="pn-pill pn-pill-mint t-mono">{format!("installed {v}")}</span> }.into_any(),
                                None => view! {
                                    <Button
                                        kind=ButtonKind::Primary
                                        label=Signal::derive(move || if busy.get() { "Installing…".to_string() } else { "Install".to_string() })
                                        disabled=Signal::derive(move || !compatible || busy.get())
                                        on_press=Callback::new(move |_| {
                                            let (id, repo, version, caps) = (id.clone(), repo.clone(), version.clone(), caps2.clone());
                                            let body = format!(
                                                "Source: {repo_name}\nVersion: {}\n\nPermissions requested:\n{}\n\nHost plugins are not sandboxed. Only install plugins from sources you trust.",
                                                version.clone().unwrap_or_else(|| "unknown".into()),
                                                if caps.is_empty() { "No additional capabilities".to_owned() } else { caps.iter().map(|c| capability_line(c, forbidden)).collect::<Vec<_>>().join("\n") }
                                            );
                                            ask.set(Some(Ask::new(format!("Install {n2}?"), body, "Grant and install", move || {
                                                let (id, repo, version, caps) = (id.clone(), repo.clone(), version.clone(), caps.clone());
                                                l.act(id.clone(), move |c| async move {
                                                    val(c.plugins_install(&id, &repo, &caps, version.as_deref()).await)
                                                })
                                            })))
                                        })
                                    />
                                }
                                .into_any(),
                            }}
                        </div>
                        {p["description"].as_str().map(|d| view! { <span class="pn-card-desc pn-flush">{d.to_owned()}</span> })}
                        <span class="t-mono pn-row-meta">{meta}</span>
                        {(!caps.is_empty()).then(|| view! { <span class="t-mono pn-small amber">{format!("needs: {}", caps.join(", "))}</span> })}
                    </div>
                }
            })
            .collect_view()
            .into_any()
    }
}

#[component]
fn Sources(l: Lists, ask: RwSignal<Option<Ask>>) -> impl IntoView {
    let url = RwSignal::new(String::new());
    let key = RwSignal::new(String::new());
    let add = Callback::new(move |_| {
        let (u, k) = (
            url.get_untracked().trim().to_owned(),
            key.get_untracked().trim().to_owned(),
        );
        if u.is_empty() {
            return;
        }
        let Some(c) = state::get().conn.client() else {
            return;
        };
        spawn_local(async move {
            match val(c
                .plugins_repos_add(&u, (!k.is_empty()).then_some(k.as_str()), None)
                .await)
            {
                Ok(_) => {
                    url.set(String::new());
                    key.set(String::new());
                    l.load_repos();
                }
                Err(e) => l.error.set(Some(e)),
            }
        });
    });
    view! {
        {move || match l.repos.get() {
            None => view! { <span class="t-label">"loading sources…"</span> }.into_any(),
            Some(list) => list
                .into_iter()
                .map(|r| {
                    let u = s(&r, "url");
                    let name = s(&r, "name");
                    let removable = r["removable"].as_bool().unwrap_or(false);
                    let meta = [
                        Some(s(&r, "tier")),
                        r["pluginCount"].as_f64().map(|n| format!("{n} plugins")),
                    ]
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join(" · ");
                    view! {
                        <div class="pn-ucard">
                            <div class="pn-ucard-head">
                                <div class="pn-ucard-titles">
                                    <span class="pn-ucard-name">{name.clone()}</span>
                                    <span class="t-mono pn-row-meta">{u.clone()}</span>
                                    <span class="t-mono pn-row-meta">{meta}</span>
                                </div>
                                {removable.then(|| {
                                    let u = u.clone();
                                    view! {
                                        <button class="icon-btn" aria-label=format!("Remove {name}") on:click=move |_| {
                                            let u = u.clone();
                                            ask.set(Some(Ask::new("Remove this source?", u.clone(), "Remove", move || {
                                                let u = u.clone();
                                                if let Some(c) = state::get().conn.client() {
                                                    spawn_local(async move {
                                                        if let Err(e) = val(c.plugins_repos_remove(&u).await) {
                                                            l.error.set(Some(e));
                                                        }
                                                        l.load_repos();
                                                    });
                                                }
                                            }).danger()))
                                        }>
                                            <Icon ico=Ico::X size=13.0 class="faint" />
                                        </button>
                                    }
                                })}
                            </div>
                            {r["error"].as_str().map(|e| view! { <span class="pn-error-inline t-mono">{e.to_owned()}</span> })}
                        </div>
                    }
                })
                .collect_view()
                .into_any(),
        }}
        <div class="pn-ucard">
            <span class="t-label">"Add a source"</span>
            <TextInput value=url placeholder="https://… plugin repository URL" mono=true on_enter=add />
            <TextInput value=key placeholder="Public key (optional)" mono=true on_enter=add />
            <div class="pn-sync">
                <Button kind=ButtonKind::Primary label="Add source" on_press=add />
            </div>
        </div>
    }
}
