export function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 45) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export const providerLabel = (p: string) =>
  ({ claude: "Claude Code", codex: "Codex", mock: "Mock", opencode: "OpenCode", gemini: "Gemini" })[p] ?? p;
