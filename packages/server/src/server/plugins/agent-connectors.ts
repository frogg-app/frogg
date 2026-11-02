// What the agents on this host see of its plugins: which connectors are installed, whether they
// are running, and the agent tools they contribute (`contributes.agentTools`). Pure; the
// PluginService feeds it its loaded plugins.
import type { PluginAgentToolContribution, PluginManifest } from "@frogg/protocol/plugins/manifest";

export interface AgentConnectorTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown> | null;
}

export interface AgentConnector {
  id: string;
  name: string;
  version: string;
  description: string | null;
  /** Plugin status: "active" when its tools can be called. */
  status: string;
  error: string | null;
  /** Granted capabilities, so an agent can tell a read-only connector from a remote-control one. */
  capabilities: string[];
  tools: AgentConnectorTool[];
}

export interface AgentConnectorSource {
  manifest: PluginManifest;
  status: string;
  error: string | null;
  granted: readonly string[];
  /** Disabled installs are left out entirely. */
  enabled: boolean;
}

/** Tools a plugin offers agents right now: declared, `rpc` granted and the plugin running. */
export function callableAgentTools(source: AgentConnectorSource): PluginAgentToolContribution[] {
  if (source.status !== "active" || !source.granted.includes("rpc")) return [];
  return source.manifest.contributes?.agentTools ?? [];
}

export function projectAgentConnectors(sources: Iterable<AgentConnectorSource>): AgentConnector[] {
  const out: AgentConnector[] = [];
  for (const s of sources) {
    if (!s.enabled) continue;
    out.push({
      id: s.manifest.id,
      name: s.manifest.name,
      version: s.manifest.version,
      description: s.manifest.description ?? null,
      status: s.status,
      error: s.error,
      capabilities: [...s.granted],
      tools: callableAgentTools(s).map((t) => ({
        name: t.id,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema ?? null,
      })),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * One-paragraph capability summary for the agent's hidden system context, or "" when no connector
 * is running. Keeps to names so it stays short; `list_connectors` has the detail.
 */
export function agentConnectorSummary(connectors: readonly AgentConnector[]): string {
  const running = connectors.filter((c) => c.status === "active");
  if (running.length === 0) return "";
  const parts = running.map((c) => {
    const tools = c.tools.map((t) => t.name);
    return tools.length
      ? `${c.name} (${c.id}; tools: ${tools.join(", ")})`
      : `${c.name} (${c.id}; no agent tools)`;
  });
  return [
    `Frogg connectors running on this host: ${parts.join("; ")}.`,
    "Call connector tools with the Frogg MCP tool call_connector_tool; list_connectors shows their input schemas.",
    "Do not read plugin settings or data files for credentials; use the connector tools instead.",
  ].join(" ");
}
