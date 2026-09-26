import { resolve } from "node:path";
import type { Options as ClaudeOptions, PermissionResult } from "@anthropic-ai/claude-agent-sdk";

import { isPathInsideRoot } from "../../../../utils/path.js";
import type { AgentFeatureToggle, AgentSessionConfig } from "../../agent-sdk-types.js";
import { CHAT_WEB_ACCESS_FEATURE_ID, isChatWebAccessEnabled } from "../../chat-profile.js";

const CHAT_READ_TOOLS = ["Read", "Glob", "Grep"] as const;
const CHAT_WRITE_TOOLS = ["Write", "Edit"] as const;
const CHAT_WEB_TOOLS = ["WebSearch", "WebFetch"] as const;
// Routed through the normal permission flow so the question card still renders.
const CHAT_INTERACTIVE_TOOLS = ["AskUserQuestion"] as const;

const WRITE_TOOL_NAMES = new Set<string>(CHAT_WRITE_TOOLS);
const AUTO_ALLOWED_TOOL_NAMES = new Set<string>(CHAT_READ_TOOLS);
const WEB_TOOL_NAMES = new Set<string>(CHAT_WEB_TOOLS);
const INTERACTIVE_TOOL_NAMES = new Set<string>(CHAT_INTERACTIVE_TOOLS);

export const CLAUDE_CHAT_WEB_ACCESS_FEATURE: Omit<AgentFeatureToggle, "value"> = {
  type: "toggle",
  id: CHAT_WEB_ACCESS_FEATURE_ID,
  label: "Web",
  description: "Let this chat search and fetch web pages",
  tooltip: "Toggle web access",
  icon: "globe",
};

export function buildClaudeChatFeatures(
  config: Pick<AgentSessionConfig, "featureValues">,
): AgentFeatureToggle[] {
  return [
    {
      ...CLAUDE_CHAT_WEB_ACCESS_FEATURE,
      value: isChatWebAccessEnabled(config),
    },
  ];
}

/**
 * SDK options that isolate a chat: only the listed built-in tools exist, and no
 * filesystem settings, CLAUDE.md, skills, plugins, subagents or MCP servers load.
 * Spread last over the normal options so nothing earlier can widen them.
 */
export function buildClaudeChatOptions(
  config: Pick<AgentSessionConfig, "featureValues">,
): Partial<ClaudeOptions> {
  const tools: string[] = [
    ...CHAT_READ_TOOLS,
    ...CHAT_WRITE_TOOLS,
    ...CHAT_INTERACTIVE_TOOLS,
    ...(isChatWebAccessEnabled(config) ? CHAT_WEB_TOOLS : []),
  ];
  return {
    tools,
    // Empty so every call reaches canUseTool (bare entries would bypass it).
    allowedTools: [],
    disallowedTools: [],
    permissionMode: "default",
    settingSources: [],
    skills: [],
    plugins: [],
    agents: undefined,
    mcpServers: {},
    strictMcpConfig: true,
  };
}

/**
 * Decides a chat tool call without asking the user, or returns null to hand it
 * to the normal permission flow (questions only). Writes are confined to the
 * chat's own directory.
 */
export function resolveClaudeChatPermission(input: {
  toolName: string;
  toolInput: Record<string, unknown>;
  cwd: string;
  webAccess: boolean;
}): PermissionResult | null {
  const { toolName, toolInput, cwd } = input;
  if (INTERACTIVE_TOOL_NAMES.has(toolName)) return null;
  if (AUTO_ALLOWED_TOOL_NAMES.has(toolName)) {
    return { behavior: "allow", updatedInput: toolInput };
  }
  if (WEB_TOOL_NAMES.has(toolName)) {
    return input.webAccess
      ? { behavior: "allow", updatedInput: toolInput }
      : {
          behavior: "deny",
          message: "Web access is turned off for this chat.",
        };
  }
  if (WRITE_TOOL_NAMES.has(toolName)) {
    const target = toolInput.file_path;
    if (typeof target === "string" && isPathInsideRoot(cwd, resolve(cwd, target))) {
      return { behavior: "allow", updatedInput: toolInput };
    }
    return {
      behavior: "deny",
      message: "Chats can only create or edit files inside the chat's own directory.",
    };
  }
  return {
    behavior: "deny",
    message: `The ${toolName} tool is not available in chats.`,
  };
}
