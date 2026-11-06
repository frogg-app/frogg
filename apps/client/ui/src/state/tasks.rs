//! Project to-dos (ui-next `daemon/todos.ts`): projects on the host, their to-dos kept live
//! through `project.todo.changed`, the shared filters, and the to-do open in the detail sheet.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};

use frogg_client_core::Event;
use leptos::prelude::*;
use leptos::task::spawn_local;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::checkout::{detached, err_text};
use super::get;

pub const STATUSES: [(&str, &str, &str); 7] = [
    ("backlog", "Backlog", "Written down, not ready to start"),
    ("ready", "Ready", "Agents may claim these"),
    ("claimed", "Claimed", "An agent has taken it"),
    ("in_progress", "In progress", "Being worked on"),
    ("review", "Review", "Waiting for you"),
    ("done", "Done", "Finished"),
    ("blocked", "Blocked", "Stuck on something"),
];

pub const PRIORITIES: [(&str, &str); 4] = [
    ("low", "Low"),
    ("medium", "Medium"),
    ("high", "High"),
    ("urgent", "Urgent"),
];

pub fn status_label(s: &str) -> &'static str {
    STATUSES
        .iter()
        .find(|x| x.0 == s)
        .map(|x| x.1)
        .unwrap_or("Other")
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Claim {
    pub agent_id: String,
    #[serde(default)]
    pub stale: bool,
    #[serde(default)]
    pub last_heartbeat: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default = "medium")]
    pub priority: String,
    pub status: String,
    #[serde(default)]
    pub claims: Vec<Claim>,
    #[serde(default)]
    pub last_progress: Option<Value>,
    #[serde(default)]
    pub progress_count: Option<f64>,
}

fn medium() -> String {
    "medium".into()
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub project_id: String,
    #[serde(default)]
    pub project_display_name: String,
    #[serde(default)]
    pub project_root_path: String,
}

#[derive(Clone, Copy)]
pub struct Tasks {
    pub projects: RwSignal<Option<Vec<Project>>>,
    /// Items per project id; `None` while it loads.
    pub items: RwSignal<HashMap<String, Option<Vec<Todo>>>>,
    pub errors: RwSignal<HashMap<String, String>>,
    /// (project id, to-do id) open in the detail sheet.
    pub open: RwSignal<Option<(String, String)>>,
    pub scope: RwSignal<Option<String>>,
    pub query: RwSignal<String>,
}

thread_local! {
    static STORE: Cell<Option<Tasks>> = const { Cell::new(None) };
    static WATCHED: RefCell<HashSet<String>> = RefCell::new(HashSet::new());
    static LISTENER: RefCell<Option<(String, u64)>> = const { RefCell::new(None) };
}

fn reset(t: Tasks) {
    WATCHED.with(|w| w.borrow_mut().clear());
    if let Some((host, id)) = LISTENER.with(|l| l.borrow_mut().take()) {
        if let Some(c) = get().conn.client_of(&host) {
            c.unsubscribe(id);
        }
    }
    t.projects.set(None);
    t.items.set(HashMap::new());
    t.errors.set(HashMap::new());
    t.open.set(None);
    t.scope.set(None);
}

pub fn store() -> Tasks {
    if let Some(t) = STORE.with(|s| s.get()) {
        return t;
    }
    let t = detached(
        || Tasks {
            projects: RwSignal::new(None),
            items: RwSignal::new(HashMap::new()),
            errors: RwSignal::new(HashMap::new()),
            open: RwSignal::new(None),
            scope: RwSignal::new(None),
            query: RwSignal::new(String::new()),
        },
        reset,
    );
    STORE.with(|s| s.set(Some(t)));
    t
}

/// Builds a generated request type from JSON (the core fills `requestId`).
fn req<T: DeserializeOwned>(mut v: Value) -> Result<T, String> {
    v["requestId"] = "".into();
    serde_json::from_value(v).map_err(err_text)
}

fn val<T: Serialize>(r: frogg_client_core::Result<T>) -> Result<Value, String> {
    let v = r
        .map_err(err_text)
        .and_then(|v| serde_json::to_value(v).map_err(err_text))?;
    if let Some(e) = v["error"]["message"].as_str().or(v["error"].as_str()) {
        return Err(e.to_owned());
    }
    Ok(v)
}

/// Whether the host has the project to-do RPCs.
pub fn supported() -> bool {
    get()
        .conn
        .client()
        .is_some_and(|c| c.has_feature("projectTodos"))
}

impl Tasks {
    fn upsert(self, project: &str, item: Todo) {
        self.items.update(|m| {
            let list = m
                .entry(project.to_owned())
                .or_insert_with(|| Some(Vec::new()));
            let list = list.get_or_insert_with(Vec::new);
            match list.iter().position(|t| t.id == item.id) {
                Some(i) => list[i] = item,
                None => list.push(item),
            }
        });
    }

    fn remove(self, project: &str, id: &str) {
        self.items.update(|m| {
            if let Some(Some(list)) = m.get_mut(project) {
                list.retain(|t| t.id != id);
            }
        });
        if self.open.get_untracked().is_some_and(|(_, t)| t == id) {
            self.open.set(None);
        }
    }

    fn set_error(self, project: &str, e: Option<String>) {
        self.errors.update(|m| match e {
            Some(e) => {
                m.insert(project.to_owned(), e);
            }
            None => {
                m.remove(project);
            }
        });
    }

    pub fn load_projects(self) {
        let Some(c) = get().conn.client() else { return };
        spawn_local(async move {
            if let Ok(v) = val(c.list_projects(None).await) {
                let list: Vec<Project> =
                    serde_json::from_value(v["projects"].clone()).unwrap_or_default();
                for p in &list {
                    self.watch(p.project_id.clone(), false);
                }
                self.projects.set(Some(list));
            }
        });
    }

    /// Loads a project's to-dos and keeps them live.
    pub fn watch(self, project: String, force: bool) {
        let app = get();
        let Some(c) = app.conn.client() else { return };
        let Some(host) = app.hosts.active_id.get_untracked() else {
            return;
        };
        let fresh = WATCHED.with(|w| w.borrow_mut().insert(project.clone()));
        if !fresh && !force {
            return;
        }
        if !LISTENER.with(|l| l.borrow().as_ref().is_some_and(|(h, _)| *h == host)) {
            let id = c.subscribe(|e| {
                let Event::Session(f) = e else { return };
                if f.kind != "project.todo.changed" {
                    return;
                }
                let Ok(p) = f.payload::<Value>() else { return };
                let Some(project) = p["projectId"].as_str() else {
                    return;
                };
                if !WATCHED.with(|w| w.borrow().contains(project)) {
                    return;
                }
                let t = store();
                if p["kind"] == "upsert" {
                    if let Ok(item) = serde_json::from_value::<Todo>(p["item"].clone()) {
                        t.upsert(project, item);
                    }
                } else if let Some(id) = p["todoId"].as_str() {
                    t.remove(project, id);
                }
            });
            LISTENER.with(|l| *l.borrow_mut() = Some((host, id)));
        }
        self.items.update(|m| {
            m.entry(project.clone()).or_insert(None);
        });
        spawn_local(async move {
            let r = match req(json!({ "projectId": project, "subscribe": true })) {
                Ok(r) => val(c.list_project_todos(&r).await),
                Err(e) => Err(e),
            };
            match r {
                Ok(v) => {
                    let items: Vec<Todo> = v["items"]
                        .as_array()
                        .map(|a| {
                            a.iter()
                                .filter_map(|i| serde_json::from_value(i.clone()).ok())
                                .collect()
                        })
                        .unwrap_or_default();
                    self.items.update(|m| {
                        m.insert(project.clone(), Some(items));
                    });
                    self.set_error(&project, None);
                }
                Err(e) => {
                    WATCHED.with(|w| w.borrow_mut().remove(&project));
                    self.items.update(|m| {
                        m.insert(project.clone(), Some(Vec::new()));
                    });
                    self.set_error(&project, Some(e));
                }
            }
        });
    }

    pub fn refresh(self) {
        self.load_projects();
        let scope = self.scope.get_untracked();
        for p in self.projects.get_untracked().unwrap_or_default() {
            if scope.as_ref().is_none_or(|s| *s == p.project_id) {
                self.watch(p.project_id, true);
            }
        }
    }

    pub async fn create(
        self,
        project: String,
        title: String,
        description: String,
        priority: String,
        status: String,
    ) -> Result<(), String> {
        let c = get().conn.client().ok_or("not connected")?;
        let r = req(json!({
            "projectId": project, "title": title, "description": description,
            "priority": priority, "status": status,
        }))?;
        let v = val(c.create_project_todo(&r).await)?;
        let item: Todo = serde_json::from_value(v["item"].clone())
            .map_err(|_| "could not create the to-do".to_owned())?;
        self.upsert(&project, item);
        Ok(())
    }

    /// `create` with any extra fields (category, …) merged into the request.
    pub async fn create_with(self, project: String, fields: Value) -> Result<(), String> {
        let c = get().conn.client().ok_or("not connected")?;
        let mut body = fields;
        body["projectId"] = project.clone().into();
        let v = val(c.create_project_todo(&req(body)?).await)?;
        let item: Todo = serde_json::from_value(v["item"].clone())
            .map_err(|_| "could not create the to-do".to_owned())?;
        self.upsert(&project, item);
        Ok(())
    }

    pub async fn update(self, project: String, id: String, fields: Value) -> Result<(), String> {
        let c = get().conn.client().ok_or("not connected")?;
        let mut body = fields;
        body["projectId"] = project.clone().into();
        body["todoId"] = id.into();
        let v = val(c.update_project_todo(&req(body)?).await)?;
        if let Ok(item) = serde_json::from_value::<Todo>(v["item"].clone()) {
            self.upsert(&project, item);
        }
        Ok(())
    }

    /// Optimistic: the card moves at once and settles on the daemon's answer.
    pub async fn set_status(
        self,
        project: String,
        id: String,
        status: String,
    ) -> Result<(), String> {
        let before = self.find(&project, &id);
        if let Some(b) = &before {
            let mut moved = b.clone();
            moved.status = status.clone();
            self.upsert(&project, moved);
        }
        let res = async {
            let c = get().conn.client().ok_or("not connected")?;
            let r = req(json!({ "projectId": project, "todoId": id, "status": status }))?;
            val(c.set_project_todo_status(&r).await)
        }
        .await;
        match res {
            Ok(v) => {
                if let Ok(item) = serde_json::from_value::<Todo>(v["item"].clone()) {
                    self.upsert(&project, item);
                }
                Ok(())
            }
            Err(e) => {
                if let Some(b) = before {
                    self.upsert(&project, b);
                }
                Err(e)
            }
        }
    }

    pub async fn delete(self, project: String, id: String) -> Result<(), String> {
        let c = get().conn.client().ok_or("not connected")?;
        let r = req(json!({ "projectId": project, "todoId": id }))?;
        val(c.delete_project_todo(&r).await)?;
        self.remove(&project, &id);
        Ok(())
    }

    pub fn find(self, project: &str, id: &str) -> Option<Todo> {
        self.items.with(|m| {
            m.get(project)
                .and_then(|l| l.as_ref())
                .and_then(|l| l.iter().find(|t| t.id == id).cloned())
        })
    }

    /// Every loaded to-do the filters let through, with its project id (reactive).
    pub fn filtered(self) -> Vec<(String, Todo)> {
        let q = self.query.get().trim().to_lowercase();
        let scope = self.scope.get();
        self.items.with(|m| {
            let mut out = Vec::new();
            for (pid, list) in m {
                if scope.as_ref().is_some_and(|s| s != pid) {
                    continue;
                }
                for t in list.iter().flatten() {
                    let hay = format!(
                        "{} {} {}",
                        t.title,
                        t.description,
                        t.category.clone().unwrap_or_default()
                    )
                    .to_lowercase();
                    if q.is_empty() || hay.contains(&q) || t.id.to_lowercase() == q {
                        out.push((pid.clone(), t.clone()));
                    }
                }
            }
            out
        })
    }

    /// (shown, total) for the filter note.
    pub fn summary(self) -> (usize, usize) {
        let total = self.items.with(|m| {
            m.values()
                .map(|l| l.as_ref().map(|l| l.len()).unwrap_or(0))
                .sum()
        });
        (self.filtered().len(), total)
    }

    pub fn loading(self) -> bool {
        let scope = self.scope.get();
        let ids: Vec<String> = match scope {
            Some(s) => vec![s],
            None => self
                .projects
                .get()
                .unwrap_or_default()
                .into_iter()
                .map(|p| p.project_id)
                .collect(),
        };
        self.projects.with(|p| p.is_none())
            || self
                .items
                .with(|m| ids.iter().any(|id| m.get(id).is_none_or(|l| l.is_none())))
    }

    pub fn project_name(self, id: &str) -> Option<String> {
        self.projects.with(|p| {
            p.as_ref()
                .and_then(|p| p.iter().find(|x| x.project_id == id))
                .map(|x| x.project_display_name.clone())
        })
    }
}
