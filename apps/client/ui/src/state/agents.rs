//! Sessions (agents) per host, kept live from `fetch_agents` + `agent_update` pushes
//! (ui-next `daemon/store.ts`, `daemon/types.ts`).
//!
//! Agents decode into a local struct with the fields the shell reads; `raw` keeps the whole
//! snapshot so later views can read anything else without a second fetch.

use std::collections::HashMap;

use leptos::prelude::*;
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Agent {
    pub id: String,
    pub provider: String,
    pub cwd: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    pub status: String,
    #[serde(rename = "createdAt", default)]
    pub created_at: String,
    #[serde(rename = "updatedAt", default)]
    pub updated_at: String,
    #[serde(rename = "pendingPermissions", default)]
    pub pending_permissions: Vec<Value>,
    #[serde(rename = "requiresAttention", default)]
    pub requires_attention: Option<bool>,
    #[serde(rename = "attentionReason", default)]
    pub attention_reason: Option<String>,
    #[serde(rename = "archivedAt", default)]
    pub archived_at: Option<String>,
    #[serde(rename = "runtimeInfo", default)]
    pub runtime_info: Option<Value>,
    #[serde(skip)]
    pub raw: Value,
}

impl Agent {
    pub fn from_value(v: &Value) -> Option<Self> {
        let mut a: Agent = serde_json::from_value(v.clone()).ok()?;
        a.raw = v.clone();
        Some(a)
    }

    /// The model the agent runs: the runtime's, else the requested one.
    pub fn model_label(&self) -> String {
        self.runtime_info
            .as_ref()
            .and_then(|r| r.get("model"))
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or_else(|| self.model.clone())
            .unwrap_or_else(|| "default".into())
    }

    pub fn title_or_untitled(&self) -> String {
        self.title
            .clone()
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_else(|| "Untitled session".into())
    }
}

/// Where a session's project lives (ProjectPlacementPayload), when the daemon placed it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Placement {
    #[serde(rename = "projectKey")]
    pub project_key: String,
    #[serde(rename = "projectName")]
    pub project_name: String,
    #[serde(rename = "workspaceName", default)]
    pub workspace_name: Option<String>,
    #[serde(default)]
    pub checkout: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Session {
    pub agent: Agent,
    pub project: Option<Placement>,
}

impl Session {
    pub fn from_entry(agent: &Value, project: Option<&Value>) -> Option<Self> {
        Some(Self {
            agent: Agent::from_value(agent)?,
            project: project
                .filter(|p| !p.is_null())
                .and_then(|p| serde_json::from_value(p.clone()).ok()),
        })
    }
}

/// The status groups the session list sorts into, in display order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Bucket {
    Needs,
    Failed,
    Review,
    Working,
    Idle,
}

impl Bucket {
    pub const ORDER: [Bucket; 5] = [
        Bucket::Needs,
        Bucket::Failed,
        Bucket::Review,
        Bucket::Working,
        Bucket::Idle,
    ];

    pub fn rank(self) -> usize {
        Self::ORDER.iter().position(|b| *b == self).unwrap_or(4)
    }

    pub fn id(self) -> &'static str {
        match self {
            Bucket::Needs => "needs",
            Bucket::Failed => "failed",
            Bucket::Review => "review",
            Bucket::Working => "working",
            Bucket::Idle => "idle",
        }
    }
}

pub fn bucket_of(a: &Agent) -> Bucket {
    let reason = a.attention_reason.as_deref();
    if !a.pending_permissions.is_empty() || reason == Some("permission") {
        Bucket::Needs
    } else if a.status == "error" || reason == Some("error") {
        Bucket::Failed
    } else if a.status == "running" || a.status == "initializing" {
        Bucket::Working
    } else if a.requires_attention == Some(true) && reason == Some("finished") {
        Bucket::Review
    } else {
        Bucket::Idle
    }
}

/// Sessions of every connected host, by host id then agent id.
#[derive(Clone, Copy)]
pub struct Agents {
    pub by_host: RwSignal<HashMap<String, HashMap<String, Session>>>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Buckets {
    pub needs: usize,
    pub failed: usize,
    pub review: usize,
    pub working: usize,
    pub idle: usize,
}

impl Agents {
    pub fn init() -> Self {
        Self {
            by_host: RwSignal::new(HashMap::new()),
        }
    }

    /// Sessions of `host_id`, most recently updated first, archived dropped.
    pub fn list(&self, host_id: Option<&str>) -> Vec<Session> {
        let Some(host_id) = host_id else {
            return Vec::new();
        };
        let mut out: Vec<Session> = self.by_host.with(|m| {
            m.get(host_id)
                .map(|s| s.values().cloned().collect())
                .unwrap_or_default()
        });
        out.sort_by(|a, b| b.agent.updated_at.cmp(&a.agent.updated_at));
        out
    }

    pub fn get(&self, host_id: &str, agent_id: &str) -> Option<Session> {
        self.by_host
            .with(|m| m.get(host_id).and_then(|s| s.get(agent_id)).cloned())
    }

    /// `get` for event handlers, component setup and tasks (no tracking context).
    pub fn get_untracked(&self, host_id: &str, agent_id: &str) -> Option<Session> {
        self.by_host
            .with_untracked(|m| m.get(host_id).and_then(|s| s.get(agent_id)).cloned())
    }

    pub fn buckets(&self, host_id: Option<&str>) -> Buckets {
        let mut b = Buckets::default();
        let Some(host_id) = host_id else {
            return b;
        };
        self.by_host.with(|m| {
            for s in m.get(host_id).into_iter().flat_map(|s| s.values()) {
                match bucket_of(&s.agent) {
                    Bucket::Needs => b.needs += 1,
                    Bucket::Failed => b.failed += 1,
                    Bucket::Review => b.review += 1,
                    Bucket::Working => b.working += 1,
                    Bucket::Idle => b.idle += 1,
                }
            }
        });
        b
    }

    pub(crate) fn replace_host(&self, host_id: &str, sessions: HashMap<String, Session>) {
        self.by_host.update(|m| {
            m.insert(host_id.to_owned(), sessions);
        });
    }

    pub(crate) fn drop_host(&self, host_id: &str) {
        self.by_host.update(|m| {
            m.remove(host_id);
        });
    }

    /// Applies an `agent_update` / `agent_deleted` push's payload.
    pub(crate) fn apply_push(&self, host_id: &str, kind: &str, payload: &Value) {
        let agent_id = payload.get("agentId").and_then(Value::as_str);
        self.by_host.update(|m| {
            let sessions = m.entry(host_id.to_owned()).or_default();
            match (kind, payload.get("kind").and_then(Value::as_str)) {
                ("agent_deleted", _) | ("agent_update", Some("remove")) => {
                    if let Some(id) = agent_id {
                        sessions.remove(id);
                    }
                }
                ("agent_update", Some("upsert")) => {
                    let Some(agent) = payload.get("agent") else {
                        return;
                    };
                    let project = payload.get("project");
                    let Some(mut s) = Session::from_entry(agent, project) else {
                        return;
                    };
                    if s.agent.archived_at.is_some() {
                        sessions.remove(&s.agent.id);
                        return;
                    }
                    if s.project.is_none() && project.is_none() {
                        s.project = sessions.get(&s.agent.id).and_then(|p| p.project.clone());
                    }
                    sessions.insert(s.agent.id.clone(), s);
                }
                _ => {}
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn agent(status: &str) -> Value {
        json!({"id":"a1","provider":"claude","cwd":"/x","status":status,"title":null,
               "createdAt":"t","updatedAt":"t","pendingPermissions":[],"capabilities":{}})
    }

    #[test]
    fn buckets() {
        let a = Agent::from_value(&agent("running")).unwrap();
        assert_eq!(bucket_of(&a), Bucket::Working);
        let mut v = agent("idle");
        v["pendingPermissions"] = json!([{"id":"p"}]);
        assert_eq!(bucket_of(&Agent::from_value(&v).unwrap()), Bucket::Needs);
        let mut v = agent("idle");
        v["requiresAttention"] = json!(true);
        v["attentionReason"] = json!("finished");
        assert_eq!(bucket_of(&Agent::from_value(&v).unwrap()), Bucket::Review);
        assert_eq!(
            bucket_of(&Agent::from_value(&agent("error")).unwrap()),
            Bucket::Failed
        );
    }
}
