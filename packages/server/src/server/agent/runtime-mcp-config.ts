import { deriveAgentMcpToken } from "../auth.js";
import type { AgentSessionConfig, McpServerConfig } from "./agent-sdk-types.js";

const FROGG_MCP_SERVER_NAME = "frogg";
const FROGG_MCP_PATHNAME = "/mcp/agents";

export function stripInternalFroggMcpServer(config: AgentSessionConfig): AgentSessionConfig {
  const mcpServers = config.mcpServers;
  if (!mcpServers) {
    return config;
  }

  const froggServer = mcpServers[FROGG_MCP_SERVER_NAME];
  if (!froggServer || !isInternalFroggMcpServer(froggServer)) {
    return config;
  }

  const nextMcpServers = { ...mcpServers };
  delete nextMcpServers[FROGG_MCP_SERVER_NAME];

  const next = { ...config };
  if (Object.keys(nextMcpServers).length > 0) {
    next.mcpServers = nextMcpServers;
  } else {
    delete next.mcpServers;
  }
  return next;
}

export function withRuntimeFroggMcpServer(params: {
  config: AgentSessionConfig;
  agentId: string;
  mcpBaseUrl: string | null;
  /**
   * Per-run secret the daemon derives each agent's Agent MCP bearer from. The
   * injected header carries a token bound to this agent's id, so the endpoint
   * reads the caller from the credential instead of a spoofable query string.
   */
  mcpAuthToken: string | null;
}): AgentSessionConfig {
  const storedConfig = stripInternalFroggMcpServer(params.config);
  if (!params.mcpBaseUrl || storedConfig.mcpServers?.[FROGG_MCP_SERVER_NAME]) {
    return storedConfig;
  }

  return {
    ...storedConfig,
    mcpServers: {
      [FROGG_MCP_SERVER_NAME]: {
        type: "http",
        url: params.mcpBaseUrl,
        ...(params.mcpAuthToken
          ? {
              headers: {
                Authorization: `Bearer ${deriveAgentMcpToken(params.mcpAuthToken, params.agentId)}`,
              },
            }
          : {}),
      },
      ...storedConfig.mcpServers,
    },
  };
}

function isInternalFroggMcpServer(config: McpServerConfig): boolean {
  if (config.type !== "http" && config.type !== "sse") {
    return false;
  }

  try {
    return new URL(config.url).pathname === FROGG_MCP_PATHNAME;
  } catch {
    return false;
  }
}
