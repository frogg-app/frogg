import { join } from "node:path";

import { areEquivalentPaths, isPathInsideRoot } from "../../utils/path.js";
import type { AgentProvider, AgentSessionConfig } from "./agent-sdk-types.js";

/**
 * Chats are conversations that belong to no project. Each one is a directory
 * under `<froggHome>/chats/`, and any agent whose cwd is inside such a
 * directory launches with the chat profile: no skills, plugins or MCP servers,
 * no shell, read-only filesystem access (writes only inside its own chat
 * directory) and optional web access.
 *
 * The profile is derived from the cwd on every launch rather than persisted,
 * so create, resume, reload and account transfer all get it and no client
 * flag can switch it off.
 */
export const CHATS_DIRECTORY_NAME = "chats";

/** Feature toggle a chat agent exposes for web search and fetch. Defaults to on. */
export const CHAT_WEB_ACCESS_FEATURE_ID = "web_access";

/** Providers whose clients enforce the chat profile. */
export const CHAT_SUPPORTED_PROVIDERS: readonly AgentProvider[] = ["claude"];

const CHAT_SYSTEM_PROMPT = [
  "You are in a standalone chat that is not attached to any project.",
  "You can read files anywhere on this machine, but you cannot run shell commands",
  "and you can only create or edit files inside the current working directory.",
  "When the user wants a change made elsewhere, show them the change to apply themselves.",
].join(" ");

export function resolveChatsRoot(froggHome: string): string {
  return join(froggHome, CHATS_DIRECTORY_NAME);
}

/** True for a chat's own directory; the chats root itself is not a chat. */
export function isChatCwd(chatsRoot: string | null | undefined, cwd: string): boolean {
  if (!chatsRoot) return false;
  return isPathInsideRoot(chatsRoot, cwd) && !areEquivalentPaths(chatsRoot, cwd);
}

export function isChatWebAccessEnabled(config: Pick<AgentSessionConfig, "featureValues">): boolean {
  return config.featureValues?.[CHAT_WEB_ACCESS_FEATURE_ID] !== false;
}

/**
 * Drops everything a caller could use to widen a chat agent's reach. Applied
 * before the config is stored, so a resumed chat cannot pick any of it back up.
 */
export function sanitizeChatSessionConfig(config: AgentSessionConfig): AgentSessionConfig {
  const next: AgentSessionConfig = { ...config };
  delete next.mcpServers;
  delete next.toolPolicy;
  delete next.providerOptions;
  delete next.modeId;
  return next;
}

/** Marks the launch config as a chat and appends the chat instructions. */
export function applyChatLaunchConfig(config: AgentSessionConfig): AgentSessionConfig {
  const daemonAppendSystemPrompt = [config.daemonAppendSystemPrompt?.trim(), CHAT_SYSTEM_PROMPT]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
  return { ...config, chat: true, daemonAppendSystemPrompt };
}
