import { afterEach, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import { startAgentRun } from "./agent-prompt.js";
import type {
  AgentClient,
  AgentPromptInput,
  AgentRunResult,
  AgentSession,
  AgentStreamEvent,
  SteerActiveTurnOptions,
  SteerResult,
} from "./agent-sdk-types.js";

const CAPABILITIES = {
  supportsStreaming: true,
  supportsSessionPersistence: false,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
} as const;

const RESUME_PROMPT = "daemon restarted, continue";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Scripted provider session: a turn start is held until `releaseStart`, then the turn streams
 * "part one" and finishes ("part two", turn_completed) on `finishTurn`. Steered prompts are
 * answered inside the same turn before it completes, like Claude's queued input.
 */
class ScriptedSession implements AgentSession {
  readonly provider = "codex" as const;
  readonly capabilities = CAPABILITIES;
  readonly id = randomUUID();
  readonly prompts: string[] = [];
  readonly steers: string[] = [];
  interrupts = 0;
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private startGate = deferred();
  private turnSeq = 0;
  private activeTurn: string | null = null;

  constructor(readonly canSteer: boolean) {
    if (canSteer) {
      this.steerActiveTurn = async (
        prompt: AgentPromptInput,
        options: SteerActiveTurnOptions,
      ): Promise<SteerResult> => {
        if (this.activeTurn !== options.expectedTurnId) return { status: "unavailable" };
        this.steers.push(String(prompt));
        return { status: "accepted" };
      };
    }
  }

  steerActiveTurn?: (
    prompt: AgentPromptInput,
    options: SteerActiveTurnOptions,
  ) => Promise<SteerResult>;

  releaseStart(): void {
    this.startGate.resolve();
  }

  async run(): Promise<AgentRunResult> {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }

  async startTurn(prompt: AgentPromptInput): Promise<{ turnId: string }> {
    this.prompts.push(String(prompt));
    // Only the first (resumed) turn has a slow cold start.
    if (this.turnSeq === 0) await this.startGate.promise;
    const turnId = `turn-${++this.turnSeq}`;
    this.activeTurn = turnId;
    setTimeout(() => {
      this.push({ type: "turn_started", provider: this.provider, turnId });
      this.push({
        type: "timeline",
        provider: this.provider,
        turnId,
        item: { type: "assistant_message", text: `reply to ${String(prompt)}: part one` },
      } as AgentStreamEvent);
      if (this.turnSeq > 1) this.finishTurn();
    }, 0);
    return { turnId };
  }

  finishTurn(): void {
    const turnId = this.activeTurn;
    if (!turnId) return;
    const text = this.turnSeq === 1 ? " part two" : "";
    this.push({
      type: "timeline",
      provider: this.provider,
      turnId,
      item: { type: "assistant_message", text },
    } as AgentStreamEvent);
    for (const steer of this.steers.splice(0)) {
      this.push({
        type: "timeline",
        provider: this.provider,
        turnId,
        item: { type: "assistant_message", text: `answer to ${steer}` },
      } as AgentStreamEvent);
    }
    this.activeTurn = null;
    this.push({ type: "turn_completed", provider: this.provider, turnId });
  }

  private push(event: AgentStreamEvent): void {
    for (const cb of this.subscribers) cb(event);
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {}
  async getRuntimeInfo() {
    return { provider: this.provider, sessionId: this.id, model: null, modeId: null };
  }
  async getAvailableModes() {
    return [];
  }
  async getCurrentMode() {
    return null;
  }
  async setMode(): Promise<void> {}
  getPendingPermissions() {
    return [];
  }
  async respondToPermission(): Promise<void> {}
  describePersistence() {
    return { provider: this.provider, sessionId: this.id };
  }
  async interrupt(): Promise<void> {
    this.interrupts += 1;
  }
  async close(): Promise<void> {}
}

class ScriptedClient implements AgentClient {
  readonly provider = "codex" as const;
  readonly capabilities = CAPABILITIES;
  session!: ScriptedSession;
  constructor(private readonly canSteer: boolean) {}
  async isAvailable() {
    return true;
  }
  async createSession(): Promise<AgentSession> {
    this.session = new ScriptedSession(this.canSteer);
    return this.session;
  }
  async resumeSession(): Promise<AgentSession> {
    return this.createSession();
  }
  async fetchCatalog() {
    return { models: [], modes: [] };
  }
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function scenario(canSteer: boolean) {
  const workdir = mkdtempSync(join(tmpdir(), "continuation-queue-"));
  const client = new ScriptedClient(canSteer);
  const logger = createTestLogger();
  const agentManager = new AgentManager({ clients: { codex: client }, logger });
  const { id } = await agentManager.createAgent({ provider: "codex", cwd: workdir }, undefined, {
    workspaceId: undefined,
  });
  cleanups.push(async () => {
    client.session.releaseStart();
    await agentManager.closeAgent(id).catch(() => undefined);
    rmSync(workdir, { recursive: true, force: true });
  });
  const assistantText = () =>
    agentManager
      .getTimeline(id)
      .filter((i) => i.type === "assistant_message")
      .map((i) => (i as { text: string }).text)
      .join("");
  const waitIdle = async () => {
    for (let i = 0; i < 200; i++) {
      const a = agentManager.getAgent(id);
      if (a?.lifecycle === "idle" && !agentManager.hasInFlightRun(id)) return;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("agent never went idle");
  };
  // Same dispatch the daemon uses: resume as a continuation, the user's send as "interrupt".
  const resume = () =>
    startAgentRun(agentManager, id, RESUME_PROMPT, logger, {
      replaceRunning: true,
      runOptions: { continuation: true },
    });
  const userSend = (text: string) =>
    startAgentRun(agentManager, id, text, logger, {
      replaceRunning: true,
      activeTurnBehavior: "interrupt",
      runOptions: { clientMessageId: randomUUID() },
    });
  return { client, agentManager, id, assistantText, waitIdle, resume, userSend };
}

describe("a user message sent while a resumed turn is starting", () => {
  test("queues behind the resume and is answered; the resumed reply is not cut", async () => {
    const s = await scenario(false);
    await s.resume();
    // The resumed turn is still cold-starting when the user's message arrives.
    const send = s.userSend("hello?");
    await tick();
    s.client.session.releaseStart();
    await tick();
    await tick();
    s.client.session.finishTurn();
    await expect(send).resolves.toEqual({ disposition: "turn_started" });
    await s.waitIdle();

    expect(s.client.session.interrupts).toBe(0);
    expect(s.client.session.prompts).toEqual([RESUME_PROMPT, "hello?"]);
    expect(s.assistantText()).toContain(`reply to ${RESUME_PROMPT}: part one part two`);
    expect(s.assistantText()).toContain("reply to hello?: part one");
  });

  test("is steered into the resumed turn when the provider can steer", async () => {
    const s = await scenario(true);
    await s.resume();
    const send = s.userSend("hello?");
    await tick();
    s.client.session.releaseStart();
    await expect(send).resolves.toEqual({ disposition: "steered" });
    await tick();
    s.client.session.finishTurn();
    await s.waitIdle();

    expect(s.client.session.interrupts).toBe(0);
    expect(s.client.session.prompts).toEqual([RESUME_PROMPT]);
    expect(s.assistantText()).toContain(`reply to ${RESUME_PROMPT}: part one part two`);
    expect(s.assistantText()).toContain("answer to hello?");
  });

  test("an ordinary run is still interrupted by a new message", async () => {
    const s = await scenario(false);
    s.client.session.releaseStart();
    await startAgentRun(s.agentManager, s.id, "first", createTestLogger(), {
      replaceRunning: true,
    });
    await tick();
    await tick();
    await s.userSend("second");
    expect(s.client.session.interrupts).toBe(1);
  });
});
