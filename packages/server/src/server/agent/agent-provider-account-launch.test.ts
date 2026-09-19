import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import { AgentStorage } from "./agent-storage.js";
import type {
  AgentClient,
  AgentLaunchContext,
  AgentPersistenceHandle,
  AgentSession,
  RelocateNativeSessionInput,
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

    // One call to pin (the mock resolves no account), one for the launch.
    expect(calls).toEqual([
      { provider: "claude", accountId: undefined },
      { provider: "claude", accountId: undefined },
    ]);
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

/** A resumable, relocatable client for the pinning and transfer paths. */
class ResumableClient extends LaunchCapturingClient {
  relocations: RelocateNativeSessionInput[] = [];

  async resumeSession(
    _handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    if (launchContext) this.launchContexts.push(launchContext);
    return new StubAgentSession({
      provider: "claude",
      cwd: overrides?.cwd ?? "/",
      ...overrides,
    }) as unknown as AgentSession;
  }

  async relocateNativeSession(input: RelocateNativeSessionInput): Promise<void> {
    this.relocations.push(input);
  }
}

/** A tiny in-memory account store: `undefined` follows `active`, `null` is primary. */
function accountStore() {
  const dirs: Record<string, string> = { a: "/acct/a", b: "/acct/b" };
  const state: { active: string | undefined } = { active: "a" };
  const dirFor = (accountId: string | null | undefined): string => {
    const id = accountId === undefined ? state.active : accountId;
    return id ? dirs[id]! : "/primary";
  };
  return {
    state,
    dirFor,
    resolveEnv: (_provider: string, accountId: string | null | undefined) => ({
      env: { CLAUDE_CONFIG_DIR: dirFor(accountId) },
      resolvedAccountId: accountId === undefined ? (state.active ?? null) : accountId,
    }),
  };
}

const HANDLE: AgentPersistenceHandle = {
  provider: "claude",
  sessionId: "native-1",
};

describe("provider account pinning", () => {
  function setup(storage?: AgentStorage) {
    const client = new ResumableClient();
    const store = accountStore();
    const manager = new AgentManager({
      clients: { claude: client },
      logger,
      ...(storage ? { registry: storage } : {}),
      resolveAgentProviderAccountEnv: store.resolveEnv,
      resolveProviderAccountConfigDir: (_provider, accountId) => store.dirFor(accountId),
    });
    return { client, store, manager };
  }

  it("pins an absent account to the active account at create", async () => {
    const { manager, client } = setup();
    const agent = await manager.createAgent({ provider: "claude", cwd: makeWorkdir() }, undefined, {
      workspaceId: undefined,
    });
    expect(agent.config.providerAccountId).toBe("a");
    expect(client.launchContexts[0]?.env?.CLAUDE_CONFIG_DIR).toBe("/acct/a");
  });

  it("pins to the primary dir (null) when no account is active", async () => {
    const { manager, store } = setup();
    store.state.active = undefined;
    const agent = await manager.createAgent({ provider: "claude", cwd: makeWorkdir() }, undefined, {
      workspaceId: undefined,
    });
    expect(agent.config.providerAccountId).toBeNull();
  });

  it("leaves providers without an accounts capability unpinned", async () => {
    const client = new ResumableClient();
    const manager = new AgentManager({
      clients: { claude: client },
      logger,
      resolveAgentProviderAccountEnv: () => ({ env: {} }),
    });
    const agent = await manager.createAgent({ provider: "claude", cwd: makeWorkdir() }, undefined, {
      workspaceId: undefined,
    });
    expect(agent.config.providerAccountId).toBeUndefined();
  });

  it("persists the pin and keeps using it after the active account changes", async () => {
    const workdir = makeWorkdir();
    const storage = new AgentStorage(join(workdir, "agents"), logger);
    const { manager, client, store } = setup(storage);
    const agent = await manager.createAgent({ provider: "claude", cwd: workdir }, undefined, {
      workspaceId: undefined,
    });
    await manager.flush();
    await storage.flush();
    const record = await storage.get(agent.id);
    expect(record?.config?.providerAccountId).toBe("a");

    store.state.active = "b";
    const resumed = await manager.resumeAgentFromPersistence(
      HANDLE,
      { cwd: workdir, providerAccountId: record?.config?.providerAccountId },
      "00000000-0000-4000-8000-0000000000a2",
    );
    expect(resumed.config.providerAccountId).toBe("a");
    expect(client.launchContexts.at(-1)?.env?.CLAUDE_CONFIG_DIR).toBe("/acct/a");
  });

  it("pins a legacy agent persisted without an account on its next launch", async () => {
    const workdir = makeWorkdir();
    const storage = new AgentStorage(join(workdir, "agents"), logger);
    const { manager, store } = setup(storage);
    store.state.active = "b";
    const agentId = "00000000-0000-4000-8000-0000000000a3";
    const resumed = await manager.resumeAgentFromPersistence(HANDLE, { cwd: workdir }, agentId);
    expect(resumed.config.providerAccountId).toBe("b");
    await manager.flush();
    await storage.flush();
    expect((await storage.get(agentId))?.config?.providerAccountId).toBe("b");

    // Frozen from here on: a later switch does not move it.
    store.state.active = "a";
    expect(manager.getAgent(agentId)?.config.providerAccountId).toBe("b");
  });

  it("treats a transfer to the pinned account as a no-op", async () => {
    const { manager, client } = setup();
    const agent = await manager.resumeAgentFromPersistence(HANDLE, {
      cwd: makeWorkdir(),
    });
    const result = await manager.transferAgentProviderAccount(agent.id, "a");
    expect(result.id).toBe(agent.id);
    expect(client.relocations).toEqual([]);
  });

  it("moves an agent pinned from an undefined launch off its real account", async () => {
    const { manager, client, store } = setup();
    const cwd = makeWorkdir();
    const agent = await manager.resumeAgentFromPersistence(HANDLE, { cwd });
    // The daemon-wide active account moves on; the agent's cache is still on "a".
    store.state.active = "b";
    const moved = await manager.transferAgentProviderAccount(agent.id, "b");
    expect(client.relocations).toEqual([
      expect.objectContaining({
        fromConfigDir: "/acct/a",
        toConfigDir: "/acct/b",
      }),
    ]);
    expect(moved.config.providerAccountId).toBe("b");
  });
});
