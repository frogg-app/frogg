// Connector MCP tools: let an agent discover the plugins running on its host and call the agent
// tools they contribute (`contributes.agentTools`), so it never has to handle a plugin's secrets.
import { z } from "zod";
import { ensureValidJson } from "../../json-utils.js";
import { PluginServiceError } from "../../plugins/errors.js";
import type { AgentConnector } from "../../plugins/agent-connectors.js";
import type { FroggToolConfig, FroggToolExecutionContext, FroggToolResult } from "./types.js";

export const CONNECTOR_TOOL_NAMES = ["list_connectors", "call_connector_tool"] as const;

/** The slice of PluginService the tools need. */
export interface AgentConnectorHost {
  listAgentConnectors(): AgentConnector[];
  callAgentTool(pluginId: string, tool: string, args: unknown, agentId: string): Promise<unknown>;
}

type RegisterTool = (
  name: string,
  config: FroggToolConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool handlers are schema-validated at registration boundaries.
  handler: (input: any, context: FroggToolExecutionContext) => Promise<FroggToolResult>,
) => void;

export interface ConnectorToolDependencies {
  registerTool: RegisterTool;
  connectors: AgentConnectorHost;
  callerAgentId?: string;
}

function errorResult(code: string, message: string): FroggToolResult {
  const payload = { error: { code, message } };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: ensureValidJson(payload),
    isError: true,
  };
}

export function registerConnectorTools(deps: ConnectorToolDependencies): void {
  const { registerTool, connectors, callerAgentId } = deps;

  registerTool(
    "list_connectors",
    {
      title: "List connectors",
      description:
        "List the Frogg plugins (connectors such as Discord or Google Workspace) enabled on the host you run on, with their status, granted capabilities and the agent tools each one offers, including input schemas. Call a tool with call_connector_tool. Use these tools instead of reading plugin settings or data files.",
      inputSchema: {},
    },
    async () => ({
      content: [],
      structuredContent: ensureValidJson({
        connectors: connectors.listAgentConnectors(),
      }),
    }),
  );

  registerTool(
    "call_connector_tool",
    {
      title: "Call connector tool",
      description:
        "Call an agent tool offered by a Frogg connector on this host (see list_connectors). The connector runs it with its own credentials and returns JSON.",
      inputSchema: {
        connectorId: z
          .string()
          .describe("Connector (plugin) id from list_connectors, e.g. frogg.discord"),
        tool: z.string().describe("Tool name from the connector's tools list"),
        arguments: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Tool input matching its inputSchema"),
      },
    },
    async ({ connectorId, tool, arguments: args }) => {
      if (!callerAgentId) {
        return errorResult(
          "invalid_request",
          "Connector tools are only available to agents running on a Frogg host",
        );
      }
      try {
        const result = await connectors.callAgentTool(connectorId, tool, args ?? {}, callerAgentId);
        return {
          content: [],
          structuredContent: ensureValidJson({ result: result ?? null }),
        };
      } catch (error) {
        if (error instanceof PluginServiceError) return errorResult(error.code, error.message);
        throw error;
      }
    },
  );
}
