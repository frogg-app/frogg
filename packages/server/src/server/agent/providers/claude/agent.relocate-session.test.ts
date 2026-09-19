import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ClaudeAgentClient } from "./agent.js";
import { claudeProjectDirSync } from "./project-dir.js";
import type { AgentPersistenceHandle } from "../../agent-sdk-types.js";

/**
 * Moving a conversation between sign-ins is a file copy and nothing more: the
 * transcript has to land where the target account's CLI will look for it, and
 * the account it came from has to keep its own copy so the move can be undone.
 */
describe("ClaudeAgentClient.relocateNativeSession", () => {
  let root: string;
  let cwd: string;
  let fromConfigDir: string;
  let toConfigDir: string;
  let client: ClaudeAgentClient;

  const handle: AgentPersistenceHandle = { provider: "claude", sessionId: "session-1" };

  function transcriptIn(configDir: string, sessionId = "session-1"): string {
    return path.join(claudeProjectDirSync(cwd, { configDir }), `${sessionId}.jsonl`);
  }

  function writeTranscript(configDir: string, contents: string): string {
    const target = transcriptIn(configDir);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
    return target;
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "frogg-claude-relocate-"));
    cwd = path.join(root, "workspace");
    fromConfigDir = path.join(root, ".claude");
    toConfigDir = path.join(root, ".claude-work");
    mkdirSync(cwd, { recursive: true });
    client = new ClaudeAgentClient({ logger: pino({ level: "silent" }) });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("copies the transcript into the target account and leaves the source in place", async () => {
    const source = writeTranscript(fromConfigDir, '{"type":"user"}\n');

    await client.relocateNativeSession({ handle, cwd, fromConfigDir, toConfigDir });

    const destination = transcriptIn(toConfigDir);
    expect(readFileSync(destination, "utf8")).toBe('{"type":"user"}\n');
    // The account the conversation came from keeps its copy, so it can be
    // transferred back.
    expect(existsSync(source)).toBe(true);
  });

  it("prefers the session's native handle over the frogg session id", async () => {
    const target = path.join(
      claudeProjectDirSync(cwd, { configDir: fromConfigDir }),
      "native.jsonl",
    );
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "native\n");

    await client.relocateNativeSession({
      handle: { provider: "claude", sessionId: "session-1", nativeHandle: "native" },
      cwd,
      fromConfigDir,
      toConfigDir,
    });

    expect(readFileSync(transcriptIn(toConfigDir, "native"), "utf8")).toBe("native\n");
  });

  it("refuses a move when the conversation has never been written to disk", async () => {
    await expect(
      client.relocateNativeSession({ handle, cwd, fromConfigDir, toConfigDir }),
    ).rejects.toThrow(/No Claude transcript/);
  });

  it("does nothing when the account already reads that directory", async () => {
    const source = writeTranscript(fromConfigDir, "unchanged\n");

    await client.relocateNativeSession({
      handle,
      cwd,
      fromConfigDir,
      toConfigDir: fromConfigDir,
    });

    expect(readFileSync(source, "utf8")).toBe("unchanged\n");
  });

  it("overwrites a stale copy left in the target account by an earlier transfer", async () => {
    writeTranscript(fromConfigDir, "current\n");
    writeTranscript(toConfigDir, "stale\n");

    await client.relocateNativeSession({ handle, cwd, fromConfigDir, toConfigDir });

    expect(readFileSync(transcriptIn(toConfigDir), "utf8")).toBe("current\n");
  });
});
