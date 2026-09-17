// Provider brand names are not translated.
const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  pi: "Pi",
  copilot: "GitHub Copilot",
};

export function providerAccountLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}
