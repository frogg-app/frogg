import { DEVICE_ROLES, type DeviceRole } from "@frogg/protocol/device-access";
import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";
import type { DaemonPermission } from "@frogg/protocol/messages";

export { DEVICE_ROLES, type DeviceRole };

type InboundOperation = SessionInboundMessage["type"];
type OutboundOperation = SessionOutboundMessage["type"];

const ROLE_RANK: Record<DeviceRole, number> = { viewer: 0, operator: 1, owner: 2 };

const deviceRoleSet: ReadonlySet<string> = new Set(DEVICE_ROLES);

export function isDeviceRole(value: unknown): value is DeviceRole {
  return typeof value === "string" && deviceRoleSet.has(value);
}

/** True when `role` is at least as privileged as `required`. */
export function roleSatisfies(role: DeviceRole, required: DeviceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

/**
 * Minimum role for a permission when it is checked outside a named RPC: binary
 * frames (terminal stdin, file transfer), browser-tool registration, native
 * session import, and outbound frames. Named RPCs use INBOUND_ROLE instead.
 */
const PERMISSION_MIN_ROLE = {
  "daemon.read": "viewer",
  "workspace.read": "viewer",
  "workspace.write": "operator",
  "workspace.manage": "operator",
  "automation.manage": "operator",
  "hub.execute": "operator",
  "daemon.manage": "owner",
  "access.manage": "owner",
  "tunnel.manage": "owner",
} as const satisfies Record<DaemonPermission, DeviceRole>;

/**
 * Required device role per inbound RPC. Exhaustive over the inbound union, so a
 * new RPC does not typecheck until it declares a role here as well as its
 * permission row in operation-permissions.ts. A request must pass both.
 *
 * - viewer: read-only views of sessions, timelines, terminal output, workspaces.
 * - operator: drive agents, terminals, scripts, file and git edits, workspaces.
 * - owner: daemon settings, provider accounts, updates, pairing, device access.
 */
const INBOUND_ROLE = {
  abort_request: "operator",
  "agent.config.apply.request": "operator",
  "agent.cancel_auto_resume.request": "operator",
  "agent.detach.request": "operator",
  "agent.fork_context.request": "viewer",
  "agent.provider_account.transfer.request": "operator",
  "agent.provider_definitions.list.request": "viewer",
  "agent.provider_subagents.list.request": "viewer",
  "agent.provider_subagents.timeline.get.request": "viewer",
  "agent.rewind.request": "operator",
  "agent.skills.get_status.request": "viewer",
  "agent.skills.import_legacy_selection.request": "owner",
  "agent.skills.reconcile.request": "owner",
  "agent.skills.save_selection.request": "owner",
  "agent.skills.uninstall.request": "owner",
  "agent.timeline.list_prompts.request": "viewer",
  "agent.timeline.set_subscription.request": "viewer",
  agent_permission_response: "operator",
  archive_agent_request: "operator",
  archive_workspace_request: "operator",
  audio_played: "operator",
  "auth.device.list.request": "operator",
  "auth.device.rename.request": "owner",
  "auth.device.revoke.request": "owner",
  "auth.device.set_role.request": "owner",
  "auth.pairing_code.create.request": "owner",
  "auth.pairing_request.decide.request": "owner",
  "auth.pairing_request.list.request": "owner",
  "auth.password.set.request": "owner",
  "auth.settings.get.request": "operator",
  "auth.settings.update.request": "owner",
  branch_suggestions_request: "viewer",
  "browser.automation.execute.response": "operator",
  cancel_agent_request: "operator",
  capture_terminal_request: "viewer",
  "chat/create": "operator",
  "chat/delete": "operator",
  "chat/inspect": "viewer",
  "chat/list": "viewer",
  "chat/post": "operator",
  "chat/read": "viewer",
  "chat/wait": "viewer",
  "checkout.ci.download_job_log.request": "operator",
  "checkout.ci.list_runs.request": "viewer",
  "checkout.commits.file_diff.request": "viewer",
  "checkout.commits.list.request": "viewer",
  "checkout.discard_changes.request": "operator",
  "checkout.forge.get_check_details.request": "viewer",
  "checkout.forge.set_auto_merge.request": "operator",
  "checkout.github.get_check_details.request": "viewer",
  "checkout.github.set_auto_merge.request": "operator",
  "checkout.refresh.request": "viewer",
  "checkout.rename_branch.request": "operator",
  checkout_commit_request: "operator",
  checkout_merge_from_base_request: "operator",
  checkout_merge_request: "operator",
  checkout_pr_create_request: "operator",
  checkout_pr_merge_request: "operator",
  checkout_pr_status_request: "viewer",
  checkout_pull_request: "operator",
  checkout_push_request: "operator",
  checkout_status_request: "viewer",
  checkout_switch_branch_request: "operator",
  clear_agent_attention: "operator",
  client_heartbeat: "viewer",
  close_items_request: "operator",
  "companion.audio.chunk": "operator",
  "companion.audio.played": "operator",
  "companion.message.send.request": "operator",
  "companion.notebook.fetch.request": "viewer",
  "companion.session.start.request": "operator",
  "companion.session.stop.request": "operator",
  create_agent_request: "operator",
  create_frogg_worktree_request: "operator",
  create_terminal_request: "operator",
  "daemon.config.reload.request": "owner",
  "daemon.get_pairing_offer.request": "owner",
  "daemon.get_security_posture.request": "owner",
  "daemon.set_security_finding_acknowledged.request": "owner",
  "daemon.get_status.request": "viewer",
  "daemon.update.check.request": "owner",
  "daemon.update.get_status.request": "owner",
  "daemon.update.request": "owner",
  "daemon.update.start.request": "owner",
  delete_agent_request: "operator",
  "diagnostics.request": "viewer",
  dictation_stream_cancel: "operator",
  dictation_stream_chunk: "operator",
  dictation_stream_finish: "operator",
  dictation_stream_start: "operator",
  directory_suggestions_request: "viewer",
  fetch_agent_history_request: "viewer",
  fetch_agent_request: "viewer",
  fetch_agent_timeline_request: "viewer",
  fetch_agents_request: "viewer",
  fetch_recent_provider_sessions_request: "viewer",
  fetch_workspaces_request: "viewer",
  "file.upload.request": "operator",
  file_download_token_request: "viewer",
  file_explorer_request: "viewer",
  "forge.search.request": "viewer",
  frogg_worktree_archive_request: "operator",
  frogg_worktree_list_request: "viewer",
  "fs.entry.create.request": "operator",
  "fs.entry.delete.request": "operator",
  "fs.entry.duplicate.request": "operator",
  "fs.entry.rename.request": "operator",
  "fs.file.subscribe.request": "viewer",
  "fs.file.unsubscribe.request": "viewer",
  "fs.file.write.request": "operator",
  get_daemon_config_request: "viewer",
  get_providers_snapshot_request: "viewer",
  github_search_request: "viewer",
  "hub.execution.agent.create.request": "operator",
  "hub.execution.agent.validate.request": "operator",
  "hub.execution.control.request": "operator",
  "hub.management.daemon.connect.request": "owner",
  "hub.management.daemon.disconnect.request": "owner",
  "hub.management.daemon.get_status.request": "owner",
  "hub.management.daemon.permissions.update.request": "owner",
  import_agent_request: "operator",
  kill_terminal_request: "operator",
  list_available_editors_request: "viewer",
  list_available_providers_request: "viewer",
  list_commands_request: "viewer",
  list_provider_features_request: "viewer",
  list_provider_models_request: "viewer",
  list_provider_modes_request: "viewer",
  list_terminals_request: "viewer",
  "loop/inspect": "viewer",
  "loop/list": "viewer",
  "loop/logs": "viewer",
  "loop/run": "operator",
  "loop/stop": "operator",
  "notification.audio.request": "viewer",
  open_in_editor_request: "operator",
  open_project_request: "operator",
  ping: "viewer",
  "project.add.request": "operator",
  "project.create_directory.request": "operator",
  "project.github.clone.request": "operator",
  "project.icon.get.request": "viewer",
  "project.icon.set.request": "operator",
  "project.import.cancel.request": "operator",
  "project.import.commit.request": "operator",
  "project.import.list.request": "operator",
  "project.import.prepare.request": "operator",
  "project.import.preview.request": "operator",
  "project.import.read.request": "operator",
  "project.import.upload.request": "operator",
  "project.list.request": "viewer",
  "project.remove.request": "operator",
  "project.rename.request": "operator",
  project_icon_request: "viewer",
  "provider.account.create.request": "owner",
  "provider.account.delete.request": "owner",
  "provider.account.export.request": "owner",
  "provider.account.import.request": "owner",
  "provider.account.list.request": "viewer",
  "provider.account.rename.request": "owner",
  "provider.account.set_active.request": "owner",
  "provider.account.set_allowed_models.request": "owner",
  "provider.account.set_preferences.request": "owner",
  "provider.account.sign_out.request": "owner",
  "provider.update.check.request": "viewer",
  "provider.update.install.request": "owner",
  "provider.update.set_preferences.request": "owner",
  "provider.usage.list.request": "viewer",
  provider_diagnostic_request: "operator",
  "presence.get.request": "viewer",
  "presence.report.request": "viewer",
  pull_request_timeline_request: "viewer",
  "push.unregister.request": "viewer",
  read_project_config_request: "viewer",
  refresh_agent_request: "operator",
  refresh_providers_snapshot_request: "operator",
  register_push_token: "viewer",
  restart_server_request: "owner",
  resume_agent_request: "operator",
  "schedule/create": "operator",
  "schedule/delete": "operator",
  "schedule/inspect": "viewer",
  "schedule/list": "viewer",
  "schedule/logs": "viewer",
  "schedule/pause": "operator",
  "schedule/resume": "operator",
  "schedule/run-once": "operator",
  "schedule/update": "operator",
  send_agent_message_request: "operator",
  set_agent_feature_request: "operator",
  set_agent_mode_request: "operator",
  set_agent_model_request: "operator",
  set_agent_thinking_request: "operator",
  set_daemon_config_request: "owner",
  set_voice_mode: "operator",
  shutdown_server_request: "owner",
  start_workspace_script_request: "operator",
  stash_list_request: "viewer",
  stash_pop_request: "operator",
  stash_save_request: "operator",
  subscribe_checkout_diff_request: "viewer",
  subscribe_terminal_request: "viewer",
  subscribe_terminals_request: "viewer",
  "terminal.rename.request": "operator",
  terminal_input: "operator",
  unsubscribe_checkout_diff_request: "viewer",
  unsubscribe_terminal_request: "viewer",
  unsubscribe_terminals_request: "viewer",
  update_agent_request: "operator",
  validate_branch_request: "viewer",
  voice_audio_chunk: "operator",
  wait_for_finish_request: "viewer",
  "workspace.clear_attention.request": "operator",
  "workspace.create.request": "operator",
  "workspace.github.search_repositories.request": "viewer",
  "workspace.label.assignment.set.request": "operator",
  "workspace.label.delete.inspect.request": "viewer",
  "workspace.label.delete.request": "operator",
  "workspace.label.list.request": "viewer",
  "workspace.label.update.request": "operator",
  "workspace.pin.set.request": "operator",
  "workspace.recovery.inspect.request": "viewer",
  "workspace.recovery.restore.request": "operator",
  "workspace.script.list.request": "viewer",
  "workspace.script.start.request": "operator",
  "workspace.script.stop.request": "operator",
  "workspace.title.set.request": "operator",
  workspace_setup_status_request: "viewer",
  write_project_config_request: "operator",
} as const satisfies Record<InboundOperation, DeviceRole>;

/**
 * Outbound frames whose permission row demands more than a viewer needs to keep
 * a read-only view consistent. Everything else derives from its permission.
 */
const OUTBOUND_ROLE_OVERRIDES: Partial<Record<OutboundOperation, DeviceRole>> = {
  agent_permission_resolved: "viewer",
  // Operators may see who is paired and how access is configured, not change it.
  "auth.device.list.response": "operator",
  "auth.settings.get.response": "operator",
};

/**
 * Every way a connection can reach a Session. A transport without a paired
 * device credential falls back to the role declared here, so adding a transport
 * does not typecheck until it says what authority it carries.
 *
 * - direct: a local or LAN socket; owner unless it presents a device credential.
 * - relay: the same client over the relay, narrowed by its credential when it
 *   presents one (see relay client authentication).
 * - hub: an enrolled Hub, narrowed further by its granted permissions.
 * - mcp: an agent driving the daemon over /mcp/agents; never device management.
 */
const TRANSPORT_DEFAULT_ROLE = {
  direct: "owner",
  relay: "owner",
  hub: "owner",
  mcp: "operator",
} as const satisfies Record<SessionTransport, DeviceRole>;

export const SESSION_TRANSPORTS = ["direct", "relay", "hub", "mcp"] as const;
export type SessionTransport = (typeof SESSION_TRANSPORTS)[number];

export function defaultRoleForTransport(transport: SessionTransport): DeviceRole {
  return TRANSPORT_DEFAULT_ROLE[transport];
}

export function requiredRoleForInbound(operation: InboundOperation): DeviceRole {
  return INBOUND_ROLE[operation];
}

export function minimumRoleForPermission(permission: DaemonPermission): DeviceRole {
  return PERMISSION_MIN_ROLE[permission];
}

export function requiredRoleForOutbound(
  operation: OutboundOperation,
  permission: DaemonPermission | null,
): DeviceRole {
  const override = OUTBOUND_ROLE_OVERRIDES[operation];
  if (override) return override;
  return permission === null ? "viewer" : PERMISSION_MIN_ROLE[permission];
}
