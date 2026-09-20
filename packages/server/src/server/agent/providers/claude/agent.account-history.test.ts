import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { ClaudeAgentClient } from "./agent.js";
import { claudeProjectDirSync } from "./project-dir.js";
import type { AgentStreamEvent } from "../../agent-sdk-types.js";

const HISTORY_MARKER = "ACCOUNT_SCOPED_HISTORY_MARKER";

const queryFactory = vi.fn(() => {
  throw new Error("history replay must not start a query");
});

describe("ClaudeAgentSession history for non-default provider accounts", () => {
  let tempRoot: string;
  let cwd: string;
  let accountConfigDir: string;
  let daemonConfigDir: string;
  let previousClaudeConfigDir: string | undefined;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), "claude-account-history-"));
    cwd = path.join(tempRoot, "repo");
    accountConfigDir = path.join(tempRoot, "claude-account");
    daemonConfigDir = path.join(tempRoot, "claude-daemon");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(daemonConfigDir, { recursive: true });

    const historyDir = claudeProjectDirSync(cwd, { configDir: accountConfigDir });
    mkdirSync(historyDir, { recursive: true });
    writeFileSync(
      path.join(historyDir, "account-session.jsonl"),
      JSON.stringify({
        type: "assistant",
        sessionId: "account-session",
        cwd,
        message: { role: "assistant", content: HISTORY_MARKER },
      }),
      "utf8",
    );

    // The daemon's own env points somewhere else entirely, as it does whenever the
    // agent runs under a provider account other than the daemon-wide default.
    previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = daemonConfigDir;
  });

  afterEach(() => {
    if (previousClaudeConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("replays history from the account config dir supplied by the launch env", async () => {
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
    });
    const session = await client.resumeSession(
      {
        provider: "claude",
        sessionId: "account-session",
        nativeHandle: "account-session",
        metadata: { provider: "claude", cwd },
      },
      { cwd },
      { env: { CLAUDE_CONFIG_DIR: accountConfigDir } },
    );

    const events: AgentStreamEvent[] = [];
    try {
      for await (const event of session.streamHistory()) events.push(event);
    } finally {
      await session.close();
    }

    const text = events
      .filter((event) => event.type === "timeline" && event.item.type === "assistant_message")
      .map((event) =>
        event.type === "timeline" && event.item.type === "assistant_message" ? event.item.text : "",
      )
      .join("\n");
    expect(text).toContain(HISTORY_MARKER);
  });
});
