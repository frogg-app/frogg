//! The active host's directory (ui-next `sessions/directory.ts`, loading half): projects,
//! workspaces (labels, pins, chats) and the label catalog, plus the RPC actions the session list
//! and New session run against it.
//!
//! The store is a lazily built singleton (`projects::get()`) so it needs no slot in `AppState`.
//! It reloads whenever the active host comes online and clears on a host switch.

use std::cell::Cell;
use std::collections::HashMap;
use std::time::Duration;

use frogg_client_core::protocol::inbound;
use frogg_client_core::DaemonClient;
use leptos::prelude::*;
use leptos::task::spawn_local;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::sessions::SessionExt;
use super::Conn;

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Project {
    #[serde(rename = "projectId")]
    pub project_id: String,
    #[serde(rename = "projectKey", default)]
    pub project_key: Option<String>,
    #[serde(rename = "projectDisplayName", default)]
    pub project_display_name: String,
    #[serde(rename = "projectCustomName", default)]
    pub project_custom_name: Option<String>,
    #[serde(rename = "projectRootPath", default)]
    pub project_root_path: String,
    #[serde(rename = "projectKind", default)]
    pub project_kind: Option<String>,
    #[serde(default)]
    pub chats: Option<bool>,
}

impl Project {
    pub fn name(&self) -> String {
        self.project_custom_name
            .clone()
            .filter(|n| !n.trim().is_empty())
            .unwrap_or_else(|| self.project_display_name.clone())
    }

    pub fn is_git(&self) -> bool {
        self.project_kind.as_deref() == Some("git")
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Workspace {
    #[serde(deserialize_with = "id_string")]
    pub id: String,
    #[serde(rename = "projectId", default, deserialize_with = "opt_id_string")]
    pub project_id: Option<String>,
    #[serde(default, deserialize_with = "null_vec")]
    pub labels: Vec<String>,
    #[serde(rename = "pinnedAt", default)]
    pub pinned_at: Option<String>,
    #[serde(default)]
    pub chat: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LabelDef {
    pub name: String,
    pub color: String,
}

fn id_string<'de, D: serde::Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    let v = Value::deserialize(d)?;
    Ok(match v {
        Value::String(s) => s,
        other => other.to_string(),
    })
}

fn opt_id_string<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    let v = Value::deserialize(d)?;
    Ok(match v {
        Value::Null => None,
        Value::String(s) => Some(s),
        other => Some(other.to_string()),
    })
}

fn null_vec<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<String>, D::Error> {
    Ok(Option::<Vec<String>>::deserialize(d)?.unwrap_or_default())
}

#[derive(Clone, Copy)]
pub struct Directory {
    pub loaded: RwSignal<bool>,
    pub error: RwSignal<Option<String>>,
    /// Projects, chats project left out.
    pub projects: RwSignal<Vec<Project>>,
    pub chats_project_id: RwSignal<Option<String>>,
    pub workspaces: RwSignal<HashMap<String, Workspace>>,
    pub labels: RwSignal<Vec<LabelDef>>,
}

thread_local! {
    static DIR: Cell<Option<Directory>> = const { Cell::new(None) };
}

/// The directory store, built (and wired to the active host) on first use.
pub fn get() -> Directory {
    if let Some(d) = DIR.with(Cell::get) {
        return d;
    }
    let owner = Owner::new_root(None);
    let d = owner.with(Directory::build);
    std::mem::forget(owner);
    DIR.with(|c| c.set(Some(d)));
    d
}

impl Directory {
    fn build() -> Self {
        let d = Self {
            loaded: RwSignal::new(false),
            error: RwSignal::new(None),
            projects: RwSignal::new(Vec::new()),
            chats_project_id: RwSignal::new(None),
            workspaces: RwSignal::new(HashMap::new()),
            labels: RwSignal::new(Vec::new()),
        };
        let app = super::get();
        // Host switch clears; the active host coming online loads.
        Effect::new(move |prev: Option<(Option<String>, bool)>| {
            let host = app.hosts.active_id.get();
            let online = app.conn.active_link().conn == Conn::Online;
            let (prev_host, prev_online) = prev.clone().unwrap_or((None, false));
            if prev.is_some() && prev_host != host {
                d.clear();
            }
            if online && (!prev_online || prev_host != host) {
                d.reload();
            }
            (host, online)
        });
        // A session in a workspace not seen yet means a new workspace: refetch, coalesced.
        let pending = StoredValue::new(false);
        Effect::new(move |_| {
            let sessions = app.sessions();
            if !d.loaded.get_untracked() || pending.get_value() {
                return;
            }
            let unknown = d.workspaces.with_untracked(|w| {
                sessions
                    .iter()
                    .filter_map(|s| s.workspace_id())
                    .any(|id| !w.contains_key(&id))
            });
            if unknown {
                pending.set_value(true);
                set_timeout(
                    move || {
                        pending.set_value(false);
                        spawn_local(async move {
                            if let Ok(c) = need() {
                                let _ = d.load_workspaces(&c).await;
                            }
                        });
                    },
                    Duration::from_millis(600),
                );
            }
        });
        d
    }

    fn clear(&self) {
        self.loaded.set(false);
        self.error.set(None);
        self.projects.set(Vec::new());
        self.chats_project_id.set(None);
        self.workspaces.set(HashMap::new());
        self.labels.set(Vec::new());
    }

    /// Loads projects, workspaces and labels from the active host.
    pub fn reload(&self) {
        let d = *self;
        spawn_local(async move {
            let Ok(c) = need() else { return };
            let res = async {
                let projects = list_projects_on(&c).await?;
                let labels = c
                    .list_workspace_labels("rs-session-list", None)
                    .await
                    .ok()
                    .and_then(|r| conv::<Vec<LabelDef>>(&r.labels).ok())
                    .unwrap_or_default();
                d.load_workspaces(&c).await?;
                Ok::<_, String>((projects, labels))
            }
            .await;
            match res {
                Ok((projects, labels)) => {
                    d.chats_project_id.set(
                        projects
                            .iter()
                            .find(|p| p.chats == Some(true))
                            .map(|p| p.project_id.clone()),
                    );
                    d.projects.set(
                        projects
                            .into_iter()
                            .filter(|p| p.chats != Some(true))
                            .collect(),
                    );
                    d.labels.set(labels);
                    d.error.set(None);
                }
                Err(e) => d.error.set(Some(e)),
            }
            d.loaded.set(true);
        });
    }

    async fn load_workspaces(&self, c: &DaemonClient) -> Result<(), String> {
        let req: inbound::FetchWorkspacesRequest =
            build(json!({ "requestId": "", "page": { "limit": 200 } }))?;
        let res = c.fetch_workspaces(&req).await.map_err(err)?;
        let mut map = HashMap::new();
        for e in &res.entries {
            if let Ok(w) = serde_json::from_value::<Workspace>(e.clone()) {
                map.insert(w.id.clone(), w);
            }
        }
        self.workspaces.set(map);
        Ok(())
    }

    pub fn workspace(&self, id: Option<&str>) -> Option<Workspace> {
        let id = id?;
        self.workspaces.with(|w| w.get(id).cloned())
    }

    pub fn label_color(&self, name: &str) -> Option<String> {
        self.labels
            .with(|l| l.iter().find(|x| x.name == name).map(|x| x.color.clone()))
    }

    /// Assigns or removes a label on a workspace, creating the label when new.
    pub async fn set_label(
        &self,
        workspace_id: &str,
        label: LabelDef,
        assigned: bool,
    ) -> Result<(), String> {
        let wire: inbound::WorkspaceLabelAssignmentSetRequestLabel = build(json!(label))?;
        let res = need()?
            .set_workspace_label(workspace_id, &wire, assigned)
            .await
            .map_err(err)?;
        let res: Value = conv(&res)?;
        if let Ok(l) = serde_json::from_value::<LabelDef>(res["label"].clone()) {
            self.labels.update(|ls| {
                if !ls.iter().any(|x| x.name == l.name) {
                    ls.push(l);
                }
            });
        }
        let assigned: Vec<String> =
            serde_json::from_value(res["workspaceLabels"].clone()).unwrap_or_default();
        self.workspaces.update(|w| {
            if let Some(x) = w.get_mut(workspace_id) {
                x.labels = assigned;
            }
        });
        Ok(())
    }

    pub async fn set_pinned(&self, workspace_id: &str, pinned: bool) -> Result<(), String> {
        let at = need()?
            .set_workspace_pinned(workspace_id, pinned)
            .await
            .map_err(err)?;
        self.workspaces.update(|w| {
            if let Some(x) = w.get_mut(workspace_id) {
                x.pinned_at = at;
            }
        });
        Ok(())
    }
}

// ---- helpers ----

pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// The active host's client, or the error the UI shows.
pub fn need() -> Result<DaemonClient, String> {
    super::get()
        .conn
        .client()
        .ok_or_else(|| "Not connected to a host".to_owned())
}

/// Builds a generated wire type from JSON (fills the many optional fields by omission).
pub fn build<T: DeserializeOwned>(v: Value) -> Result<T, String> {
    serde_json::from_value(v).map_err(err)
}

/// Re-reads a generated payload as a local struct.
pub fn conv<T: DeserializeOwned>(v: &impl Serialize) -> Result<T, String> {
    serde_json::to_value(v)
        .and_then(serde_json::from_value)
        .map_err(err)
}

pub async fn list_projects_on(c: &DaemonClient) -> Result<Vec<Project>, String> {
    let r = c.list_projects(None).await.map_err(err)?;
    let v: Value = conv(&r)?;
    Ok(v["projects"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|p| serde_json::from_value(p.clone()).ok())
                .collect()
        })
        .unwrap_or_default())
}

// ---- actions ----

pub async fn rename_session(agent_id: &str, name: &str) -> Result<(), String> {
    need()?
        .update_agent(agent_id, Some(name), None)
        .await
        .map_err(err)
}

pub async fn archive_session(agent_id: &str) -> Result<(), String> {
    need()?.archive_agent(agent_id).await.map_err(err)?;
    let app = super::get();
    if let Some(host) = app.hosts.active_id.get_untracked() {
        app.agents.by_host.update(|m| {
            if let Some(s) = m.get_mut(&host) {
                s.remove(agent_id);
            }
        });
    }
    Ok(())
}

/// Approves (or denies) a pending permission in place.
pub fn answer_permission(agent_id: &str, request_id: &str, allow: bool) -> Result<(), String> {
    let response = if allow {
        json!({ "behavior": "allow" })
    } else {
        json!({ "behavior": "deny", "message": "Denied from Frogg" })
    };
    need()?
        .respond_to_permission(agent_id, request_id, response)
        .map_err(err)
}

pub async fn clear_attention(ids: Vec<String>) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    need()?.clear_agent_attention(&ids).await.map_err(err)
}

/// Adds a folder as a project on `c`'s host, then reloads the directory if that is the active one.
pub async fn add_project(c: &DaemonClient, cwd: &str) -> Result<(), String> {
    let r = c.add_project(cwd).await.map_err(err)?;
    let v: Value = conv(&r)?;
    if let Some(e) = v.get("error").and_then(Value::as_str) {
        return Err(e.to_owned());
    }
    get().reload();
    Ok(())
}

#[derive(Debug, Clone, PartialEq)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
}

/// A host folder's subfolders, plus the folder's absolute path as the host spells it.
pub async fn list_dir(c: &DaemonClient, dir: &str) -> Result<(String, Vec<DirEntry>), String> {
    let v = c.list_directory(dir, ".").await.map_err(err)?;
    let path = v
        .get("absolutePath")
        .and_then(Value::as_str)
        .filter(|p| !p.is_empty())
        .unwrap_or(dir)
        .to_owned();
    let windows = super::sessions::paths::is_windows(&path);
    let mut out: Vec<DirEntry> = v
        .get("entries")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter(|e| e.get("kind").and_then(Value::as_str) == Some("directory"))
                .filter_map(|e| e.get("name").and_then(Value::as_str))
                .filter(|n| {
                    !n.starts_with('.') && !(windows && super::sessions::paths::is_system_folder(n))
                })
                .map(|n| DirEntry {
                    name: n.to_owned(),
                    path: super::sessions::paths::join(&path, n),
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok((path, out))
}

/// The drive roots a Windows host can list.
pub async fn list_drives(c: &DaemonClient) -> Vec<DirEntry> {
    let mut out = Vec::new();
    for l in "CDEFGHIJKLMNOPQRSTUVWXYZAB".chars() {
        let root = format!("{l}:\\");
        if c.list_directory(&root, ".").await.is_ok() {
            out.push(DirEntry {
                name: format!("{l}:"),
                path: root,
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

pub async fn make_dir(c: &DaemonClient, parent: &str, name: &str) -> Result<(), String> {
    let r = c
        .create_project_directory(parent, name)
        .await
        .map_err(err)?;
    let v: Value = conv(&r)?;
    match v.get("error").and_then(Value::as_str) {
        Some(e) => Err(e.to_owned()),
        None => Ok(()),
    }
}

/// An archived session as `fetch_agent_history` lists it.
#[derive(Debug, Clone, PartialEq)]
pub struct HistoryEntry {
    pub agent: Value,
    pub project: Option<Value>,
}

impl HistoryEntry {
    pub fn id(&self) -> String {
        self.agent["id"].as_str().unwrap_or_default().to_owned()
    }
    pub fn str(&self, k: &str) -> Option<String> {
        self.agent.get(k).and_then(Value::as_str).map(str::to_owned)
    }
}

pub async fn fetch_history(
    search: &str,
    cursor: Option<String>,
) -> Result<(Vec<HistoryEntry>, Option<String>), String> {
    let mut page = json!({ "limit": 50 });
    if let Some(c) = cursor {
        page["cursor"] = c.into();
    }
    let mut req = json!({
        "requestId": "",
        "filter": { "includeArchived": true },
        "sort": [{ "key": "updated_at", "direction": "desc" }],
        "page": page,
    });
    if !search.is_empty() {
        req["search"] = search.into();
    }
    let req: inbound::FetchAgentHistoryRequest = build(req)?;
    let res = need()?.fetch_agent_history(&req).await.map_err(err)?;
    let v: Value = conv(&res)?;
    let entries = v["entries"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|e| !e["agent"]["archivedAt"].is_null())
                .map(|e| HistoryEntry {
                    agent: e["agent"].clone(),
                    project: Some(e["project"].clone()).filter(|p| !p.is_null()),
                })
                .collect()
        })
        .unwrap_or_default();
    let next = if v["pageInfo"]["hasMore"].as_bool() == Some(true) {
        v["pageInfo"]["nextCursor"].as_str().map(str::to_owned)
    } else {
        None
    };
    Ok((entries, next))
}

/// Refreshing an archived agent unarchives it on the daemon.
pub async fn restore_session(e: &HistoryEntry) -> Result<(), String> {
    need()?.refresh_agent(&e.id()).await.map_err(err)?;
    let app = super::get();
    let mut agent = e.agent.clone();
    agent["archivedAt"] = Value::Null;
    if let (Some(host), Some(s)) = (
        app.hosts.active_id.get_untracked(),
        super::Session::from_entry(&agent, e.project.as_ref()),
    ) {
        app.agents.by_host.update(|m| {
            m.entry(host).or_default().insert(s.agent.id.clone(), s);
        });
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Importable {
    #[serde(rename = "providerId")]
    pub provider_id: String,
    #[serde(rename = "providerLabel", default)]
    pub provider_label: String,
    #[serde(rename = "providerHandleId")]
    pub provider_handle_id: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(rename = "firstPromptPreview", default)]
    pub first_prompt_preview: Option<String>,
    #[serde(rename = "lastActivityAt", default)]
    pub last_activity_at: String,
}

pub async fn fetch_importable() -> Result<(Vec<Importable>, u64), String> {
    let req: inbound::FetchRecentProviderSessionsRequest =
        build(json!({ "requestId": "", "limit": 100 }))?;
    let res = need()?
        .fetch_recent_provider_sessions(&req)
        .await
        .map_err(err)?;
    let v: Value = conv(&res)?;
    let entries = v["entries"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|e| serde_json::from_value(e.clone()).ok())
                .collect()
        })
        .unwrap_or_default();
    Ok((
        entries,
        v["filteredAlreadyImportedCount"].as_u64().unwrap_or(0),
    ))
}

pub async fn import_session(e: &Importable) -> Result<String, String> {
    let req: inbound::ImportAgentRequest = build(json!({
        "requestId": "",
        "providerId": e.provider_id,
        "providerHandleId": e.provider_handle_id,
        "cwd": e.cwd,
    }))?;
    let agent = need()?.import_agent(&req).await.map_err(err)?;
    Ok(agent["id"].as_str().unwrap_or_default().to_owned())
}
