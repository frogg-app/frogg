//! Plugins (ui-next `PluginsPanel.tsx`, `daemon/plugins.ts`): installed plugins with enable /
//! update / uninstall, the catalog with a permission confirm before install, and plugin sources.

use leptos::prelude::*;
use leptos::task::spawn_local;
use serde::Serialize;
use serde_json::Value;

use super::util::{Ask, Confirm};
use crate::components::{Button, ButtonKind, Ico, Icon, Seg, TextInput};
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
            .map(|p| {
                let id = s(&p, "id");
                let name = s(&p, "name");
                let enabled = p["enabled"].as_bool().unwrap_or(false);
                let busy = {
                    let id = id.clone();
                    Signal::derive(move || l.busy.get().as_deref() == Some(id.as_str()))
                };
                let update = p["updateAvailable"].as_str().map(str::to_owned);
                let meta = [
                    Some(format!("v{}", s(&p, "version"))),
                    p["author"].as_str().map(str::to_owned),
                    Some(s(&p, "source")),
                    Some(s(&p, "status")),
                ]
                .into_iter()
                .flatten()
                .filter(|x| !x.is_empty())
                .collect::<Vec<_>>()
                .join(" · ");
                let preinstalled = p["preinstalled"].as_bool().unwrap_or(false);
                let (i1, i2, i3) = (id.clone(), id.clone(), id.clone());
                let n3 = name.clone();
                view! {
                    <div class="pn-ucard cut flip" style="--c:10px">
                        <div class="pn-ucard-head">
                            <div class="pn-ucard-titles">
                                <span class="pn-ucard-name">{name.clone()}</span>
                                <span class="t-mono pn-row-meta">{meta}</span>
                            </div>
                            <button
                                class="pn-toggle"
                                class:on=enabled
                                role="switch"
                                aria-checked=enabled.to_string()
                                aria-label=format!("{} {name}", if enabled { "Disable" } else { "Enable" })
                                disabled=move || busy.get()
                                on:click=move |_| { let id = i1.clone(); l.act(id.clone(), move |c| async move { val(c.plugins_set_enabled(&id, !enabled).await) }) }
                            >
                                <span></span>
                            </button>
                        </div>
                        {p["description"].as_str().map(|d| view! { <span class="pn-card-desc pn-flush">{d.to_owned()}</span> })}
                        {p["error"].as_str().map(|e| view! { <span class="pn-error-inline t-mono">{e.to_owned()}</span> })}
                        <div class="pn-sync">
                            {update.map(|u| {
                                let i2 = i2.clone();
                                view! {
                                    <Button
                                        kind=ButtonKind::Primary
                                        label=format!("Update to {u}")
                                        disabled=busy
                                        on_press=Callback::new(move |_| {
                                            let id = i2.clone();
                                            l.act(id.clone(), move |c| async move { val(c.plugins_update(&id, None, None).await) })
                                        })
                                    />
                                }
                            })}
                            {(!preinstalled).then(|| view! {
                                <Button
                                    kind=ButtonKind::Danger
                                    label="Uninstall"
                                    disabled=busy
                                    on_press=Callback::new(move |_| {
                                        let id = i3.clone();
                                        ask.set(Some(Ask::new(
                                            format!("Uninstall {n3}?"),
                                            "Removes the plugin and its data from this host.",
                                            "Uninstall",
                                            move || {
                                                let id = id.clone();
                                                l.act(id.clone(), move |c| async move { val(c.plugins_uninstall(&id).await) })
                                            },
                                        ).danger()))
                                    })
                                />
                            })}
                        </div>
                    </div>
                }
            })
            .collect_view()
            .into_any()
    }
}

#[component]
fn Browse(l: Lists, ask: RwSignal<Option<Ask>>, query: RwSignal<String>) -> impl IntoView {
    move || {
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
                    Some(version.clone().map(|v| format!("v{v}")).unwrap_or_else(|| "incompatible".into())),
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
                                                if caps.is_empty() { "No additional capabilities".to_owned() } else { caps.join("\n") }
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
