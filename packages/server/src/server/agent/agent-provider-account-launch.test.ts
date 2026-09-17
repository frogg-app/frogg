import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import type {
  AgentClient,
  AgentLaunchContext,
  AgentSession,
  AgentSessionConfig,
} from "./agent-sdk-types.js";

const logger = createTestLogger();

const CAPABILITIES = {
  supportsStreaming: false,
  supportsSessionPersistence: false,
  supportsSessionListing: false,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
} as const;

class StubAgentSession {
  readonly provider = "claude" as const;
  readonly capabilities = CAPABILITIES;
  readonly id = randomUUID();

  constructor(private readonly config: AgentSessionConfig) {}

  async run() {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }
  subscribe(): () => void {
    return () => {};
  }
  async *streamHistory(): AsyncGenerator<never> {}
  async getRuntimeInfo() {
    return {
      provider: this.provider,
      sessionId: this.id,
      model: this.config.model ?? null,
      modeId: this.config.modeId ?? null,
    };
  }
  async getAvailableModes() {
    return [];
  }
  describePersistence() {
    return null;
  }
  async close(): Promise<void> {}
}

/** Captures the launch context the manager hands the provider at spawn time. */
class LaunchCapturingClient implements AgentClient {
  readonly provider = "claude" as const;
  readonly capabilities = CAPABILITIES;
  launchContexts: AgentLaunchContext[] = [];

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async createSession(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    if (launchContext) this.launchContexts.push(launchContext);
    return new StubAgentSession(config) as unknown as AgentSession;
  }

  async fetchCatalog() {
    return { models: [], modes: [] };
  }
}

const workdirs: string[] = [];
function makeWorkdir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-provider-account-"));
  workdirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of workdirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

interface ResolverCall {
  provider: string;
  accountId: string | null | undefined;
}

function createManager(
  client: LaunchCapturingClient,
  resolve: (
    call: ResolverCall,
  ) => { env: Record<string, string>; unknownAccountId?: string } | undefined,
  calls: ResolverCall[],
): AgentManager {
  return new AgentManager({
    clients: { claude: client },
    logger,
    resolveAgentProviderAccountEnv: (provider, accountId) => {
      calls.push({ provider, accountId });
      return resolve({ provider, accountId }) ?? { env: {} };
    },
  });
}

describe("per-agent provider account launch env", () => {
  it("passes the agent's own account id to the resolver and spawns with its overlay", async () => {
    const client = new LaunchCapturingClient();
    const calls: ResolverCall[] = [];
    const manager = createManager(
      client,
      ({ accountId }) =>
        accountId === "acct-peter"
          ? { env: { CLAUDE_CONFIG_DIR: "/home/u/.claude-peter" } }
          : { env: { CLAUDE_CONFIG_DIR: "/home/u/.claude-active" } },
      calls,
    );

    await manager.createAgent(
      { provider: "claude", cwd: makeWorkdir(), providerAccountId: "acct-peter" },
      undefined,
      { workspaceId: undefined },
    );

    expect(calls).toEqual([{ provider: "claude", accountId: "acct-peter" }]);
    expect(client.launchContexts[0]?.env?.CLAUDE_CONFIG_DIR).toBe("/home/u/.claude-peter");
  });

  it("falls back to the daemon-wide active account when the agent names none", async () => {
    const client = new LaunchCapturingClient();
    const calls: ResolverCall[] = [];
    const manager = createManager(
      client,
      () => ({ env: { CLAUDE_CONFIG_DIR: "/home/u/.claude-active" } }),
      calls,
    );

    await manager.createAgent({ provider: "claude", cwd: makeWorkdir() }, undefined, {
      workspaceId: undefined,
    });

    expect(calls).toEqual([{ provider: "claude", accountId: undefined }]);
    expect(client.launchContexts[0]?.env?.CLAUDE_CONFIG_DIR).toBe("/home/u/.claude-active");
  });

  it("lets a per-launch request env win over the account overlay", async () => {
    const client = new LaunchCapturingClient();
    const calls: ResolverCall[] = [];
    const manager = createManager(
      client,
      () => ({ env: { CLAUDE_CONFIG_DIR: "/home/u/.claude-peter" } }),
      calls,
    );

    await manager.createAgent(
      { provider: "claude", cwd: makeWorkdir(), providerAccountId: "acct-peter" },
      undefined,
      { workspaceId: undefined, env: { CLAUDE_CONFIG_DIR: "/request-env" } },
    );

    expect(client.launchContexts[0]?.env?.CLAUDE_CONFIG_DIR).toBe("/request-env");
  });

  it("still launches when the agent's account was deleted", async () => {
    const client = new LaunchCapturingClient();
    const calls: ResolverCall[] = [];
    const manager = createManager(
      client,
      ({ accountId }) => ({
        env: { CLAUDE_CONFIG_DIR: "/home/u/.claude-active" },
        ...(accountId === "acct-gone" ? { unknownAccountId: "acct-gone" } : {}),
      }),
      calls,
    );

    const agent = await manager.createAgent(
      { provider: "claude", cwd: makeWorkdir(), providerAccountId: "acct-gone" },
      undefined,
      { workspaceId: undefined },
    );

    expect(agent.id).toBeTruthy();
    // Default resolution, not a failed launch.
    expect(client.launchContexts[0]?.env?.CLAUDE_CONFIG_DIR).toBe("/home/u/.claude-active");
  });

  it("does not fail the launch when the resolver throws", async () => {
    const client = new LaunchCapturingClient();
    const manager = new AgentManager({
      clients: { claude: client },
      logger,
      resolveAgentProviderAccountEnv: () => {
        throw new Error("store unreadable");
      },
    });

    const agent = await manager.createAgent(
      { provider: "claude", cwd: makeWorkdir(), providerAccountId: "acct-peter" },
      undefined,
      { workspaceId: undefined },
    );

    expect(agent.id).toBeTruthy();
    expect(client.launchContexts[0]?.env?.CLAUDE_CONFIG_DIR).toBeUndefined();
  });
});
