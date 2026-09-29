// Adapts the AgentManager to the narrow agent API plugins see (agent.read / agent.write).
import type pino from "pino";
import type { PluginAgentSummary } from "@frogg/protocol/plugins/api-v1";
import type { AgentManager, ManagedAgent } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import { sendPromptToAgent } from "../agent/agent-prompt.js";
import type { PluginAgentBridge } from "./runtime.js";
import { PluginServiceError } from "./errors.js";

function summarize(agent: ManagedAgent): PluginAgentSummary {
  const title = agent.config.title ?? undefined;
  return {
    id: agent.id,
    provider: agent.provider,
    cwd: agent.cwd,
    status: agent.lifecycle,
    ...(title ? { title } : {}),
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };
}

export function createPluginAgentBridge(deps: {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  logger: pino.Logger;
}): PluginAgentBridge {
  const visible = (a: ManagedAgent) => !a.internal;
  return {
    list: async () => deps.agentManager.listAgents().filter(visible).map(summarize),
    get: async (id) => {
      const agent = deps.agentManager.getAgent(id);
      return agent && visible(agent) ? summarize(agent) : null;
    },
    subscribe: (listener) =>
      deps.agentManager.subscribe((event) => {
        if (event.type === "agent_state") {
          if (!visible(event.agent)) return;
          listener({ agentId: event.agent.id, kind: "state", agent: summarize(event.agent) });
        } else if (event.type === "agent_stream" && event.event.type === "timeline") {
          listener({ agentId: event.agentId, kind: "timeline" });
        }
      }),
    sendMessage: async (agentId, text) => {
      const agent = deps.agentManager.getAgent(agentId);
      if (agent?.internal) throw new PluginServiceError("not_found", `No agent ${agentId}`);
      await sendPromptToAgent({
        agentManager: deps.agentManager,
        agentStorage: deps.agentStorage,
        agentId,
        prompt: text,
        logger: deps.logger,
        unarchive: false,
      });
    },
  };
}
