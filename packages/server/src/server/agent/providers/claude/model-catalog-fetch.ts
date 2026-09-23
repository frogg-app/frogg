/**
 * Asks the installed Claude Code which models it supports.
 *
 * The catalog is a property of the CLI, not of a conversation, so this opens a
 * short-lived control-plane query, reads `supportedModels()` and closes it
 * again — the same shape Codex's catalog fetch uses against its app-server. The
 * query carries no prompt and never runs a turn.
 */

import type { ChildProcess } from "node:child_process";

import type { Logger } from "pino";
import type { ModelInfo, Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";
import { terminateWithTreeKill } from "../../../../utils/tree-kill.js";
import { claudeQuery, type ClaudeQueryFactory } from "./query.js";

/** A catalog read that has not answered by now is not going to. */
const SUPPORTED_MODELS_TIMEOUT_MS = 30_000;

export interface FetchClaudeSupportedModelsOptions {
  logger: Logger;
  /** The binary a session would launch, so the catalog describes that CLI. */
  binaryPath?: string;
  runtimeSettings?: ProviderRuntimeSettings;
  launchEnv?: Record<string, string>;
  queryFactory?: ClaudeQueryFactory;
  signal?: AbortSignal;
}

/** A prompt that never yields, so the CLI stays idle on its control plane. */
async function* idlePrompt(): AsyncGenerator<SDKUserMessage> {
  await new Promise<never>(() => {});
  // Unreachable; present so the generator's element type is inferred.
  yield undefined as unknown as SDKUserMessage;
}

function timeoutAfter(timeoutMs: number, label: string): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    timer.unref?.();
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([promise, timeoutAfter(timeoutMs, label)]);
}

export async function fetchClaudeSupportedModels(
  options: FetchClaudeSupportedModelsOptions,
): Promise<ModelInfo[]> {
  let activeQuery: Query | undefined;
  let child: ChildProcess | undefined;
  const disposeChild = async () => {
    if (!child) return;
    await terminateWithTreeKill(child, {
      gracefulTimeoutMs: 2_000,
      forceTimeoutMs: 2_000,
    }).catch(() => {
      /* already gone */
    });
    child = undefined;
  };

  try {
    activeQuery = claudeQuery(
      {
        prompt: idlePrompt(),
        options: {
          // A catalog read wants the CLI's own view and nothing else: no user
          // settings, no MCP servers to start, no transcript to leave behind.
          settingSources: [],
          mcpServers: {},
          persistSession: false,
          ...(options.binaryPath ? { pathToClaudeCodeExecutable: options.binaryPath } : {}),
          ...(options.signal ? { abortController: toAbortController(options.signal) } : {}),
        },
      },
      {
        ...(options.runtimeSettings ? { runtimeSettings: options.runtimeSettings } : {}),
        ...(options.launchEnv ? { launchEnv: options.launchEnv } : {}),
        ...(options.queryFactory ? { queryFactory: options.queryFactory } : {}),
        onChildProcess: (spawned) => {
          child = spawned;
        },
      },
    );
    return await withTimeout(
      activeQuery.supportedModels(),
      SUPPORTED_MODELS_TIMEOUT_MS,
      "Claude supportedModels()",
    );
  } finally {
    try {
      activeQuery?.close?.();
      await activeQuery?.return?.();
    } catch {
      /* the process is being torn down either way */
    }
    await disposeChild();
  }
}

function toAbortController(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", () => controller.abort(), { once: true });
  return controller;
}
