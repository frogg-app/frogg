import { redactText, type RedactionResult } from "@frogg/protocol/usage-stats/redact";
import type { AppIdentity } from "./batch";

/**
 * "Report a bug": the report is plain text the user reviews and edits before anything leaves the
 * device. Building it redacts the description, the attached chat and the environment lines;
 * what is finally sent (or saved) is exactly the text in the editor.
 */
export const BUG_REPORT_SCHEMA_VERSION = 1;

/** The timeline item shapes the transcript reads; everything else is skipped. */
export type TranscriptItem =
  | { type: "user_message"; text: string }
  | { type: "assistant_message"; text: string }
  | { type: "error"; message: string }
  | { type: "tool_call"; name: string; status?: string }
  | { type: string };

const MAX_CHAT_CHARS = 60_000;

/** A readable chat: messages and errors in full, tool calls by name only (never their input). */
export function chatTranscript(items: readonly TranscriptItem[]): string {
  const lines: string[] = [];
  for (const item of items) {
    if (item.type === "user_message" && "text" in item) lines.push(`## You\n${item.text}`);
    else if (item.type === "assistant_message" && "text" in item)
      lines.push(`## Agent\n${item.text}`);
    else if (item.type === "error" && "message" in item) lines.push(`## Error\n${item.message}`);
    else if (item.type === "tool_call" && "name" in item)
      lines.push(`[tool ${item.name}${"status" in item && item.status ? `: ${item.status}` : ""}]`);
  }
  const text = lines.join("\n\n");
  return text.length > MAX_CHAT_CHARS
    ? `[earlier messages trimmed]\n\n${text.slice(-MAX_CHAT_CHARS)}`
    : text;
}

export interface BugReportInput {
  description: string;
  app: AppIdentity;
  daemonVersion?: string | null;
  provider?: string | null;
  chat?: string | null;
  homeDirs?: string[];
}

export interface BugReportDraft extends RedactionResult {
  text: string;
}

export function buildBugReport(input: BugReportInput): BugReportDraft {
  const env = [
    `App: ${input.app.product} ${input.app.version} (${input.app.platform}, ${input.app.os})`,
    input.daemonVersion ? `Daemon: ${input.daemonVersion}` : null,
    input.provider ? `Provider: ${input.provider}` : null,
  ].filter(Boolean);
  const raw = [
    "# What happened",
    input.description.trim() || "(no description)",
    "",
    "# Environment",
    ...env,
    ...(input.chat ? ["", "# Attached chat", input.chat] : []),
  ].join("\n");
  return redactText(raw, { homeDirs: input.homeDirs });
}

export interface BugReportPayload {
  schema: typeof BUG_REPORT_SCHEMA_VERSION;
  client: { product: string; version: string; platform: string };
  withChat: boolean;
  /** The report exactly as the user left it in the editor. */
  report: string;
}

export function bugReportPayload(
  report: string,
  app: AppIdentity,
  withChat: boolean,
): BugReportPayload {
  return {
    schema: BUG_REPORT_SCHEMA_VERSION,
    client: { product: app.product, version: app.version, platform: app.platform },
    withChat,
    report,
  };
}

export function bugReportFileName(now: Date = new Date()): string {
  return `frogg-bug-report-${now.toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`;
}
