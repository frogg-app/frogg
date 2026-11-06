//! The RPC surface ui-next uses from `@frogg/client`'s `DaemonClient`, one async method each,
//! in snake_case. Requests are JSON built from the TS field names (optional fields omitted
//! like `undefined` in TS) and checked against `frogg_protocol::inbound` in the tests;
//! responses decode into the generated `outbound::*Payload` types (or `serde_json::Value`
//! where the generator emits `Value`).
//!
//! Complex inputs take the generated inbound request struct; its `request_id` is filled in
//! when left empty.

use frogg_protocol::{inbound, outbound};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::binary::{FileBeginMetadata, FileFrame};
use crate::client::BinaryRead;
use crate::terminal::TerminalInput;
use crate::{DaemonClient, Error, FileReadResult, Result, SessionFrame};

const CLEAN_CUT_TIMEOUT_MS: u64 = 5 * 60_000;
const DAEMON_CONTROL_TIMEOUT_MS: u64 = 90_000;

/// Drops top-level `null`s, as TS spreads drop `undefined`.
fn obj(mut v: Value) -> Value {
    if let Some(o) = v.as_object_mut() {
        o.retain(|_, v| !v.is_null());
    }
    v
}

fn decode<T: DeserializeOwned>(frame: &SessionFrame) -> Result<T> {
    frame
        .payload()
        .map_err(|e| Error::Decode(format!("{}: {e}", frame.kind)))
}

/// `payload.error` as a message (a string, or an object with `message`).
fn payload_error(frame: &SessionFrame) -> Option<String> {
    let v = frame.json();
    match &v["payload"]["error"] {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Object(o) => Some(
            o.get("message")
                .and_then(Value::as_str)
                .unwrap_or("Request failed")
                .to_owned(),
        ),
        _ => None,
    }
}

fn check_error(frame: &SessionFrame) -> Result<()> {
    match payload_error(frame) {
        Some(e) => Err(Error::Daemon(e)),
        None => Ok(()),
    }
}

fn check_accepted(frame: &SessionFrame, field: &str, fallback: &str) -> Result<()> {
    if frame.json()["payload"][field] == Value::Bool(true) {
        return Ok(());
    }
    Err(Error::Daemon(
        payload_error(frame).unwrap_or_else(|| fallback.to_owned()),
    ))
}

fn notice(frame: &SessionFrame) -> Option<Value> {
    let n = frame.json()["payload"]["notice"].clone();
    (!n.is_null()).then_some(n)
}

/// Serializes a generated request struct into fields, setting `requestId` when empty.
fn fields_of<T: Serialize>(req: &T, request_id: &str) -> Result<Value> {
    let mut v = serde_json::to_value(req).map_err(|e| Error::Send(e.to_string()))?;
    if let Some(o) = v.as_object_mut() {
        let empty = o
            .get("requestId")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty);
        if empty {
            o.insert("requestId".into(), request_id.into());
        }
        o.remove("type");
    }
    Ok(v)
}

/// Inputs for `create_terminal`.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTerminalOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    /// `{ rows, cols }`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_account_id: Option<String>,
}

/// Inputs for `send_message`.
#[derive(Debug, Clone, Default)]
pub struct SendMessageOptions {
    pub message_id: Option<String>,
    /// `"queue"`, `"interrupt"`, ...
    pub active_turn_behavior: Option<String>,
    pub images: Option<Value>,
    pub attachments: Option<Value>,
}

/// Inputs for `fetch_agent_timeline`.
#[derive(Debug, Clone, Default)]
pub struct FetchAgentTimelineOptions {
    /// `"before"` / `"after"` / `"tail"`.
    pub direction: Option<String>,
    pub cursor: Option<Value>,
    pub limit: Option<u32>,
    pub projection: Option<String>,
    pub merge_window: bool,
    pub timeout_ms: Option<u64>,
}

/// Inputs for `fetch_provider_subagent_timeline`.
#[derive(Debug, Clone, Default)]
pub struct SubagentTimelineOptions {
    pub direction: Option<String>,
    pub cursor: Option<Value>,
    pub limit: Option<u32>,
    pub timeout_ms: Option<u64>,
}

/// Inputs for `upload_file_stream`. `read(start, end)` returns bytes `[start, end)`.
pub struct FileUploadInput<'a> {
    pub file_name: String,
    pub mime_type: String,
    pub size: u64,
    pub modified_at: Option<String>,
    pub chunk_size: Option<u64>,
    pub read: &'a dyn Fn(u64, u64) -> Vec<u8>,
    pub on_progress: Option<&'a dyn Fn(u64, u64)>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PingResult {
    pub request_id: String,
    pub client_sent_at: f64,
    pub server_received_at: f64,
    pub server_sent_at: f64,
    pub rtt_ms: f64,
}

/// `zip_directory` result: the response payload plus the archive bytes.
#[derive(Debug, Clone, PartialEq)]
pub struct ZipResult {
    pub payload: outbound::FsDirectoryZipResponsePayload,
    pub bytes: Option<Vec<u8>>,
}

impl DaemonClient {
    // ---- request plumbing ---------------------------------------------------------------------

    /// Sends `{type: req_type, requestId, ...fields}` and waits for `resp_type` with the same
    /// `requestId`. The escape hatch for RPCs without a typed method.
    pub async fn rpc_frame(
        &self,
        req_type: &str,
        fields: Value,
        resp_type: &str,
        timeout_ms: Option<u64>,
    ) -> Result<SessionFrame> {
        let request_id = self.new_request_id();
        let mut message = obj(fields);
        if !message.is_object() {
            message = json!({});
        }
        let rid = match message.get("requestId").and_then(Value::as_str) {
            Some(r) if !r.is_empty() => r.to_owned(),
            _ => {
                message["requestId"] = request_id.clone().into();
                request_id
            }
        };
        message["type"] = req_type.into();
        let resp = resp_type.to_owned();
        let r = rid.clone();
        self.request_frame(
            message,
            Some(rid),
            Box::new(move |f| f.kind == resp && f.request_id.as_deref() == Some(r.as_str())),
            timeout_ms,
        )
        .await
    }

    /// Sends a generated inbound message and decodes the matching response's payload.
    pub async fn rpc<T: DeserializeOwned>(
        &self,
        message: &inbound::SessionMessage,
        resp_type: &str,
        timeout_ms: Option<u64>,
    ) -> Result<T> {
        let mut v = serde_json::to_value(message).map_err(|e| Error::Send(e.to_string()))?;
        let req_type = v["type"].as_str().unwrap_or_default().to_owned();
        v.as_object_mut().map(|o| o.remove("type"));
        let f = self.rpc_frame(&req_type, v, resp_type, timeout_ms).await?;
        decode(&f)
    }

    async fn call<T: DeserializeOwned>(
        &self,
        req_type: &str,
        fields: Value,
        resp_type: &str,
        timeout_ms: Option<u64>,
    ) -> Result<T> {
        decode(
            &self
                .rpc_frame(req_type, fields, resp_type, timeout_ms)
                .await?,
        )
    }

    /// Namespaced `x.y.request` → `x.y.response`.
    async fn ns_frame(
        &self,
        req_type: &str,
        fields: Value,
        timeout_ms: Option<u64>,
    ) -> Result<SessionFrame> {
        let resp = format!("{}.response", req_type.trim_end_matches(".request"));
        self.rpc_frame(req_type, fields, &resp, timeout_ms).await
    }

    async fn ns<T: DeserializeOwned>(
        &self,
        req_type: &str,
        fields: Value,
        timeout_ms: Option<u64>,
    ) -> Result<T> {
        decode(&self.ns_frame(req_type, fields, timeout_ms).await?)
    }

    /// Waits for a `status` message whose `payload.status` is one of `statuses` and whose
    /// `payload.requestId` matches.
    async fn status_frame(
        &self,
        req_type: &str,
        fields: Value,
        statuses: &'static [&'static str],
        timeout_ms: Option<u64>,
    ) -> Result<SessionFrame> {
        let request_id = self.new_request_id();
        let mut message = obj(fields);
        message["type"] = req_type.into();
        message["requestId"] = request_id.clone().into();
        let r = request_id.clone();
        self.request_frame(
            message,
            Some(request_id),
            Box::new(move |f| {
                f.kind == "status"
                    && f.request_id.as_deref() == Some(r.as_str())
                    && f.payload_status()
                        .is_some_and(|s| statuses.contains(&s.as_str()))
            }),
            timeout_ms,
        )
        .await
    }

    fn require(&self, feature: &str, message: &str) -> Result<()> {
        if self.has_feature(feature) {
            Ok(())
        } else {
            Err(Error::Unsupported(message.to_owned()))
        }
    }

    // ---- liveness -----------------------------------------------------------------------------

    /// Session-level `ping` RPC (default 5 s timeout).
    pub async fn ping(&self, timeout_ms: Option<u64>) -> Result<PingResult> {
        let now = || {
            #[cfg(target_arch = "wasm32")]
            {
                js_sys::Date::now()
            }
            #[cfg(not(target_arch = "wasm32"))]
            {
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as f64)
                    .unwrap_or(0.0)
            }
        };
        let sent = now();
        let f = self
            .rpc_frame(
                "ping",
                json!({ "clientSentAt": sent as i64 }),
                "pong",
                Some(timeout_ms.unwrap_or(5_000)),
            )
            .await?;
        let p: outbound::PongPayload = decode(&f)?;
        Ok(PingResult {
            request_id: p.request_id,
            client_sent_at: sent,
            server_received_at: p.server_received_at as f64,
            server_sent_at: p.server_sent_at as f64,
            rtt_ms: now() - sent,
        })
    }

    // ---- agents -------------------------------------------------------------------------------

    /// Kept from the skeleton: one page of agents in `scope`.
    pub async fn fetch_agents(
        &self,
        scope: Option<inbound::FetchAgentsRequestScope>,
    ) -> Result<outbound::FetchAgentsResponsePayload> {
        self.call(
            "fetch_agents_request",
            json!({ "scope": scope }),
            "fetch_agents_response",
            None,
        )
        .await
    }

    /// `fetchAgents` with every option (filter, sort, page, subscribe, sync).
    pub async fn fetch_agents_with(
        &self,
        req: &inbound::FetchAgentsRequest,
    ) -> Result<outbound::FetchAgentsResponsePayload> {
        let rid = self.new_request_id();
        self.call(
            "fetch_agents_request",
            fields_of(req, &rid)?,
            "fetch_agents_response",
            None,
        )
        .await
    }

    pub async fn fetch_agent_history(
        &self,
        req: &inbound::FetchAgentHistoryRequest,
    ) -> Result<outbound::FetchAgentHistoryResponsePayload> {
        let rid = self.new_request_id();
        self.call(
            "fetch_agent_history_request",
            fields_of(req, &rid)?,
            "fetch_agent_history_response",
            None,
        )
        .await
    }

    pub async fn fetch_recent_provider_sessions(
        &self,
        req: &inbound::FetchRecentProviderSessionsRequest,
    ) -> Result<outbound::FetchRecentProviderSessionsResponsePayload> {
        let rid = self.new_request_id();
        self.call(
            "fetch_recent_provider_sessions_request",
            fields_of(req, &rid)?,
            "fetch_recent_provider_sessions_response",
            None,
        )
        .await
    }

    pub async fn fetch_workspaces(
        &self,
        req: &inbound::FetchWorkspacesRequest,
    ) -> Result<outbound::FetchWorkspacesResponsePayload> {
        let rid = self.new_request_id();
        self.call(
            "fetch_workspaces_request",
            fields_of(req, &rid)?,
            "fetch_workspaces_response",
            None,
        )
        .await
    }

    /// Returns the created agent snapshot.
    pub async fn create_agent(&self, req: &inbound::CreateAgentRequest) -> Result<Value> {
        let rid = self.new_request_id();
        let mut fields = fields_of(req, &rid)?;
        fields.as_object_mut().map(|o| o.remove("requestId"));
        let f = self
            .status_frame(
                "create_agent_request",
                fields,
                &["agent_created", "agent_create_failed"],
                None,
            )
            .await?;
        agent_from_status(&f)
    }

    /// Returns the imported (resumed) agent snapshot.
    pub async fn import_agent(&self, req: &inbound::ImportAgentRequest) -> Result<Value> {
        let rid = self.new_request_id();
        let mut fields = fields_of(req, &rid)?;
        fields.as_object_mut().map(|o| o.remove("requestId"));
        let f = self
            .status_frame(
                "import_agent_request",
                fields,
                &["agent_resumed", "agent_create_failed"],
                None,
            )
            .await?;
        agent_from_status(&f)
    }

    /// Returns the `agent_refreshed` status payload.
    pub async fn refresh_agent(&self, agent_id: &str) -> Result<Value> {
        let f = self
            .status_frame(
                "refresh_agent_request",
                json!({ "agentId": agent_id }),
                &["agent_refreshed"],
                None,
            )
            .await?;
        Ok(f.json()["payload"].clone())
    }

    pub async fn archive_agent(&self, agent_id: &str) -> Result<String> {
        let p: outbound::AgentArchivedPayload = self
            .call(
                "archive_agent_request",
                json!({ "agentId": agent_id }),
                "agent_archived",
                None,
            )
            .await?;
        Ok(p.archived_at)
    }

    pub async fn detach_agent(&self, agent_id: &str) -> Result<()> {
        let f = self
            .ns_frame("agent.detach.request", json!({ "agentId": agent_id }), None)
            .await?;
        check_accepted(&f, "accepted", "detachAgent rejected")
    }

    pub async fn cancel_agent_auto_resume(&self, agent_id: &str) -> Result<()> {
        let f = self
            .ns_frame(
                "agent.cancel_auto_resume.request",
                json!({ "agentId": agent_id }),
                None,
            )
            .await?;
        check_accepted(&f, "accepted", "cancelAgentAutoResume rejected")
    }

    pub async fn cancel_agent(&self, agent_id: &str) -> Result<()> {
        let f = self
            .rpc_frame(
                "cancel_agent_request",
                json!({ "agentId": agent_id }),
                "cancel_agent_response",
                None,
            )
            .await?;
        check_error(&f)
    }

    /// `name` and/or `labels`.
    pub async fn update_agent(
        &self,
        agent_id: &str,
        name: Option<&str>,
        labels: Option<&serde_json::Map<String, Value>>,
    ) -> Result<()> {
        let labels = labels.filter(|l| !l.is_empty()).cloned().map(Value::Object);
        let f = self
            .rpc_frame(
                "update_agent_request",
                json!({ "agentId": agent_id, "name": name, "labels": labels }),
                "update_agent_response",
                None,
            )
            .await?;
        check_accepted(&f, "accepted", "updateAgent rejected")
    }

    /// Returns the provider notice, if any.
    pub async fn set_agent_mode(&self, agent_id: &str, mode_id: &str) -> Result<Option<Value>> {
        let f = self
            .rpc_frame(
                "set_agent_mode_request",
                json!({ "agentId": agent_id, "modeId": mode_id }),
                "set_agent_mode_response",
                None,
            )
            .await?;
        check_accepted(&f, "accepted", "setAgentMode rejected")?;
        Ok(notice(&f))
    }

    pub async fn set_agent_model(&self, agent_id: &str, model_id: Option<&str>) -> Result<()> {
        let mut fields = json!({ "agentId": agent_id });
        fields["modelId"] = json!(model_id);
        let f = self
            .rpc_frame_keep_nulls(
                "set_agent_model_request",
                fields,
                "set_agent_model_response",
                None,
            )
            .await?;
        check_accepted(&f, "accepted", "setAgentModel rejected")
    }

    pub async fn set_agent_thinking_option(
        &self,
        agent_id: &str,
        thinking_option_id: Option<&str>,
    ) -> Result<Option<Value>> {
        let mut fields = json!({ "agentId": agent_id });
        fields["thinkingOptionId"] = json!(thinking_option_id);
        let f = self
            .rpc_frame_keep_nulls(
                "set_agent_thinking_request",
                fields,
                "set_agent_thinking_response",
                None,
            )
            .await?;
        check_accepted(&f, "accepted", "setAgentThinkingOption rejected")?;
        Ok(notice(&f))
    }

    pub async fn transfer_agent_provider_account(
        &self,
        agent_id: &str,
        provider_account_id: Option<&str>,
    ) -> Result<Option<Value>> {
        let mut fields = json!({ "agentId": agent_id });
        fields["providerAccountId"] = json!(provider_account_id);
        let f = self
            .rpc_frame_keep_nulls(
                "agent.provider_account.transfer.request",
                fields,
                "agent.provider_account.transfer.response",
                None,
            )
            .await?;
        check_accepted(&f, "accepted", "transferAgentProviderAccount rejected")?;
        Ok(notice(&f))
    }

    /// `target` holds `provider`, `providerAccountId`, `model`, `thinkingOptionId` (nullable).
    /// Returns the subagent results.
    pub async fn clean_cut_agent(
        &self,
        agent_id: &str,
        target: serde_json::Map<String, Value>,
    ) -> Result<Vec<Value>> {
        let mut fields = json!({ "agentId": agent_id });
        for (k, v) in target {
            fields[k] = v;
        }
        let f = self
            .rpc_frame_keep_nulls(
                "agent.clean_cut.request",
                fields,
                "agent.clean_cut.response",
                Some(CLEAN_CUT_TIMEOUT_MS),
            )
            .await?;
        check_accepted(&f, "accepted", "cleanCutAgent rejected")?;
        Ok(f.json()["payload"]["subagents"]
            .as_array()
            .cloned()
            .unwrap_or_default())
    }

    /// `mode`: `"conversation"`, `"files"` or `"both"`.
    pub async fn rewind_agent(
        &self,
        agent_id: &str,
        message_id: &str,
        mode: &str,
    ) -> Result<outbound::AgentRewindResponsePayload> {
        let f = self
            .ns_frame(
                "agent.rewind.request",
                json!({ "agentId": agent_id, "messageId": message_id, "mode": mode }),
                None,
            )
            .await?;
        check_accepted(&f, "ok", "Agent rewind failed")?;
        decode(&f)
    }

    pub async fn clear_agent_attention(&self, agent_ids: &[String]) -> Result<()> {
        let agent_id = if agent_ids.len() == 1 {
            json!(agent_ids[0])
        } else {
            json!(agent_ids)
        };
        self.rpc_frame(
            "clear_agent_attention",
            json!({ "agentId": agent_id }),
            "clear_agent_attention_response",
            None,
        )
        .await
        .map(|_| ())
    }

    pub async fn send_message(
        &self,
        agent_id: &str,
        text: &str,
        options: SendMessageOptions,
    ) -> Result<()> {
        let message_id = options
            .message_id
            .clone()
            .unwrap_or_else(|| self.new_request_id());
        let f = self
            .rpc_frame(
                "send_agent_message_request",
                json!({
                    "agentId": agent_id,
                    "text": text,
                    "messageId": message_id,
                    "activeTurnBehavior": options.active_turn_behavior,
                    "images": options.images,
                    "attachments": options.attachments,
                }),
                "send_agent_message_response",
                None,
            )
            .await?;
        check_accepted(&f, "accepted", "sendAgentMessage rejected")
    }

    /// Fire-and-forget answer to a permission request (`requestId` is the permission's id).
    pub fn respond_to_permission(
        &self,
        agent_id: &str,
        request_id: &str,
        response: Value,
    ) -> Result<()> {
        self.send_session(json!({
            "type": "agent_permission_response",
            "agentId": agent_id,
            "requestId": request_id,
            "response": response,
        }))
    }

    pub async fn fetch_agent_timeline(
        &self,
        agent_id: &str,
        options: FetchAgentTimelineOptions,
    ) -> Result<outbound::FetchAgentTimelineResponsePayload> {
        let f = self
            .rpc_frame(
                "fetch_agent_timeline_request",
                json!({
                    "agentId": agent_id,
                    "direction": options.direction,
                    "cursor": options.cursor,
                    "limit": options.limit,
                    "projection": options.projection,
                    "mergeWindow": options.merge_window.then_some(true),
                }),
                "fetch_agent_timeline_response",
                options.timeout_ms,
            )
            .await?;
        check_error(&f)?;
        decode(&f)
    }

    /// Selective timeline streaming; a no-op on daemons without `selectiveAgentTimeline`.
    pub async fn set_agent_timeline_subscription(&self, agent_ids: &[String]) -> Result<()> {
        if !self.has_feature("selectiveAgentTimeline") {
            return Ok(());
        }
        let mut ids: Vec<&String> = agent_ids.iter().collect();
        ids.sort();
        ids.dedup();
        self.ns_frame(
            "agent.timeline.set_subscription.request",
            json!({ "agentIds": ids }),
            None,
        )
        .await
        .map(|_| ())
    }

    pub async fn build_agent_fork_context(
        &self,
        agent_id: &str,
        boundary_cursor: Option<Value>,
        boundary_message_id: Option<&str>,
    ) -> Result<outbound::AgentForkContextResponsePayload> {
        let f = self
            .ns_frame(
                "agent.fork_context.request",
                json!({ "agentId": agent_id, "boundaryCursor": boundary_cursor, "boundaryMessageId": boundary_message_id }),
                Some(15_000),
            )
            .await?;
        check_error(&f)?;
        decode(&f)
    }

    pub async fn list_provider_subagents(
        &self,
        parent_agent_id: &str,
        timeout_ms: Option<u64>,
    ) -> Result<outbound::AgentProviderSubagentsListResponsePayload> {
        let f = self
            .ns_frame(
                "agent.provider_subagents.list.request",
                json!({ "parentAgentId": parent_agent_id }),
                timeout_ms,
            )
            .await?;
        check_error(&f)?;
        decode(&f)
    }

    pub async fn fetch_provider_subagent_timeline(
        &self,
        parent_agent_id: &str,
        subagent_id: &str,
        options: SubagentTimelineOptions,
    ) -> Result<outbound::AgentProviderSubagentsTimelineGetResponsePayload> {
        let f = self
            .ns_frame(
                "agent.provider_subagents.timeline.get.request",
                json!({
                    "parentAgentId": parent_agent_id,
                    "subagentId": subagent_id,
                    "direction": options.direction,
                    "cursor": options.cursor,
                    "limit": options.limit,
                }),
                options.timeout_ms,
            )
            .await?;
        check_error(&f)?;
        decode(&f)
    }

    pub async fn list_provider_agent_definitions(
        &self,
        cwd: Option<&str>,
    ) -> Result<outbound::AgentProviderDefinitionsListResponsePayload> {
        self.ns(
            "agent.provider_definitions.list.request",
            json!({ "cwd": cwd }),
            None,
        )
        .await
    }

    /// `draft_config` is the `ListCommandsDraftConfig` for an agent not created yet.
    pub async fn list_commands(
        &self,
        agent_id: &str,
        draft_config: Option<Value>,
    ) -> Result<outbound::ListCommandsResponsePayload> {
        self.call(
            "list_commands_request",
            json!({ "agentId": agent_id, "draftConfig": draft_config }),
            "list_commands_response",
            None,
        )
        .await
    }

    // ---- workspaces, projects, labels, todos -------------------------------------------------

    pub async fn set_workspace_pinned(
        &self,
        workspace_id: &str,
        pinned: bool,
    ) -> Result<Option<String>> {
        let f = self
            .ns_frame(
                "workspace.pin.set.request",
                json!({ "workspaceId": workspace_id, "pinned": pinned }),
                None,
            )
            .await?;
        check_accepted(&f, "accepted", "setWorkspacePinned rejected")?;
        let p: outbound::WorkspacePinSetResponsePayload = decode(&f)?;
        Ok(p.pinned_at)
    }

    /// `sync`: `{ generation, afterSeq }`.
    pub async fn list_workspace_labels(
        &self,
        subscription_id: &str,
        sync: Option<Value>,
    ) -> Result<outbound::WorkspaceLabelListResponsePayload> {
        self.ns(
            "workspace.label.list.request",
            json!({ "subscribe": { "subscriptionId": subscription_id }, "sync": sync }),
            None,
        )
        .await
    }

    /// Assigns (or removes) a label on a workspace.
    pub async fn set_workspace_label(
        &self,
        workspace_id: &str,
        label: &inbound::WorkspaceLabelAssignmentSetRequestLabel,
        assigned: bool,
    ) -> Result<outbound::WorkspaceLabelAssignmentSetResponsePayload> {
        self.ns(
            "workspace.label.assignment.set.request",
            json!({ "workspaceId": workspace_id, "label": label, "assigned": assigned }),
            None,
        )
        .await
    }

    pub async fn update_workspace_label(
        &self,
        name: &str,
        new_name: Option<&str>,
        color: Option<Value>,
    ) -> Result<outbound::WorkspaceLabelUpdateResponsePayload> {
        self.ns(
            "workspace.label.update.request",
            json!({ "name": name, "newName": new_name, "color": color }),
            None,
        )
        .await
    }

    pub async fn delete_workspace_label(
        &self,
        name: &str,
    ) -> Result<outbound::WorkspaceLabelDeleteResponsePayload> {
        self.ns(
            "workspace.label.delete.request",
            json!({ "name": name }),
            None,
        )
        .await
    }

    /// `sync`: `{ generation, afterSeq }` for incremental updates.
    pub async fn list_projects(
        &self,
        sync: Option<Value>,
    ) -> Result<outbound::ProjectListResponsePayload> {
        self.ns("project.list.request", json!({ "sync": sync }), None)
            .await
    }

    pub async fn add_project(&self, cwd: &str) -> Result<outbound::ProjectAddResponsePayload> {
        self.ns("project.add.request", json!({ "cwd": cwd }), None)
            .await
    }

    pub async fn create_project_directory(
        &self,
        parent_path: &str,
        name: &str,
    ) -> Result<outbound::ProjectCreateDirectoryResponsePayload> {
        self.ns(
            "project.create_directory.request",
            json!({ "parentPath": parent_path, "name": name }),
            None,
        )
        .await
    }

    async fn todo<T: DeserializeOwned, R: Serialize>(&self, op: &str, req: &R) -> Result<T> {
        let rid = self.new_request_id();
        self.ns(
            &format!("project.todo.{op}.request"),
            fields_of(req, &rid)?,
            None,
        )
        .await
    }

    pub async fn list_project_todos(
        &self,
        req: &inbound::ProjectTodoListRequest,
    ) -> Result<outbound::ProjectTodoListResponsePayload> {
        self.todo("list", req).await
    }
    pub async fn create_project_todo(
        &self,
        req: &inbound::ProjectTodoCreateRequest,
    ) -> Result<outbound::ProjectTodoCreateResponsePayload> {
        self.todo("create", req).await
    }
    pub async fn update_project_todo(
        &self,
        req: &inbound::ProjectTodoUpdateRequest,
    ) -> Result<outbound::ProjectTodoUpdateResponsePayload> {
        self.todo("update", req).await
    }
    pub async fn set_project_todo_status(
        &self,
        req: &inbound::ProjectTodoSetStatusRequest,
    ) -> Result<outbound::ProjectTodoSetStatusResponsePayload> {
        self.todo("set_status", req).await
    }
    pub async fn delete_project_todo(
        &self,
        req: &inbound::ProjectTodoDeleteRequest,
    ) -> Result<outbound::ProjectTodoDeleteResponsePayload> {
        self.todo("delete", req).await
    }

    pub async fn read_project_config(&self, repo_root: &str) -> Result<Value> {
        self.call(
            "read_project_config_request",
            json!({ "repoRoot": repo_root }),
            "read_project_config_response",
            None,
        )
        .await
    }

    pub async fn write_project_config(
        &self,
        repo_root: &str,
        config: Value,
        expected_revision: Option<Value>,
    ) -> Result<Value> {
        self.call(
            "write_project_config_request",
            json!({ "repoRoot": repo_root, "config": config, "expectedRevision": expected_revision }),
            "write_project_config_response",
            None,
        )
        .await
    }

    pub async fn get_branch_suggestions(
        &self,
        cwd: &str,
        query: Option<&str>,
        limit: Option<u32>,
    ) -> Result<outbound::BranchSuggestionsResponsePayload> {
        self.call(
            "branch_suggestions_request",
            json!({ "cwd": cwd, "query": query, "limit": limit }),
            "branch_suggestions_response",
            None,
        )
        .await
    }

    pub async fn get_directory_suggestions(
        &self,
        req: &inbound::DirectorySuggestionsRequest,
    ) -> Result<outbound::DirectorySuggestionsResponsePayload> {
        let rid = self.new_request_id();
        self.call(
            "directory_suggestions_request",
            fields_of(req, &rid)?,
            "directory_suggestions_response",
            Some(60_000),
        )
        .await
    }

    // ---- checkout / git -----------------------------------------------------------------------

    pub async fn get_checkout_status(&self, cwd: &str) -> Result<Value> {
        self.call(
            "checkout_status_request",
            json!({ "cwd": cwd }),
            "checkout_status_response",
            None,
        )
        .await
    }

    /// `compare`: `{ mode: "uncommitted" | "base", baseRef?, ignoreWhitespace? }`. The
    /// subscription is renewed after every reconnect until `unsubscribe_checkout_diff`.
    pub async fn subscribe_checkout_diff(
        &self,
        cwd: &str,
        compare: Value,
        subscription_id: Option<String>,
    ) -> Result<outbound::SubscribeCheckoutDiffResponsePayload> {
        let subscription_id = subscription_id.unwrap_or_else(|| self.new_request_id());
        let compare = normalize_diff_compare(&compare);
        let previous = self
            .inner
            .borrow_mut()
            .checkout_diff_subs
            .insert(subscription_id.clone(), (cwd.to_owned(), compare.clone()));
        let result = self
            .call(
                "subscribe_checkout_diff_request",
                json!({ "subscriptionId": subscription_id, "cwd": cwd, "compare": compare }),
                "subscribe_checkout_diff_response",
                None,
            )
            .await;
        if result.is_err() {
            let mut inner = self.inner.borrow_mut();
            match previous {
                Some(p) => inner.checkout_diff_subs.insert(subscription_id, p),
                None => inner.checkout_diff_subs.remove(&subscription_id),
            };
        }
        result
    }

    pub fn unsubscribe_checkout_diff(&self, subscription_id: &str) -> Result<()> {
        self.inner
            .borrow_mut()
            .checkout_diff_subs
            .remove(subscription_id);
        self.send_session(json!({ "type": "unsubscribe_checkout_diff_request", "subscriptionId": subscription_id }))
    }

    pub async fn checkout_commit(
        &self,
        cwd: &str,
        message: Option<&str>,
        add_all: Option<bool>,
    ) -> Result<outbound::CheckoutCommitResponsePayload> {
        self.call(
            "checkout_commit_request",
            json!({ "cwd": cwd, "message": message, "addAll": add_all }),
            "checkout_commit_response",
            None,
        )
        .await
    }

    /// `strategy`: `"merge"` or `"squash"`.
    pub async fn checkout_merge(
        &self,
        cwd: &str,
        base_ref: Option<&str>,
        strategy: Option<&str>,
        require_clean_target: Option<bool>,
    ) -> Result<outbound::CheckoutMergeResponsePayload> {
        self.call(
            "checkout_merge_request",
            json!({ "cwd": cwd, "baseRef": base_ref, "strategy": strategy, "requireCleanTarget": require_clean_target }),
            "checkout_merge_response",
            None,
        )
        .await
    }

    pub async fn checkout_merge_from_base(
        &self,
        cwd: &str,
        base_ref: Option<&str>,
        require_clean_target: Option<bool>,
    ) -> Result<outbound::CheckoutMergeFromBaseResponsePayload> {
        self.call(
            "checkout_merge_from_base_request",
            json!({ "cwd": cwd, "baseRef": base_ref, "requireCleanTarget": require_clean_target }),
            "checkout_merge_from_base_response",
            None,
        )
        .await
    }

    pub async fn checkout_pull(&self, cwd: &str) -> Result<outbound::CheckoutPullResponsePayload> {
        self.call(
            "checkout_pull_request",
            json!({ "cwd": cwd }),
            "checkout_pull_response",
            None,
        )
        .await
    }

    pub async fn checkout_push(&self, cwd: &str) -> Result<outbound::CheckoutPushResponsePayload> {
        self.call(
            "checkout_push_request",
            json!({ "cwd": cwd }),
            "checkout_push_response",
            None,
        )
        .await
    }

    pub async fn checkout_switch_branch(
        &self,
        cwd: &str,
        branch: &str,
    ) -> Result<outbound::CheckoutSwitchBranchResponsePayload> {
        self.call(
            "checkout_switch_branch_request",
            json!({ "cwd": cwd, "branch": branch }),
            "checkout_switch_branch_response",
            None,
        )
        .await
    }

    pub async fn checkout_discard_changes(
        &self,
        cwd: &str,
        paths: &[String],
    ) -> Result<outbound::CheckoutDiscardChangesResponsePayload> {
        self.ns(
            "checkout.discard_changes.request",
            json!({ "cwd": cwd, "paths": paths }),
            None,
        )
        .await
    }

    pub async fn list_checkout_commits(
        &self,
        cwd: &str,
    ) -> Result<outbound::CheckoutCommitsListResponsePayload> {
        let f = self
            .ns_frame(
                "checkout.commits.list.request",
                json!({ "cwd": cwd }),
                Some(60_000),
            )
            .await?;
        check_error(&f)?;
        decode(&f)
    }

    pub async fn checkout_pr_create(
        &self,
        cwd: &str,
        title: Option<&str>,
        body: Option<&str>,
        base_ref: Option<&str>,
    ) -> Result<outbound::CheckoutPrCreateResponsePayload> {
        self.call(
            "checkout_pr_create_request",
            json!({ "cwd": cwd, "title": title, "body": body, "baseRef": base_ref }),
            "checkout_pr_create_response",
            None,
        )
        .await
    }

    /// `method`: `"merge"`, `"squash"` or `"rebase"`.
    pub async fn checkout_pr_merge(
        &self,
        cwd: &str,
        method: &str,
    ) -> Result<outbound::CheckoutPrMergeResponsePayload> {
        self.call(
            "checkout_pr_merge_request",
            json!({ "cwd": cwd, "mergeMethod": method }),
            "checkout_pr_merge_response",
            None,
        )
        .await
    }

    pub async fn checkout_pr_status(
        &self,
        cwd: &str,
    ) -> Result<outbound::CheckoutPrStatusResponsePayload> {
        self.call(
            "checkout_pr_status_request",
            json!({ "cwd": cwd }),
            "checkout_pr_status_response",
            None,
        )
        .await
    }

    /// `method` is required when enabling.
    pub async fn checkout_forge_set_auto_merge(
        &self,
        cwd: &str,
        enabled: bool,
        method: Option<&str>,
    ) -> Result<outbound::CheckoutForgeSetAutoMergeResponsePayload> {
        let method = if enabled { method } else { None };
        self.ns(
            "checkout.forge.set_auto_merge.request",
            json!({ "cwd": cwd, "enabled": enabled, "mergeMethod": method }),
            Some(60_000),
        )
        .await
    }

    pub async fn checkout_ci_list_runs(
        &self,
        cwd: &str,
    ) -> Result<outbound::CheckoutCiListRunsResponsePayload> {
        self.ns(
            "checkout.ci.list_runs.request",
            json!({ "cwd": cwd }),
            Some(45_000),
        )
        .await
    }

    pub async fn checkout_streams_get_graph(
        &self,
        cwd: &str,
        fetch: bool,
    ) -> Result<outbound::CheckoutStreamsGetGraphResponsePayload> {
        self.ns(
            "checkout.streams.get_graph.request",
            json!({ "cwd": cwd, "fetch": fetch.then_some(true) }),
            Some(120_000),
        )
        .await
    }

    pub async fn stash_save(
        &self,
        cwd: &str,
        branch: Option<&str>,
    ) -> Result<outbound::StashSaveResponsePayload> {
        self.call(
            "stash_save_request",
            json!({ "cwd": cwd, "branch": branch }),
            "stash_save_response",
            None,
        )
        .await
    }

    pub async fn stash_pop(
        &self,
        cwd: &str,
        stash_index: u32,
    ) -> Result<outbound::StashPopResponsePayload> {
        self.call(
            "stash_pop_request",
            json!({ "cwd": cwd, "stashIndex": stash_index }),
            "stash_pop_response",
            None,
        )
        .await
    }

    pub async fn stash_list(
        &self,
        cwd: &str,
        frogg_only: Option<bool>,
    ) -> Result<outbound::StashListResponsePayload> {
        self.call(
            "stash_list_request",
            json!({ "cwd": cwd, "froggOnly": frogg_only }),
            "stash_list_response",
            None,
        )
        .await
    }

    // ---- files --------------------------------------------------------------------------------

    async fn file_explorer(
        &self,
        cwd: &str,
        path: &str,
        mode: &str,
        request_id: Option<String>,
        accept_binary: bool,
        max_bytes: Option<u64>,
    ) -> Result<SessionFrame> {
        self.rpc_frame(
            "file_explorer_request",
            json!({
                "requestId": request_id,
                "cwd": cwd, "path": path, "mode": mode,
                "acceptBinary": accept_binary.then_some(true),
                "maxBytes": max_bytes,
            }),
            "file_explorer_response",
            None,
        )
        .await
    }

    /// The directory listing payload (`payload.directory`).
    pub async fn list_directory(&self, cwd: &str, path: &str) -> Result<Value> {
        let f = self
            .file_explorer(cwd, path, "list", None, false, None)
            .await?;
        check_error(&f)?;
        let dir = f.json()["payload"]["directory"].clone();
        if dir.is_null() {
            return Err(Error::Daemon("Directory listing unavailable.".into()));
        }
        Ok(dir)
    }

    /// Reads a file, over binary frames when the daemon streams it.
    pub async fn read_file(
        &self,
        cwd: &str,
        path: &str,
        max_bytes: Option<u64>,
    ) -> Result<FileReadResult> {
        let rid = self.new_request_id();
        self.inner.borrow_mut().binary_reads.insert(
            rid.clone(),
            BinaryRead {
                cwd: cwd.into(),
                path: path.into(),
                max_bytes,
                begin: None,
                chunks: Vec::new(),
            },
        );
        let result = self
            .file_explorer(cwd, path, "file", Some(rid.clone()), true, max_bytes)
            .await;
        let completed = {
            let mut inner = self.inner.borrow_mut();
            inner.binary_reads.remove(&rid);
            inner.completed_reads.remove(&rid)
        };
        let f = result?;
        check_error(&f)?;
        if let Some(done) = completed {
            return Ok(done);
        }
        legacy_file(&f.json()["payload"]["file"], path)
    }

    /// Returns `payload.result` (the write outcome).
    pub async fn write_file(
        &self,
        cwd: &str,
        path: &str,
        content: &str,
        expected_modified_at: &str,
        expected_revision: Option<&str>,
    ) -> Result<Value> {
        let p: outbound::FsFileWriteResponsePayload = self
            .call(
                "fs.file.write.request",
                json!({ "cwd": cwd, "path": path, "content": content, "expectedModifiedAt": expected_modified_at, "expectedRevision": expected_revision }),
                "fs.file.write.response",
                None,
            )
            .await?;
        Ok(p.result)
    }

    /// `kind`: `"file"` or `"directory"`.
    pub async fn create_file_entry(
        &self,
        cwd: &str,
        parent_path: &str,
        name: &str,
        kind: &str,
    ) -> Result<outbound::FsEntryCreateResponsePayload> {
        self.ns(
            "fs.entry.create.request",
            json!({ "cwd": cwd, "parentPath": parent_path, "name": name, "kind": kind }),
            None,
        )
        .await
    }

    pub async fn rename_file_entry(
        &self,
        cwd: &str,
        path: &str,
        name: &str,
    ) -> Result<outbound::FsEntryRenameResponsePayload> {
        self.ns(
            "fs.entry.rename.request",
            json!({ "cwd": cwd, "path": path, "name": name }),
            None,
        )
        .await
    }

    pub async fn duplicate_file_entry(
        &self,
        cwd: &str,
        path: &str,
    ) -> Result<outbound::FsEntryDuplicateResponsePayload> {
        self.ns(
            "fs.entry.duplicate.request",
            json!({ "cwd": cwd, "path": path }),
            None,
        )
        .await
    }

    pub async fn delete_file_entry(
        &self,
        cwd: &str,
        path: &str,
    ) -> Result<outbound::FsEntryDeleteResponsePayload> {
        self.ns(
            "fs.entry.delete.request",
            json!({ "cwd": cwd, "path": path }),
            None,
        )
        .await
    }

    pub async fn zip_directory(
        &self,
        cwd: &str,
        path: &str,
        include_ignored: bool,
    ) -> Result<ZipResult> {
        let rid = self.new_request_id();
        self.inner.borrow_mut().binary_reads.insert(
            rid.clone(),
            BinaryRead {
                cwd: cwd.into(),
                path: path.into(),
                max_bytes: None,
                begin: None,
                chunks: Vec::new(),
            },
        );
        let result = self
            .ns_frame(
                "fs.directory.zip.request",
                json!({ "requestId": rid, "cwd": cwd, "path": path, "includeIgnored": include_ignored.then_some(true) }),
                Some(300_000),
            )
            .await;
        let completed = {
            let mut inner = self.inner.borrow_mut();
            inner.binary_reads.remove(&rid);
            inner.completed_reads.remove(&rid)
        };
        let f = result?;
        let payload: outbound::FsDirectoryZipResponsePayload = decode(&f)?;
        let bytes = if payload_error(&f).is_some() {
            None
        } else {
            completed.map(|c| c.bytes)
        };
        Ok(ZipResult { payload, bytes })
    }

    /// Streams a file to the daemon in binary chunks (1 MiB default), pausing while the socket
    /// buffer is above eight chunks.
    pub async fn upload_file_stream(
        &self,
        input: FileUploadInput<'_>,
    ) -> Result<outbound::FileUploadResponsePayload> {
        self.upload_file_stream_cancellable(input, &|| false).await
    }

    /// `upload_file_stream`, polling `cancelled` between chunks. Once it returns true the upload
    /// is aborted: the protocol has no abort frame, so the stream is ended short, which the
    /// daemon treats as a size mismatch and answers by deleting the partial file. Resolves to
    /// `Error::Cancelled` straight away, without waiting for that answer.
    pub async fn upload_file_stream_cancellable(
        &self,
        input: FileUploadInput<'_>,
        cancelled: &dyn Fn() -> bool,
    ) -> Result<outbound::FileUploadResponsePayload> {
        let rid = self.new_request_id();
        let modified_at = input.modified_at.clone().unwrap_or_else(now_iso);
        let size = input.size;
        let chunk = input.chunk_size.unwrap_or(1024 * 1024).max(1);
        let response = self.rpc_frame(
            "file.upload.request",
            json!({ "requestId": rid, "fileName": input.file_name, "mimeType": input.mime_type, "size": size, "modifiedAt": modified_at }),
            "file.upload.response",
            Some(crate::DEFAULT_REQUEST_TIMEOUT_MS + size.div_ceil(64)),
        );
        let begin = FileFrame::Begin {
            request_id: rid.clone(),
            metadata: FileBeginMetadata {
                mime: input.mime_type.clone(),
                size,
                encoding: "binary".into(),
                modified_at: modified_at.clone(),
                revision: None,
                file_name: Some(input.file_name.clone()),
            },
        };
        let send = |f: &FileFrame| -> Result<()> {
            self.send_binary_frame(crate::binary::encode_file_frame(f).map_err(Error::Send)?)
        };
        // Register the waiter (first poll) before streaming, so an early answer is not lost.
        let mut response = Box::pin(response);
        let early = futures::poll!(response.as_mut());
        if let std::task::Poll::Ready(r) = early {
            return decode(&r?);
        }
        send(&begin)?;
        let high_water = chunk * 8;
        let mut sent = 0;
        if let Some(p) = input.on_progress {
            p(0, size);
        }
        let abort = |rid: String| -> Result<outbound::FileUploadResponsePayload> {
            let _ = send(&FileFrame::End { request_id: rid });
            Err(Error::Cancelled)
        };
        while sent < size {
            while self.buffered_amount() > high_water {
                if let std::task::Poll::Ready(r) = futures::poll!(response.as_mut()) {
                    return decode(&r?);
                }
                if cancelled() {
                    return abort(rid);
                }
                crate::sleep(self, 15).await;
            }
            if cancelled() {
                return abort(rid);
            }
            let next = (sent + chunk).min(size);
            let payload = (input.read)(sent, next);
            let n = payload.len() as u64;
            send(&FileFrame::Chunk {
                request_id: rid.clone(),
                payload,
            })?;
            sent += n;
            if let Some(p) = input.on_progress {
                p(sent, size);
            }
            if n == 0 {
                break;
            }
            if let std::task::Poll::Ready(r) = futures::poll!(response.as_mut()) {
                return decode(&r?);
            }
        }
        if cancelled() {
            return abort(rid);
        }
        send(&FileFrame::End { request_id: rid })?;
        decode(&response.await?)
    }

    // ---- terminals ----------------------------------------------------------------------------

    pub async fn list_terminals(
        &self,
        cwd: Option<&str>,
        workspace_id: Option<&str>,
    ) -> Result<outbound::ListTerminalsResponsePayload> {
        self.call(
            "list_terminals_request",
            json!({ "cwd": cwd, "workspaceId": workspace_id }),
            "list_terminals_response",
            None,
        )
        .await
    }

    pub async fn create_terminal(
        &self,
        cwd: &str,
        options: CreateTerminalOptions,
    ) -> Result<outbound::CreateTerminalResponsePayload> {
        let mut fields = serde_json::to_value(&options).map_err(|e| Error::Send(e.to_string()))?;
        fields["cwd"] = cwd.into();
        self.call(
            "create_terminal_request",
            fields,
            "create_terminal_response",
            None,
        )
        .await
    }

    pub async fn kill_terminal(
        &self,
        terminal_id: &str,
    ) -> Result<outbound::KillTerminalResponsePayload> {
        self.call(
            "kill_terminal_request",
            json!({ "terminalId": terminal_id }),
            "kill_terminal_response",
            None,
        )
        .await
    }

    /// Starts the binary stream for a terminal; output arrives via `on_terminal_stream_event`.
    /// `restore` is the inbound `restore` option (e.g. `{ "mode": "snapshot" }`).
    pub async fn subscribe_terminal(
        &self,
        terminal_id: &str,
        restore: Option<Value>,
    ) -> Result<Value> {
        let payload: Value = self
            .call(
                "subscribe_terminal_request",
                json!({ "terminalId": terminal_id, "restore": restore }),
                "subscribe_terminal_response",
                None,
            )
            .await?;
        if payload["error"].is_null() {
            if let Some(slot) = payload["slot"].as_u64() {
                self.inner
                    .borrow_mut()
                    .terminals
                    .set_slot(terminal_id, slot as u8);
            }
        }
        Ok(payload)
    }

    pub fn unsubscribe_terminal(&self, terminal_id: &str) -> Result<()> {
        self.inner
            .borrow_mut()
            .terminals
            .remove_terminal(terminal_id);
        self.send_session(
            json!({ "type": "unsubscribe_terminal_request", "terminalId": terminal_id }),
        )
    }

    /// Keystrokes or a resize: a binary frame once subscribed, JSON before.
    pub fn send_terminal_input(&self, terminal_id: &str, input: TerminalInput) -> Result<()> {
        let frame = self
            .inner
            .borrow()
            .terminals
            .encode_input(terminal_id, &input);
        match frame {
            Some(bytes) => self.send_binary_frame(bytes),
            None => self.send_session(json!({ "type": "terminal_input", "terminalId": terminal_id, "message": input.to_json() })),
        }
    }

    /// Live terminal list updates for a directory; renewed after every reconnect.
    pub fn subscribe_terminals(&self, cwd: &str, workspace_id: Option<&str>) -> Result<()> {
        let key = format!("{cwd}\u{0}{}", workspace_id.unwrap_or_default());
        self.inner
            .borrow_mut()
            .terminal_dir_subs
            .insert(key, (cwd.to_owned(), workspace_id.map(str::to_owned)));
        if !self.is_connected() {
            return Ok(());
        }
        self.send_session(obj(json!({ "type": "subscribe_terminals_request", "cwd": cwd, "workspaceId": workspace_id })))
    }

    // ---- providers ----------------------------------------------------------------------------

    pub async fn get_providers_snapshot(
        &self,
        cwd: Option<&str>,
        if_none_match: Option<&str>,
    ) -> Result<outbound::GetProvidersSnapshotResponsePayload> {
        self.call(
            "get_providers_snapshot_request",
            json!({ "cwd": cwd, "ifNoneMatch": if_none_match }),
            "get_providers_snapshot_response",
            None,
        )
        .await
    }

    pub async fn refresh_providers_snapshot(
        &self,
        cwd: Option<&str>,
        providers: Option<&[String]>,
    ) -> Result<outbound::RefreshProvidersSnapshotResponsePayload> {
        self.call(
            "refresh_providers_snapshot_request",
            json!({ "cwd": cwd, "providers": providers }),
            "refresh_providers_snapshot_response",
            Some(120_000),
        )
        .await
    }

    pub async fn list_provider_models(
        &self,
        provider: &str,
        cwd: Option<&str>,
    ) -> Result<outbound::ListProviderModelsResponsePayload> {
        let f = self
            .rpc_frame(
                "list_provider_models_request",
                json!({ "provider": provider, "cwd": cwd }),
                "list_provider_models_response",
                Some(90_000),
            )
            .await?;
        // Fill defaultThinkingOptionId like `normalizeListProviderModelsPayload`.
        let mut v = f.json();
        let wrapped =
            json!({ "payload": { "entries": [ { "models": v["payload"]["models"].clone() } ] } });
        if let Some(n) = crate::normalize::provider_snapshot_message(&wrapped) {
            v["payload"]["models"] = n["payload"]["entries"][0]["models"].clone();
        }
        serde_json::from_value(v["payload"].take()).map_err(|e| Error::Decode(e.to_string()))
    }

    pub async fn list_provider_features(
        &self,
        draft_config: Value,
    ) -> Result<outbound::ListProviderFeaturesResponsePayload> {
        self.call(
            "list_provider_features_request",
            json!({ "draftConfig": draft_config }),
            "list_provider_features_response",
            Some(90_000),
        )
        .await
    }

    /// `provider_account_id`: `None` omits it, `Some(None)` sends `null`.
    pub async fn list_provider_usage(
        &self,
        provider: Option<&str>,
        provider_account_id: Option<Option<&str>>,
        max_age_ms: Option<u64>,
    ) -> Result<outbound::ProviderUsageListResponsePayload> {
        let mut fields = obj(json!({ "provider": provider, "maxAgeMs": max_age_ms }));
        if let Some(id) = provider_account_id {
            fields["providerAccountId"] = json!(id);
        }
        self.ns_keep_nulls("provider.usage.list.request", fields, None)
            .await
    }

    pub async fn check_provider_updates(
        &self,
        force_refresh: Option<bool>,
    ) -> Result<outbound::ProviderUpdateCheckResponsePayload> {
        self.ns(
            "provider.update.check.request",
            json!({ "forceRefresh": force_refresh }),
            None,
        )
        .await
    }

    pub async fn install_provider_update(
        &self,
        provider: &str,
        timeout_ms: Option<u64>,
    ) -> Result<outbound::ProviderUpdateInstallResponsePayload> {
        self.ns(
            "provider.update.install.request",
            json!({ "provider": provider }),
            timeout_ms,
        )
        .await
    }

    pub async fn list_provider_accounts(
        &self,
        provider: Option<&str>,
    ) -> Result<outbound::ProviderAccountListResponsePayload> {
        self.ns(
            "provider.account.list.request",
            json!({ "provider": provider }),
            None,
        )
        .await
    }

    pub async fn create_provider_account(
        &self,
        provider: &str,
        name: &str,
        linked_folders: Option<&[String]>,
    ) -> Result<outbound::ProviderAccountCreateResponsePayload> {
        self.ns(
            "provider.account.create.request",
            json!({ "provider": provider, "name": name, "linkedFolders": linked_folders }),
            None,
        )
        .await
    }

    pub async fn delete_provider_account(
        &self,
        account_id: &str,
    ) -> Result<outbound::ProviderAccountDeleteResponsePayload> {
        self.ns(
            "provider.account.delete.request",
            json!({ "accountId": account_id }),
            None,
        )
        .await
    }

    pub async fn sign_out_provider_account(
        &self,
        account_id: &str,
    ) -> Result<outbound::ProviderAccountSignOutResponsePayload> {
        self.ns(
            "provider.account.sign_out.request",
            json!({ "accountId": account_id }),
            None,
        )
        .await
    }

    pub async fn set_active_provider_account(
        &self,
        provider: &str,
        account_id: Option<&str>,
    ) -> Result<outbound::ProviderAccountSetActiveResponsePayload> {
        let mut fields = json!({ "provider": provider });
        fields["accountId"] = json!(account_id);
        self.ns_keep_nulls("provider.account.set_active.request", fields, None)
            .await
    }

    pub async fn set_provider_account_preferences(
        &self,
        account_id: &str,
        preferences: Option<Value>,
    ) -> Result<outbound::ProviderAccountSetPreferencesResponsePayload> {
        let mut fields = json!({ "accountId": account_id });
        fields["preferences"] = preferences.unwrap_or(Value::Null);
        self.ns_keep_nulls("provider.account.set_preferences.request", fields, None)
            .await
    }

    pub async fn export_provider_accounts(
        &self,
        provider: &str,
        account_ids: Option<&[String]>,
    ) -> Result<outbound::ProviderAccountExportResponsePayload> {
        self.ns(
            "provider.account.export.request",
            json!({ "provider": provider, "accountIds": account_ids }),
            None,
        )
        .await
    }

    pub async fn import_provider_accounts(
        &self,
        bundle: Value,
    ) -> Result<outbound::ProviderAccountImportResponsePayload> {
        self.ns(
            "provider.account.import.request",
            json!({ "bundle": bundle }),
            None,
        )
        .await
    }

    pub async fn list_claude_plugins(
        &self,
    ) -> Result<outbound::ProviderClaudePluginsListResponsePayload> {
        self.ns("provider.claude_plugins.list.request", json!({}), None)
            .await
    }

    // ---- daemon -------------------------------------------------------------------------------

    pub async fn get_daemon_status(
        &self,
        timeout_ms: Option<u64>,
    ) -> Result<outbound::DaemonGetStatusResponsePayload> {
        self.ns("daemon.get_status.request", json!({}), timeout_ms)
            .await
    }

    pub async fn get_daemon_config(&self) -> Result<outbound::GetDaemonConfigResponsePayload> {
        self.call(
            "get_daemon_config_request",
            json!({}),
            "get_daemon_config_response",
            None,
        )
        .await
    }

    pub async fn patch_daemon_config(
        &self,
        config: Value,
    ) -> Result<outbound::SetDaemonConfigResponsePayload> {
        self.call(
            "set_daemon_config_request",
            json!({ "config": config }),
            "set_daemon_config_response",
            None,
        )
        .await
    }

    pub async fn get_daemon_pairing_offer(
        &self,
        timeout_ms: Option<u64>,
    ) -> Result<outbound::DaemonGetPairingOfferResponsePayload> {
        self.ns("daemon.get_pairing_offer.request", json!({}), timeout_ms)
            .await
    }

    pub async fn get_daemon_security_posture(
        &self,
        timeout_ms: Option<u64>,
    ) -> Result<outbound::DaemonGetSecurityPostureResponsePayload> {
        self.ns("daemon.get_security_posture.request", json!({}), timeout_ms)
            .await
    }

    pub async fn set_security_finding_acknowledged(
        &self,
        finding_id: &str,
        acknowledged: bool,
    ) -> Result<outbound::DaemonSetSecurityFindingAcknowledgedResponsePayload> {
        self.ns(
            "daemon.set_security_finding_acknowledged.request",
            json!({ "findingId": finding_id, "acknowledged": acknowledged }),
            None,
        )
        .await
    }

    pub async fn get_host_metrics(
        &self,
        timeout_ms: Option<u64>,
    ) -> Result<outbound::DaemonHostGetMetricsResponsePayload> {
        self.ns("daemon.host.get_metrics.request", json!({}), timeout_ms)
            .await
    }

    pub async fn collect_diagnostics(&self) -> Result<outbound::DiagnosticsResponsePayload> {
        self.ns("diagnostics.request", json!({}), None).await
    }

    pub async fn list_skills(
        &self,
        timeout_ms: Option<u64>,
    ) -> Result<outbound::DaemonSkillsListResponsePayload> {
        self.ns("daemon.skills.list.request", json!({}), timeout_ms)
            .await
    }

    pub async fn get_skill_content(
        &self,
        skill_id: &str,
    ) -> Result<outbound::DaemonSkillsGetContentResponsePayload> {
        self.ns(
            "daemon.skills.get_content.request",
            json!({ "skillId": skill_id }),
            Some(30_000),
        )
        .await
    }

    pub async fn set_skill_enabled(
        &self,
        skill_id: &str,
        enabled: bool,
    ) -> Result<outbound::DaemonSkillsSetEnabledResponsePayload> {
        self.ns(
            "daemon.skills.set_enabled.request",
            json!({ "skillId": skill_id, "enabled": enabled }),
            None,
        )
        .await
    }

    pub async fn list_owned_storage(
        &self,
        refresh: bool,
    ) -> Result<outbound::DaemonStorageListResponsePayload> {
        self.ns(
            "daemon.storage.list.request",
            json!({ "refresh": refresh.then_some(true) }),
            Some(300_000),
        )
        .await
    }

    pub async fn clean_owned_storage(
        &self,
        category_id: &str,
    ) -> Result<outbound::DaemonStorageCleanResponsePayload> {
        self.ns(
            "daemon.storage.clean.request",
            json!({ "categoryId": category_id }),
            Some(600_000),
        )
        .await
    }

    /// Returns the `restart_requested` status payload.
    pub async fn restart_server(&self, reason: Option<&str>) -> Result<Value> {
        let reason = reason.filter(|r| !r.trim().is_empty());
        let f = self
            .status_frame(
                "restart_server_request",
                json!({ "reason": reason }),
                &["restart_requested"],
                None,
            )
            .await?;
        Ok(f.json()["payload"].clone())
    }

    pub async fn update_daemon(&self) -> Result<outbound::DaemonUpdateResponsePayload> {
        self.ns("daemon.update.request", json!({}), Some(300_000))
            .await
    }

    /// Gated on `daemonUpdateRuns`.
    pub async fn check_daemon_update(
        &self,
        channel: Option<&str>,
    ) -> Result<outbound::DaemonUpdateCheckResponsePayload> {
        self.require(
            "daemonUpdateRuns",
            "Update the host to manage daemon updates from the app.",
        )?;
        self.ns(
            "daemon.update.check.request",
            json!({ "channel": channel }),
            Some(60_000),
        )
        .await
    }

    pub async fn start_daemon_update(
        &self,
        version: Option<&str>,
        channel: Option<&str>,
    ) -> Result<outbound::DaemonUpdateStartResponsePayload> {
        self.require(
            "daemonUpdateRuns",
            "Update the host to manage daemon updates from the app.",
        )?;
        self.ns(
            "daemon.update.start.request",
            json!({ "version": version, "channel": channel }),
            Some(60_000),
        )
        .await
    }

    pub async fn get_daemon_update_status(
        &self,
    ) -> Result<outbound::DaemonUpdateGetStatusResponsePayload> {
        self.require(
            "daemonUpdateRuns",
            "Update the host to manage daemon updates from the app.",
        )?;
        self.ns("daemon.update.get_status.request", json!({}), None)
            .await
    }

    const DEV_DAEMON_GATE: &'static str = "Update the host to start and stop development daemons.";

    pub async fn get_dev_daemon_status(
        &self,
    ) -> Result<outbound::DaemonDevDaemonGetStatusResponsePayload> {
        self.require("daemonChannelControl", Self::DEV_DAEMON_GATE)?;
        self.ns("daemon.dev_daemon.get_status.request", json!({}), None)
            .await
    }

    pub async fn start_dev_daemon(
        &self,
        cwd: &str,
    ) -> Result<outbound::DaemonDevDaemonStartResponsePayload> {
        self.require("daemonChannelControl", Self::DEV_DAEMON_GATE)?;
        self.ns(
            "daemon.dev_daemon.start.request",
            json!({ "cwd": cwd }),
            Some(DAEMON_CONTROL_TIMEOUT_MS),
        )
        .await
    }

    pub async fn stop_dev_daemon(
        &self,
        cwd: Option<&str>,
    ) -> Result<outbound::DaemonDevDaemonStopResponsePayload> {
        self.require("daemonChannelControl", Self::DEV_DAEMON_GATE)?;
        self.ns(
            "daemon.dev_daemon.stop.request",
            json!({ "cwd": cwd }),
            Some(DAEMON_CONTROL_TIMEOUT_MS),
        )
        .await
    }

    /// `target`: `"daemon"` or `"web"`. Gated on `devDaemonRebuild`.
    pub async fn rebuild_dev_daemon(
        &self,
        target: &str,
        cwd: Option<&str>,
    ) -> Result<outbound::DaemonDevDaemonRebuildResponsePayload> {
        self.require(
            "devDaemonRebuild",
            "Update the host to rebuild the development daemon from the app.",
        )?;
        self.ns(
            "daemon.dev_daemon.rebuild.request",
            json!({ "target": target, "cwd": cwd }),
            None,
        )
        .await
    }

    const WEB_UI_GATE: &'static str = "Update the host to manage its web client from the app.";

    pub async fn get_web_ui_status(&self) -> Result<outbound::DaemonWebUiGetStatusResponsePayload> {
        self.require("webUiControl", Self::WEB_UI_GATE)?;
        self.ns("daemon.web_ui.get_status.request", json!({}), None)
            .await
    }

    pub async fn start_web_ui(&self) -> Result<outbound::DaemonWebUiStartResponsePayload> {
        self.require("webUiControl", Self::WEB_UI_GATE)?;
        self.ns("daemon.web_ui.start.request", json!({}), None)
            .await
    }

    pub async fn stop_web_ui(&self) -> Result<outbound::DaemonWebUiStopResponsePayload> {
        self.require("webUiControl", Self::WEB_UI_GATE)?;
        self.ns("daemon.web_ui.stop.request", json!({}), None).await
    }

    pub async fn update_web_ui(
        &self,
        start_on_launch: Option<bool>,
        host: Option<&str>,
    ) -> Result<outbound::DaemonWebUiUpdateResponsePayload> {
        self.require("webUiControl", Self::WEB_UI_GATE)?;
        self.ns(
            "daemon.web_ui.update.request",
            json!({ "startOnLaunch": start_on_launch, "host": host }),
            None,
        )
        .await
    }

    // ---- auth, devices, presence --------------------------------------------------------------

    pub async fn get_auth_settings(&self) -> Result<outbound::AuthSettingsGetResponsePayload> {
        self.ns("auth.settings.get.request", json!({}), None).await
    }

    pub async fn update_auth_settings(
        &self,
        claim_mode: Option<bool>,
        trust_lan: Option<bool>,
    ) -> Result<outbound::AuthSettingsUpdateResponsePayload> {
        self.ns(
            "auth.settings.update.request",
            json!({ "claimMode": claim_mode, "trustLan": trust_lan }),
            None,
        )
        .await
    }

    /// `None` removes the password.
    pub async fn set_daemon_password(
        &self,
        password: Option<&str>,
    ) -> Result<outbound::AuthPasswordSetResponsePayload> {
        let mut fields = json!({});
        fields["password"] = json!(password);
        self.ns_keep_nulls("auth.password.set.request", fields, None)
            .await
    }

    pub async fn list_devices(&self) -> Result<outbound::AuthDeviceListResponsePayload> {
        self.ns("auth.device.list.request", json!({}), None).await
    }

    pub async fn rename_device(
        &self,
        device_id: &str,
        name: &str,
    ) -> Result<outbound::AuthDeviceRenameResponsePayload> {
        self.ns(
            "auth.device.rename.request",
            json!({ "deviceId": device_id, "name": name }),
            None,
        )
        .await
    }

    pub async fn revoke_device(
        &self,
        device_id: &str,
    ) -> Result<outbound::AuthDeviceRevokeResponsePayload> {
        self.ns(
            "auth.device.revoke.request",
            json!({ "deviceId": device_id }),
            None,
        )
        .await
    }

    /// `role`: `"owner"`, `"operator"` or `"viewer"`.
    pub async fn set_device_role(
        &self,
        credential_id: &str,
        role: &str,
    ) -> Result<outbound::AuthDeviceSetRoleResponsePayload> {
        self.ns(
            "auth.device.set_role.request",
            json!({ "credentialId": credential_id, "role": role }),
            None,
        )
        .await
    }

    pub async fn create_pairing_code(
        &self,
        role: Option<&str>,
        ttl_seconds: Option<u64>,
    ) -> Result<outbound::AuthPairingCodeCreateResponsePayload> {
        self.ns(
            "auth.pairing_code.create.request",
            json!({ "role": role, "ttlSeconds": ttl_seconds }),
            None,
        )
        .await
    }

    pub async fn list_pairing_requests(
        &self,
    ) -> Result<outbound::AuthPairingRequestListResponsePayload> {
        self.ns("auth.pairing_request.list.request", json!({}), None)
            .await
    }

    /// `decision`: `"approve"` or `"deny"`.
    pub async fn decide_pairing_request(
        &self,
        pairing_request_id: &str,
        decision: &str,
        role: Option<&str>,
        name: Option<&str>,
    ) -> Result<outbound::AuthPairingRequestDecideResponsePayload> {
        self.ns(
            "auth.pairing_request.decide.request",
            json!({ "pairingRequestId": pairing_request_id, "decision": decision, "role": role, "name": name }),
            None,
        )
        .await
    }

    pub async fn get_presence(
        &self,
        target: Value,
    ) -> Result<outbound::PresenceGetResponsePayload> {
        self.ns("presence.get.request", json!({ "target": target }), None)
            .await
    }

    pub async fn report_presence(
        &self,
        target: Value,
        state: Value,
        device_name: Option<&str>,
    ) -> Result<outbound::PresenceReportResponsePayload> {
        self.ns(
            "presence.report.request",
            json!({ "target": target, "state": state, "deviceName": device_name }),
            None,
        )
        .await
    }

    // ---- companion ----------------------------------------------------------------------------

    pub async fn fetch_companion_notebook(
        &self,
    ) -> Result<outbound::CompanionNotebookFetchResponsePayloadNotebook> {
        let p: outbound::CompanionNotebookFetchResponsePayload = self
            .ns("companion.notebook.fetch.request", json!({}), None)
            .await?;
        Ok(p.notebook)
    }

    /// Fails with `Daemon(reasonCode)` when the companion refuses the message.
    pub async fn send_companion_message(&self, text: &str) -> Result<()> {
        let f = self
            .ns_frame(
                "companion.message.send.request",
                json!({ "text": text }),
                None,
            )
            .await?;
        if f.json()["payload"]["accepted"] == Value::Bool(true) {
            return Ok(());
        }
        let reason = f.json()["payload"]["reasonCode"]
            .as_str()
            .unwrap_or("rejected")
            .to_owned();
        Err(Error::Daemon(format!(
            "Companion message rejected: {reason}"
        )))
    }

    // ---- plugins (gated on server_info.features.plugins; check supports_plugins) -------------

    pub fn supports_plugins(&self) -> bool {
        self.has_feature("plugins")
    }

    async fn plugin<T: DeserializeOwned>(
        &self,
        req_type: &str,
        fields: Value,
        timeout_ms: Option<u64>,
    ) -> Result<T> {
        let f = self.ns_frame(req_type, fields, timeout_ms).await?;
        let err = &f.json()["payload"]["error"];
        if !err.is_null() {
            let code = err["code"].as_str().map(str::to_owned);
            let message = err["message"]
                .as_str()
                .unwrap_or("Plugin request failed")
                .to_owned();
            return Err(Error::Rpc {
                request_id: f.request_id.clone().unwrap_or_default(),
                error: message,
                code,
                request_type: Some(req_type.into()),
            });
        }
        decode(&f)
    }

    pub async fn plugins_list(&self) -> Result<outbound::PluginsListResponsePayload> {
        self.plugin("plugins.list.request", json!({}), None).await
    }
    pub async fn plugins_repos_list(&self) -> Result<outbound::PluginsReposListResponsePayload> {
        self.plugin("plugins.repos.list.request", json!({}), None)
            .await
    }
    pub async fn plugins_repos_add(
        &self,
        url: &str,
        public_key: Option<&str>,
        name: Option<&str>,
    ) -> Result<outbound::PluginsReposAddResponsePayload> {
        self.plugin(
            "plugins.repos.add.request",
            json!({ "url": url, "publicKey": public_key, "name": name }),
            Some(60_000),
        )
        .await
    }
    pub async fn plugins_repos_remove(
        &self,
        url: &str,
    ) -> Result<outbound::PluginsReposRemoveResponsePayload> {
        self.plugin("plugins.repos.remove.request", json!({ "url": url }), None)
            .await
    }
    pub async fn plugins_get_catalog(
        &self,
        refresh: bool,
    ) -> Result<outbound::PluginsGetCatalogResponsePayload> {
        self.plugin(
            "plugins.get_catalog.request",
            json!({ "refresh": refresh.then_some(true) }),
            Some(60_000),
        )
        .await
    }
    pub async fn plugins_install(
        &self,
        id: &str,
        repo_url: &str,
        granted_capabilities: &[String],
        version: Option<&str>,
    ) -> Result<outbound::PluginsInstallResponsePayload> {
        self.plugin(
            "plugins.install.request",
            json!({ "id": id, "repoUrl": repo_url, "grantedCapabilities": granted_capabilities, "version": version }),
            Some(120_000),
        )
        .await
    }
    pub async fn plugins_uninstall(
        &self,
        id: &str,
    ) -> Result<outbound::PluginsUninstallResponsePayload> {
        self.plugin(
            "plugins.uninstall.request",
            json!({ "id": id }),
            Some(60_000),
        )
        .await
    }
    pub async fn plugins_set_enabled(
        &self,
        id: &str,
        enabled: bool,
    ) -> Result<outbound::PluginsSetEnabledResponsePayload> {
        self.plugin(
            "plugins.set_enabled.request",
            json!({ "id": id, "enabled": enabled }),
            Some(60_000),
        )
        .await
    }
    pub async fn plugins_set_remote_control(
        &self,
        id: &str,
        enabled: bool,
    ) -> Result<outbound::PluginsSetRemoteControlResponsePayload> {
        self.plugin(
            "plugins.set_remote_control.request",
            json!({ "id": id, "enabled": enabled }),
            Some(60_000),
        )
        .await
    }
    pub async fn plugins_update(
        &self,
        id: &str,
        version: Option<&str>,
        granted_capabilities: Option<&[String]>,
    ) -> Result<outbound::PluginsUpdateResponsePayload> {
        self.plugin(
            "plugins.update.request",
            json!({ "id": id, "version": version, "grantedCapabilities": granted_capabilities }),
            Some(120_000),
        )
        .await
    }
    pub async fn plugins_dev_unlink(
        &self,
        id: &str,
    ) -> Result<outbound::PluginsDevUnlinkResponsePayload> {
        self.plugin("plugins.dev.unlink.request", json!({ "id": id }), None)
            .await
    }
    pub async fn plugins_rpc_call(
        &self,
        plugin_id: &str,
        method: &str,
        params: Option<Value>,
    ) -> Result<outbound::PluginsRpcCallResponsePayload> {
        self.plugin(
            "plugins.rpc.call.request",
            json!({ "pluginId": plugin_id, "method": method, "params": params }),
            Some(60_000),
        )
        .await
    }
    pub async fn plugins_get_contributions(
        &self,
    ) -> Result<outbound::PluginsGetContributionsResponsePayload> {
        self.plugin("plugins.get_contributions.request", json!({}), None)
            .await
    }
    pub async fn plugins_settings_get(
        &self,
        id: &str,
    ) -> Result<outbound::PluginsSettingsGetResponsePayload> {
        self.plugin("plugins.settings.get.request", json!({ "id": id }), None)
            .await
    }
    pub async fn plugins_settings_set(
        &self,
        id: &str,
        values: serde_json::Map<String, Value>,
    ) -> Result<outbound::PluginsSettingsSetResponsePayload> {
        self.plugin(
            "plugins.settings.set.request",
            json!({ "id": id, "values": values }),
            None,
        )
        .await
    }

    // ---- null-preserving variants -------------------------------------------------------------

    /// Like `rpc_frame` but keeps explicit `null` fields (for "clear this" arguments).
    async fn rpc_frame_keep_nulls(
        &self,
        req_type: &str,
        fields: Value,
        resp_type: &str,
        timeout_ms: Option<u64>,
    ) -> Result<SessionFrame> {
        let nulls: Vec<String> = fields
            .as_object()
            .map(|o| {
                o.iter()
                    .filter(|(_, v)| v.is_null())
                    .map(|(k, _)| k.clone())
                    .collect()
            })
            .unwrap_or_default();
        let request_id = self.new_request_id();
        let mut message = fields;
        message["type"] = req_type.into();
        message["requestId"] = request_id.clone().into();
        for k in nulls {
            message[k] = Value::Null;
        }
        let resp = resp_type.to_owned();
        let r = request_id.clone();
        self.request_frame(
            message,
            Some(request_id),
            Box::new(move |f| f.kind == resp && f.request_id.as_deref() == Some(r.as_str())),
            timeout_ms,
        )
        .await
    }

    async fn ns_keep_nulls<T: DeserializeOwned>(
        &self,
        req_type: &str,
        fields: Value,
        timeout_ms: Option<u64>,
    ) -> Result<T> {
        let resp = format!("{}.response", req_type.trim_end_matches(".request"));
        decode(
            &self
                .rpc_frame_keep_nulls(req_type, fields, &resp, timeout_ms)
                .await?,
        )
    }
}

fn agent_from_status(f: &SessionFrame) -> Result<Value> {
    let v = f.json();
    let p = &v["payload"];
    if p["status"] == "agent_create_failed" {
        return Err(Error::Daemon(
            p["error"]
                .as_str()
                .unwrap_or("Agent creation failed")
                .to_owned(),
        ));
    }
    Ok(p["agent"].clone())
}

fn normalize_diff_compare(compare: &Value) -> Value {
    let ignore = compare["ignoreWhitespace"] == Value::Bool(true);
    let mut out = if compare["mode"] == "uncommitted" {
        json!({ "mode": "uncommitted" })
    } else {
        let mut b = json!({ "mode": "base" });
        if let Some(r) = compare["baseRef"]
            .as_str()
            .map(str::trim)
            .filter(|r| !r.is_empty())
        {
            b["baseRef"] = r.into();
        }
        b
    };
    if ignore {
        out["ignoreWhitespace"] = true.into();
    }
    out
}

/// The pre-binary `file` payload: `{ content, encoding: "utf-8" | "base64", mimeType, size, ... }`.
fn legacy_file(file: &Value, path: &str) -> Result<FileReadResult> {
    if file.is_null() {
        return Err(Error::Daemon("File unavailable.".into()));
    }
    let content = file["content"].as_str().unwrap_or_default();
    let encoding = file["encoding"].as_str().unwrap_or("utf-8");
    let bytes = if encoding == "base64" {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD
            .decode(content)
            .map_err(|e| Error::Decode(e.to_string()))?
    } else {
        content.as_bytes().to_vec()
    };
    let mime = file["mimeType"]
        .as_str()
        .unwrap_or("application/octet-stream")
        .to_owned();
    let kind = file["kind"].as_str().map(str::to_owned).unwrap_or_else(|| {
        if encoding != "base64" {
            "text".into()
        } else if mime.starts_with("image/") {
            "image".into()
        } else {
            "binary".into()
        }
    });
    Ok(FileReadResult {
        size: file["size"].as_u64().unwrap_or(bytes.len() as u64),
        bytes,
        mime,
        path: file["path"].as_str().unwrap_or(path).to_owned(),
        kind,
        modified_at: file["modifiedAt"].as_str().map(str::to_owned),
        revision: file["revision"].as_str().map(str::to_owned),
    })
}

fn now_iso() -> String {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::new_0().to_iso_string().into()
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        // Civil-from-days (Howard Hinnant), UTC.
        let days = (secs / 86_400) as i64;
        let rem = secs % 86_400;
        let z = days + 719_468;
        let era = z.div_euclid(146_097);
        let doe = z - era * 146_097;
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let m = if mp < 10 { mp + 3 } else { mp - 9 };
        let y = yoe + era * 400 + i64::from(m <= 2);
        format!(
            "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.000Z",
            rem / 3600,
            rem % 3600 / 60,
            rem % 60
        )
    }
}
