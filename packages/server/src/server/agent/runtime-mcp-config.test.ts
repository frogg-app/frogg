import { describe, expect, test } from "vitest";

import type { AgentSessionConfig } from "./agent-sdk-types.js";
import { verifyAgentMcpToken } from "../auth.js";
import { withRuntimeFroggMcpServer } from "./runtime-mcp-config.js";

const BASE_CONFIG: AgentSessionConfig = {
  provider: "claude",
  cwd: "/tmp/agent",
};

describe("withRuntimeFroggMcpServer", () => {
  test("injects a per-agent bearer and no caller id in the URL", () => {
    const result = withRuntimeFroggMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: "http://127.0.0.1:9999/mcp/agents",
      mcpAuthToken: "cap-token",
    });

    const injected = result.mcpServers?.frogg as { url: string; headers: Record<string, string> };
    // The caller is carried by the credential, not by a spoofable query string.
    expect(injected.url).toBe("http://127.0.0.1:9999/mcp/agents");
    const token = injected.headers.Authorization?.replace("Bearer ", "") ?? "";
    expect(verifyAgentMcpToken("cap-token", token)).toBe("agent-1");
    expect(verifyAgentMcpToken("other-secret", token)).toBeNull();
  });

  test("gives each agent a different token", () => {
    const tokenFor = (agentId: string) => {
      const injected = withRuntimeFroggMcpServer({
        config: BASE_CONFIG,
        agentId,
        mcpBaseUrl: "http://127.0.0.1:9999/mcp/agents",
        mcpAuthToken: "cap-token",
      }).mcpServers?.frogg as { headers: Record<string, string> } | undefined;
      return injected?.headers.Authorization;
    };

    expect(tokenFor("agent-1")).not.toBe(tokenFor("agent-2"));
  });

  test("omits the header when no token is available", () => {
    const result = withRuntimeFroggMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: "http://127.0.0.1:9999/mcp/agents",
      mcpAuthToken: null,
    });

    expect(result.mcpServers?.frogg).toEqual({
      type: "http",
      url: "http://127.0.0.1:9999/mcp/agents",
    });
  });

  test("does not inject when no MCP base URL is configured", () => {
    const result = withRuntimeFroggMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: null,
      mcpAuthToken: "cap-token",
    });

    expect(result.mcpServers).toBeUndefined();
  });
});
