// Adapts the AgentManager to the narrow agent API plugins see: agent.read / agent.write (v1) plus
// the v2 timeline, diff, provider, agent.manage and agent.permissions surfaces.
import type pino from "pino";
import type {
  PluginAgentSummary,
  PluginAttachment,
  PluginPermissionDecision,
  PluginTimelinePage,
} from "@frogg/protocol/plugins/api-v1";
import type { AgentManager, ManagedAgent } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import type { AgentPromptContentBlock, AgentPromptInput } from "../agent/agent-sdk-types.js";
import { sendPromptToAgent, startCreatedAgentInitialPrompt } from "../agent/agent-prompt.js";
import { archiveAgentCommand } from "../agent/lifecycle-command.js";
import type { WorkspaceGitService } from "../workspace-git-service.js";
import type { WorkspaceRegistry } from "../workspace-registry.js";
import type { PluginAgentBridge } from "./runtime.js";
import { PluginServiceError } from "./errors.js";
import {
  decodeTimelineCursor,
  encodeTimelineCursor,
  projectPermissionRequest,
  projectTimelineRow,
} from "./timeline-projection.js";

const DEFAULT_TIMELINE_LIMIT = 50;
const MAX_TIMELINE_LIMIT = 500;
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export interface PluginAgentBridgeDependencies {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  logger: pino.Logger;
  workspaceGit?: Pick<WorkspaceGitService, "peekSnapshot" | "getSnapshot"> | null;
  workspaces?: Pick<WorkspaceRegistry, "get"> | null;
}

function summarize(
  agent: ManagedAgent,
  workspaceGit: PluginAgentBridgeDependencies["workspaceGit"],
): PluginAgentSummary {
  const title = agent.config.title ?? undefined;
  const snapshot = workspaceGit?.peekSnapshot(agent.cwd) ?? null;
  const usage = agent.lastUsage;
  return {
    id: agent.id,
    provider: agent.provider,
    cwd: agent.cwd,
    status: agent.lifecycle,
    ...(title ? { title } : {}),
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
    model: agent.runtimeInfo?.model ?? agent.config.model ?? null,
    workspaceId: agent.workspaceId ?? null,
    branch: snapshot?.git.currentBranch ?? null,
    labels: { ...agent.labels },
    prUrl: snapshot?.forge.pullRequest?.url ?? null,
    usage: usage
      ? {
          ...(usage.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
          ...(usage.cachedInputTokens !== undefined
            ? { cachedInputTokens: usage.cachedInputTokens }
            : {}),
          ...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
          ...(usage.totalCostUsd !== undefined ? { costUsd: usage.totalCostUsd } : {}),
          ...(usage.contextWindowUsedTokens !== undefined
            ? { contextWindowUsedTokens: usage.contextWindowUsedTokens }
            : {}),
          ...(usage.contextWindowMaxTokens !== undefined
            ? { contextWindowMaxTokens: usage.contextWindowMaxTokens }
            : {}),
        }
      : null,
    requiresAttention: agent.attention.requiresAttention,
    attentionReason: agent.attention.requiresAttention
      ? (agent.attention.attentionReason ?? null)
      : null,
    pendingPermissions: agent.pendingPermissions.size,
    lastError: agent.lifecycle === "error" ? (agent.lastError ?? null) : null,
  };
}

/** Text plus attachments as one prompt: images pass through, anything else is inlined as text. */
export function buildPluginPrompt(
  text: string,
  attachments: readonly PluginAttachment[] | undefined,
): AgentPromptInput {
  if (!attachments?.length) return text;
  if (attachments.length > MAX_ATTACHMENTS)
    throw new PluginServiceError("invalid_request", `At most ${MAX_ATTACHMENTS} attachments`);
  const blocks: AgentPromptContentBlock[] = [{ type: "text", text }];
  for (const a of attachments) {
    if (
      !a ||
      typeof a.name !== "string" ||
      typeof a.mime !== "string" ||
      typeof a.data !== "string"
    )
      throw new PluginServiceError(
        "invalid_request",
        "attachments need name, mime and base64 data",
      );
    const bytes = Buffer.from(a.data, "base64");
    if (bytes.length > MAX_ATTACHMENT_BYTES)
      throw new PluginServiceError("invalid_request", `${a.name} exceeds 10 MB`);
    if (a.mime.startsWith("image/")) {
      blocks.push({ type: "image", data: a.data, mimeType: a.mime });
    } else {
      blocks.push({
        type: "text",
        text: `Attached file ${a.name} (${a.mime}):\n\n${bytes.toString("utf8")}`,
      });
    }
  }
  return blocks;
}

/** At most 20 string labels, keys up to 64 chars and values up to 256. */
export function sanitizeLabels(labels: Record<string, string>): Record<string, string> {
  if (!labels || typeof labels !== "object")
    throw new PluginServiceError("invalid_request", "labels must be an object of strings");
  const entries = Object.entries(labels);
  if (entries.length > 20) throw new PluginServiceError("invalid_request", "At most 20 labels");
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (typeof v !== "string" || !k || k.length > 64 || v.length > 256)
      throw new PluginServiceError("invalid_request", `Invalid label ${k}`);
    out[k] = v;
  }
  return out;
}

export function createPluginAgentBridge(deps: PluginAgentBridgeDependencies): PluginAgentBridge {
  const { agentManager } = deps;
  const visible = (a: ManagedAgent) => !a.internal;
  const require = (id: string): ManagedAgent => {
    const agent = agentManager.getAgent(id);
    if (!agent || agent.internal) throw new PluginServiceError("not_found", `No agent ${id}`);
    return agent;
  };
  const view = (a: ManagedAgent) => summarize(a, deps.workspaceGit);

  return {
    list: async () => agentManager.listAgents().filter(visible).map(view),
    get: async (id) => {
      const agent = agentManager.getAgent(id);
      return agent && visible(agent) ? view(agent) : null;
    },
    subscribe: (listener) =>
      agentManager.subscribe((event) => {
        if (event.type === "agent_state") {
          if (!visible(event.agent)) return;
          listener({
            agentId: event.agent.id,
            kind: "state",
            agent: view(event.agent),
          });
        } else if (event.type === "agent_stream" && event.event.type === "timeline") {
          const agent = agentManager.getAgent(event.agentId);
          if (agent?.internal) return;
          const entry =
            event.seq !== undefined
              ? projectTimelineRow({
                  seq: event.seq,
                  timestamp: event.timestamp ?? event.event.timestamp ?? new Date().toISOString(),
                  item: event.event.item,
                  ...(event.event.turnId ? { turnId: event.event.turnId } : {}),
                })
              : null;
          const cursor =
            entry && event.epoch
              ? encodeTimelineCursor({ epoch: event.epoch, seq: entry.seq })
              : null;
          listener({
            agentId: event.agentId,
            kind: "timeline",
            ...(entry ? { entry } : {}),
            ...(cursor ? { cursor } : {}),
          });
        }
      }),
    sendMessage: async (agentId, text, attachments) => {
      const agent = agentManager.getAgent(agentId);
      if (agent?.internal) throw new PluginServiceError("not_found", `No agent ${agentId}`);
      await sendPromptToAgent({
        agentManager,
        agentStorage: deps.agentStorage,
        agentId,
        prompt: buildPluginPrompt(text, attachments),
        logger: deps.logger,
        unarchive: false,
      });
    },
    getTimeline: async (agentId, options): Promise<PluginTimelinePage> => {
      require(agentId);
      const limit = Math.min(
        Math.max(1, Math.floor(options?.limit ?? DEFAULT_TIMELINE_LIMIT)),
        MAX_TIMELINE_LIMIT,
      );
      const cursor = decodeTimelineCursor(options?.cursor);
      const result = agentManager.fetchTimeline(
        agentId,
        cursor ? { direction: "after", cursor, limit } : { direction: "tail", limit },
      );
      const rows = result.rows;
      const last = rows.length ? rows[rows.length - 1]!.seq : (cursor?.seq ?? result.window.maxSeq);
      const reset = cursor
        ? result.reset || result.staleCursor || cursor.epoch !== result.epoch
        : false;
      return {
        entries: rows.map(projectTimelineRow).filter((e) => e !== null),
        cursor: encodeTimelineCursor({
          epoch: result.epoch,
          seq: reset && !rows.length ? result.window.maxSeq : last,
        }),
        reset,
        hasMore: result.hasNewer,
      };
    },
    getLastAssistantMessage: async (agentId) => {
      require(agentId);
      return agentManager.getLastAssistantMessage(agentId);
    },
    getDiffStat: async (agentId) => {
      const agent = require(agentId);
      if (!deps.workspaceGit) return null;
      const snapshot =
        deps.workspaceGit.peekSnapshot(agent.cwd) ??
        (await deps.workspaceGit.getSnapshot(agent.cwd).catch(() => null));
      const stat = snapshot?.git.diffStat ?? null;
      return stat ? { additions: stat.additions, deletions: stat.deletions } : null;
    },
    listProviders: async () =>
      (await agentManager.listProviderAvailability()).map((p) => ({
        id: p.provider,
        label: p.provider,
        available: p.available,
      })),
    create: async (input) => {
      const workspace = deps.workspaces ? await deps.workspaces.get(input.workspaceId) : null;
      if (!workspace || workspace.archivedAt)
        throw new PluginServiceError("not_found", `No active workspace ${input.workspaceId}`);
      const title = input.title?.trim() || null;
      const created = await agentManager.createAgent(
        {
          provider: input.provider,
          cwd: workspace.cwd,
          title,
          ...(input.model ? { model: input.model } : {}),
          ...(input.modeId ? { modeId: input.modeId } : {}),
        },
        undefined,
        {
          workspaceId: workspace.workspaceId,
          initialTitle: title,
          ...(input.labels ? { labels: sanitizeLabels(input.labels) } : {}),
        },
      );
      await startCreatedAgentInitialPrompt({
        agentManager,
        agentId: created.id,
        snapshot: created,
        prompt: input.prompt,
        logger: deps.logger,
      });
      return view(require(created.id));
    },
    cancel: async (agentId) => {
      require(agentId);
      await agentManager.cancelAgentRun(agentId);
    },
    archive: async (agentId) => {
      require(agentId);
      await archiveAgentCommand(
        { agentManager, agentStorage: deps.agentStorage, logger: deps.logger },
        agentId,
      );
    },
    listPermissions: async (agentId) => {
      const agents = agentId ? [require(agentId)] : agentManager.listAgents().filter(visible);
      return agents.flatMap((a) =>
        Array.from(a.pendingPermissions.values()).map((r) => projectPermissionRequest(a.id, r)),
      );
    },
    subscribePermissions: (onRequest, onResolved) =>
      agentManager.subscribe((event) => {
        if (event.type !== "agent_stream") return;
        const agent = agentManager.getAgent(event.agentId);
        if (!agent || agent.internal) return;
        if (event.event.type === "permission_requested") {
          onRequest({
            ...projectPermissionRequest(event.agentId, event.event.request),
            requestedAt: event.timestamp ?? new Date().toISOString(),
          });
        } else if (event.event.type === "permission_resolved") {
          onResolved({
            agentId: event.agentId,
            requestId: event.event.requestId,
            behavior: event.event.resolution.behavior,
          });
        }
      }),
    respondToPermission: async (
      agentId,
      requestId,
      decision: PluginPermissionDecision,
      message,
    ) => {
      const agent = require(agentId);
      const request = agent.pendingPermissions.get(requestId);
      if (!request)
        throw new PluginServiceError(
          "already_resolved",
          "That permission request is no longer pending",
        );
      if (decision === "deny") {
        await agentManager.respondToPermission(agentId, requestId, {
          behavior: "deny",
          ...(message ? { message } : {}),
        });
        return;
      }
      await agentManager.respondToPermission(agentId, requestId, {
        behavior: "allow",
        ...(decision === "always" && request.suggestions?.length
          ? { updatedPermissions: request.suggestions }
          : {}),
      });
    },
  };
}
