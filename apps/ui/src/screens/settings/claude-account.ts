import type { MutableDaemonConfig } from "@frogg/protocol/messages";

export const CLAUDE_ACCOUNT_CONTENT = [
  "commands",
  "hooks",
  "plans",
  "plugins",
  "projects",
  "skills",
  "todos",
] as const;

export type ClaudeAccountContent = (typeof CLAUDE_ACCOUNT_CONTENT)[number];

/** Turn user text into a readable, relative, non-traversing account directory name. */
export function sanitizeClaudeAccountName(label: string): string {
  const slug = label
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}._-]/gu, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.-]+|[.-]+$/g, "");
  return slug || "account";
}

export function buildClaudeAccountProvider(
  label: string,
  sharedContent: readonly ClaudeAccountContent[],
  existing: MutableDaemonConfig["providers"] = {},
) {
  const base = sanitizeClaudeAccountName(label).toLowerCase();
  let n = 1;
  let id = `claude-account-${base}`;
  while (existing[id]) id = `claude-account-${base}-${++n}`;
  return {
    id,
    provider: {
      extends: "claude" as const,
      label: label.trim(),
      params: {
        claudeAccount: {
          configDir: `~/.claude-account-${base}${n > 1 ? `-${n}` : ""}`,
          sharedContent,
        },
      },
    },
  };
}

export function validateClaudeAccountLabel(label: string): string | null {
  return label.trim() ? null : "required";
}

/** Exact interactive command used to authenticate an isolated account on its daemon host. */
export function buildClaudeAccountAuthCommand(label: string): string {
  const base = sanitizeClaudeAccountName(label).toLowerCase();
  return `CLAUDE_CONFIG_DIR="$HOME/.claude-account-${base}" claude auth login`;
}
