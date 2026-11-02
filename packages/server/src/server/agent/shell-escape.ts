// `!cmd` in a prompt, as in Claude Code's bash mode: the daemon runs the command in the agent's
// folder, shows it as a shell tool call, and hands the output to the model with the next turn.
import { randomUUID } from "node:crypto";

import { spawnProcess } from "../../utils/spawn.js";
import {
  buildStringCommandShellInvocation,
  createStringCommandShellEnvOverlay,
} from "../../utils/string-command-shell.js";
import { terminateWithTreeKill } from "../../utils/tree-kill.js";
import type {
  AgentPromptInput,
  AgentProvider,
  AgentStreamEvent,
  AgentTimelineItem,
} from "./agent-sdk-types.js";

/** Output kept per stream; the tail is what matters for a failing command. */
export const SHELL_ESCAPE_MAX_OUTPUT = 30_000;
export const SHELL_ESCAPE_TIMEOUT_MS = 2 * 60_000;

/** The command of a `!cmd` prompt (text only, nothing attached), or null. */
export function parseShellEscape(prompt: AgentPromptInput): string | null {
  let text: string;
  if (typeof prompt === "string") text = prompt;
  else if (prompt.length === 1 && prompt[0]?.type === "text") text = prompt[0].text;
  else return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith("!")) return null;
  const command = trimmed.slice(1).trim();
  return command ? command : null;
}

export interface ShellEscapeResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

/** Keeps the end of an over-long output, with a note of what was dropped. */
export function capOutput(text: string, max = SHELL_ESCAPE_MAX_OUTPUT): string {
  if (text.length <= max) return text;
  return `[… ${text.length - max} earlier characters dropped]\n${text.slice(-max)}`;
}

export async function runShellEscape(
  command: string,
  cwd: string,
  timeoutMs = SHELL_ESCAPE_TIMEOUT_MS,
): Promise<ShellEscapeResult> {
  const { shell, args } = buildStringCommandShellInvocation({ command });
  const child = spawnProcess(shell, args, {
    cwd,
    envOverlay: createStringCommandShellEnvOverlay(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  // Hold a little over the cap so the dropped-count note is right without unbounded growth.
  const keep = (buf: string, chunk: Buffer) =>
    (buf + chunk.toString("utf8")).slice(-SHELL_ESCAPE_MAX_OUTPUT * 2);
  child.stdout?.on("data", (c: Buffer) => (stdout = keep(stdout, c)));
  child.stderr?.on("data", (c: Buffer) => (stderr = keep(stderr, c)));
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void terminateWithTreeKill(child, { gracefulTimeoutMs: 2_000, forceTimeoutMs: 2_000 });
  }, timeoutMs);
  const exitCode = await new Promise<number | null>((resolve) => {
    child.once("error", (error) => {
      stderr += `${error.message}\n`;
      resolve(null);
    });
    child.once("close", (code) => resolve(code));
  });
  clearTimeout(timer);
  return { stdout: capOutput(stdout), stderr: capOutput(stderr), exitCode, timedOut };
}

/** The output as the model sees it, in Claude Code's bash-mode tags. */
export function shellEscapeContext(command: string, r: ShellEscapeResult): string {
  const note = r.timedOut ? `\n[stopped after ${SHELL_ESCAPE_TIMEOUT_MS / 1000}s]` : "";
  return [
    `<bash-input>${command}</bash-input>`,
    `<bash-stdout>${r.stdout}</bash-stdout><bash-stderr>${r.stderr}${note}</bash-stderr>`,
  ].join("\n");
}

/** Puts pending shell output ahead of the prompt the user typed next. */
export function prependShellContext(
  prompt: AgentPromptInput,
  contexts: readonly string[],
): AgentPromptInput {
  if (!contexts.length) return prompt;
  const context = contexts.join("\n\n");
  if (typeof prompt === "string") return `${context}\n\n${prompt}`;
  return [{ type: "text", text: context }, ...prompt];
}

function shellItem(
  callId: string,
  command: string,
  cwd: string,
  result?: ShellEscapeResult,
): AgentTimelineItem {
  const base = { type: "tool_call" as const, callId, name: "Bash" };
  if (!result)
    return { ...base, status: "running", error: null, detail: { type: "shell", command, cwd } };
  const output = [result.stdout, result.stderr].filter(Boolean).join(result.stdout ? "\n" : "");
  const detail = { type: "shell" as const, command, cwd, output, exitCode: result.exitCode };
  if (result.exitCode === 0 && !result.timedOut)
    return { ...base, status: "completed", error: null, detail };
  const error = result.timedOut
    ? `Stopped after ${SHELL_ESCAPE_TIMEOUT_MS / 1000}s`
    : `Exited with ${result.exitCode ?? "an error"}`;
  return { ...base, status: "failed", error, detail };
}

/**
 * Runs the command and reports it as a shell tool call through `emit`; resolves with the context
 * to hand the model on the next turn.
 */
export async function shellEscape(params: {
  command: string;
  cwd: string;
  provider: AgentProvider;
  emit: (event: AgentStreamEvent) => void;
  run?: typeof runShellEscape;
}): Promise<string> {
  const { command, cwd, provider, emit } = params;
  const callId = `shell-escape-${randomUUID()}`;
  emit({ type: "timeline", provider, item: shellItem(callId, command, cwd) });
  const result = await (params.run ?? runShellEscape)(command, cwd);
  emit({ type: "timeline", provider, item: shellItem(callId, command, cwd, result) });
  return shellEscapeContext(command, result);
}
