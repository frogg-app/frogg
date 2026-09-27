/**
 * COMPAT(agentCleanCut): added in v1.7.0, remove after 2027-09-27.
 *
 * A clean cut ends an agent's provider conversation and starts a fresh one in
 * the same workspace, primed with a short summary instead of the full history.
 * The summary is written by the cheapest model available on the agent's own
 * provider and account, reading only the chat side of the conversation: user
 * and assistant messages plus tool call names and short arguments, never tool
 * output. That transcript is a fraction of the context it stands for, which is
 * where the saving comes from when the prompt cache has expired.
 */
import { z } from "zod";
import { curateAgentActivity } from "./activity-curator.js";
import {
  generateStructuredAgentResponseWithFallback,
  getStructuredAgentResponse,
  type StructuredAgentGenerationOptions,
  type StructuredGenerationProvider,
} from "./agent-response-loop.js";
import type { AgentManager, ManagedAgent } from "./agent-manager.js";
import type {
  AgentPromptInput,
  AgentSessionConfig,
  AgentTimelineItem,
  CleanCutMarker,
} from "./agent-sdk-types.js";
import type { ProviderSnapshotManager } from "./provider-snapshot-manager.js";
import {
  DEFAULT_STRUCTURED_GENERATION_PROVIDERS,
  resolveStructuredGenerationProviders,
  type StructuredGenerationDaemonConfig,
} from "./structured-generation-providers.js";

/** Head kept when a transcript is too long: the opening request frames the rest. */
const TRANSCRIPT_HEAD_CHARS = 20_000;
/** Tail kept when a transcript is too long: where the work currently stands. */
const TRANSCRIPT_TAIL_CHARS = 280_000;
/** One summariser attempt; past this it is abandoned and the next candidate tried. */
const SUMMARY_ATTEMPT_TIMEOUT_MS = 150_000;

export interface CleanCutTarget {
  provider?: string;
  /** `null` is the provider's default account; omitted keeps the current one. */
  providerAccountId?: string | null;
  model?: string | null;
  thinkingOptionId?: string | null;
}

export interface CleanCutDeps {
  agentManager: AgentManager;
  providerSnapshotManager: Pick<ProviderSnapshotManager, "listProviders">;
  readDaemonConfig: () => StructuredGenerationDaemonConfig | null;
  logger: { info: (obj: object, msg?: string) => void; warn: (obj: object, msg?: string) => void };
  /** Test seam: runs one summariser candidate. Defaults to a real internal agent. */
  runner?: SummariserRunner;
}

type SummariserRunner = <T>(options: StructuredAgentGenerationOptions<T>) => Promise<T>;

/**
 * Runs one summariser candidate as a hidden internal agent. It is told not to
 * use tools, but a model may try anyway, and nobody can see a hidden agent's
 * permission prompt: every request is denied on the spot, and an attempt that
 * still does not finish is abandoned, so a cut can never hang on it.
 */
export const runSummariserAgent: SummariserRunner = async (options) => {
  const { manager, agentConfig, prompt, schema, maxRetries, schemaName } = options;
  const agent = await manager.createAgent(agentConfig, undefined, {
    persistSession: options.persistSession,
    workspaceId: undefined,
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    const caller = async (nextPrompt: string): Promise<string> => {
      for await (const event of manager.streamAgent(agent.id, nextPrompt)) {
        if (event.type === "permission_requested") {
          await manager
            .respondToPermission(agent.id, event.request.id, {
              behavior: "deny",
              message: "Tools are unavailable. Answer from the transcript alone.",
            })
            .catch(() => undefined);
        } else if (event.type === "turn_failed") {
          throw new Error(event.error);
        }
      }
      // Streamed text arrives in chunks; the manager holds the assembled reply.
      return (await manager.getLastAssistantMessage(agent.id)) ?? "";
    };
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("The summariser did not finish in time.")),
        SUMMARY_ATTEMPT_TIMEOUT_MS,
      );
    });
    return await Promise.race([
      getStructuredAgentResponse({ caller, prompt, schema, maxRetries, schemaName }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
    await manager.closeAgent(agent.id).catch(() => undefined);
    await manager.deleteAgentState(agent.id).catch(() => undefined);
  }
};

const CleanCutSummarySchema = z.object({
  summary: z.string().min(1),
});

/**
 * The items a clean cut summarises: everything since the previous clean cut,
 * starting with that cut's marker so its summary carries forward.
 */
export function selectCleanCutItems(items: readonly AgentTimelineItem[]): AgentTimelineItem[] {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.type === "compaction" && item.cleanCut) {
      return items.slice(index);
    }
  }
  return [...items];
}

export function buildCleanCutTranscript(items: readonly AgentTimelineItem[]): string {
  const transcript = curateAgentActivity(selectCleanCutItems(items), {
    labelAssistantMessages: true,
    includeKinds: ["user_message", "assistant_message", "tool_call", "todo", "error", "compaction"],
  });
  if (transcript.length <= TRANSCRIPT_HEAD_CHARS + TRANSCRIPT_TAIL_CHARS) {
    return transcript;
  }
  return [
    transcript.slice(0, TRANSCRIPT_HEAD_CHARS),
    "\n[... middle of the conversation omitted ...]\n",
    transcript.slice(-TRANSCRIPT_TAIL_CHARS),
  ].join("");
}

export function buildCleanCutSummaryPrompt(input: { transcript: string; cwd: string }): string {
  return [
    "You are writing a handover note so a fresh coding agent can continue a session without its history.",
    "Do not use any tools: you have no access to the workspace. Answer from the transcript alone,",
    "in a single reply.",
    "",
    `Workspace: ${input.cwd}`,
    "",
    "The transcript below shows user messages, assistant messages and the tool calls the agent made",
    "(names and short arguments only; tool output is omitted). The workspace files already contain",
    "the agent's changes, so describe them by file and purpose rather than repeating code.",
    "",
    "Write a concise summary (aim for under 600 words) in Markdown with these sections:",
    "- Goal: what the user is trying to achieve overall.",
    "- User decisions and constraints: every explicit instruction, preference or rejected approach,",
    "  quoting the user where the wording matters.",
    "- Done so far: what was changed, which files, and what was verified (tests, builds).",
    "- In progress: what was happening when the conversation ended, including open problems.",
    "- Next steps: what the agent should do next, if known.",
    "",
    "<transcript>",
    input.transcript,
    "</transcript>",
  ].join("\n");
}

/**
 * What the provider receives for the first message after a clean cut: the
 * summary, clearly marked as context, then the user's own message.
 */
export function prependCleanCutSummary(
  prompt: AgentPromptInput,
  summary: string,
): AgentPromptInput {
  const preamble = [
    "<clean_cut_summary>",
    "This conversation continues earlier work in this workspace. The earlier conversation was ended",
    "to save tokens (a clean cut) and is not available to you; this is a summary of it. The workspace",
    "files already reflect that work, so read them rather than assuming their contents.",
    "",
    summary.trim(),
    "</clean_cut_summary>",
    "",
    "The user's message follows.",
    "",
  ].join("\n");
  if (typeof prompt === "string") {
    return `${preamble}\n${prompt}`;
  }
  return [{ type: "text", text: preamble }, ...prompt];
}

/**
 * The summariser candidates, cheapest first, all on the agent's own provider so
 * the cost lands on the account the conversation already bills to. The agent's
 * current model is the last resort: dearer, but still reading the stripped
 * transcript rather than the whole context.
 */
async function resolveSameProviderCandidates(
  deps: CleanCutDeps,
  agent: ManagedAgent,
): Promise<StructuredGenerationProvider[]> {
  const entries = await deps.providerSnapshotManager.listProviders({
    cwd: agent.cwd,
    wait: true,
  });
  const entry = entries.find((candidate) => candidate.provider === agent.provider);
  const models = entry?.enabled ? (entry.models ?? []) : [];
  const candidates: StructuredGenerationProvider[] = [];
  for (const identifier of DEFAULT_STRUCTURED_GENERATION_PROVIDERS) {
    const needle = identifier.modelSubstring.toLowerCase();
    const model = models.find((candidate) =>
      [candidate.id, candidate.label].some((value) => value.toLowerCase().includes(needle)),
    );
    if (model) {
      const thinkingOptionId = model.thinkingOptions?.some(
        (option) => option.id === identifier.thinkingOptionId,
      )
        ? identifier.thinkingOptionId
        : model.defaultThinkingOptionId;
      candidates.push({
        provider: agent.provider,
        model: model.id,
        ...(thinkingOptionId ? { thinkingOptionId } : {}),
      });
    }
  }
  candidates.push({
    provider: agent.provider,
    ...(agent.config.model ? { model: agent.config.model } : {}),
  });
  return candidates;
}

async function generateCleanCutSummary(
  deps: CleanCutDeps,
  agent: ManagedAgent,
  transcript: string,
): Promise<{ summary: string; summaryModel: string | undefined }> {
  const prompt = buildCleanCutSummaryPrompt({ transcript, cwd: agent.cwd });
  const baseOverrides = {
    title: "Clean cut summary",
    internal: true,
  } satisfies Omit<AgentSessionConfig, "provider" | "cwd" | "model" | "thinkingOptionId">;
  // Remember which candidate answered, so the marker can name the model.
  let summaryModel: string | undefined;
  const runOne = deps.runner ?? runSummariserAgent;
  const runner: SummariserRunner = async (options) => {
    const result = await runOne(options);
    summaryModel = options.agentConfig.model;
    return result;
  };
  const generate = (
    providers: StructuredGenerationProvider[],
    overrides: Omit<AgentSessionConfig, "provider" | "cwd" | "model" | "thinkingOptionId">,
  ) =>
    generateStructuredAgentResponseWithFallback({
      manager: deps.agentManager,
      cwd: agent.cwd,
      prompt,
      schema: CleanCutSummarySchema,
      schemaName: "CleanCutSummary",
      maxRetries: 1,
      providers,
      persistSession: false,
      agentConfigOverrides: overrides,
      logger: deps.logger,
      runner,
    });

  try {
    const result = await generate(await resolveSameProviderCandidates(deps, agent), {
      ...baseOverrides,
      ...(agent.config.providerAccountId !== undefined
        ? { providerAccountId: agent.config.providerAccountId }
        : {}),
    });
    return { summary: result.summary.trim(), summaryModel };
  } catch (error) {
    deps.logger.warn(
      { err: error, agentId: agent.id, provider: agent.provider },
      "Clean cut summary failed on the agent's provider; trying other providers",
    );
  }

  const fallback = await resolveStructuredGenerationProviders({
    cwd: agent.cwd,
    providerSnapshotManager: deps.providerSnapshotManager,
    daemonConfig: deps.readDaemonConfig(),
  });
  const result = await generate(fallback, baseOverrides);
  return { summary: result.summary.trim(), summaryModel };
}

function movesAgent(agent: ManagedAgent, target: CleanCutTarget): boolean {
  return (
    (target.provider !== undefined && target.provider !== agent.provider) ||
    (target.providerAccountId !== undefined &&
      target.providerAccountId !== agent.config.providerAccountId) ||
    (target.model !== undefined && target.model !== agent.config.model)
  );
}

/**
 * Summarise, start the fresh provider session, then record the cut in the
 * timeline. The marker goes in last: it is what primes the next message, so it
 * must only exist once the new session does.
 */
export async function runCleanCut(
  deps: CleanCutDeps,
  input: { agentId: string; target: CleanCutTarget; reason?: CleanCutMarker["reason"] },
): Promise<void> {
  const agent = deps.agentManager.getAgent(input.agentId);
  if (!agent) {
    throw new Error(`Unknown agent "${input.agentId}".`);
  }
  if (agent.lifecycle === "running") {
    throw new Error("Wait for the agent to finish its turn before making a clean cut.");
  }
  const items = deps.agentManager.getTimeline(input.agentId);
  const selected = selectCleanCutItems(items);
  const { target } = input;
  const previousCut = selected[0]?.type === "compaction" ? selected[0].cleanCut : undefined;
  let summary: string;
  let summaryModel: string | undefined;
  let transcriptChars = 0;
  if (selected.some((item) => item.type === "user_message")) {
    const transcript = buildCleanCutTranscript(items);
    transcriptChars = transcript.length;
    ({ summary, summaryModel } = await generateCleanCutSummary(deps, agent, transcript));
  } else if (previousCut) {
    // Nothing new since the last cut: its summary still stands, and a cut is
    // only worth making to move somewhere else.
    if (!movesAgent(agent, target)) return;
    summary = previousCut.summary;
    summaryModel = previousCut.summaryModel;
  } else {
    throw new Error("There is no conversation to summarise yet.");
  }

  const previous = {
    sessionId: agent.persistence?.sessionId,
    provider: agent.provider,
    model: agent.config.model,
  };
  const overrides: Partial<AgentSessionConfig> = {
    ...(target.provider ? { provider: target.provider } : {}),
    ...(target.providerAccountId !== undefined
      ? { providerAccountId: target.providerAccountId }
      : {}),
    ...(target.model !== undefined ? { model: target.model ?? undefined } : {}),
    ...(target.thinkingOptionId !== undefined
      ? { thinkingOptionId: target.thinkingOptionId ?? undefined }
      : {}),
  };
  const next = await deps.agentManager.startFreshAgentSession(input.agentId, overrides);

  const marker: CleanCutMarker = {
    summary,
    ...(previous.sessionId ? { previousSessionId: previous.sessionId } : {}),
    previousProvider: previous.provider,
    ...(previous.model ? { previousModel: previous.model } : {}),
    provider: next.provider,
    ...(next.config.model ? { model: next.config.model } : {}),
    ...(summaryModel ? { summaryModel } : {}),
    reason: input.reason ?? "manual",
  };
  await deps.agentManager.appendTimelineItem(input.agentId, {
    type: "compaction",
    status: "completed",
    trigger: "manual",
    cleanCut: marker,
  });
  deps.logger.info(
    {
      agentId: input.agentId,
      fromProvider: previous.provider,
      toProvider: next.provider,
      transcriptChars,
      summaryChars: summary.length,
      summaryModel,
      reason: marker.reason,
    },
    "Clean cut completed",
  );
}
