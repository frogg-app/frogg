/**
 * Spots provider errors that mean "sign in again": an expired or revoked OAuth session, a missing
 * credential, or an account that was never signed in. The text comes from the provider CLI or
 * the daemon, so this matches wording, not codes.
 */
export interface AuthProblem {
  /** Provider id the text names, when it names one. */
  provider: string | null;
  /** Account name the text names (`Account "work" …`), when it names one. */
  account: string | null;
}

const SIGNED_OUT = [
  /OAuth (?:session|token)[^.\n]*(?:expired|revoked|invalid)/i,
  /could not be refreshed/i,
  /failed to authenticate/i,
  /is not signed in to provider/i,
  /\bnot (?:signed|logged) in\b/i,
  /please (?:run )?\/login/i,
  /run [`'"]?(?:claude (?:auth )?login|codex login)/i,
  /invalid (?:api key|bearer token|access token)/i,
  /authentication_error/i,
  /(?:access|refresh) token[^.\n]*(?:expired|revoked|invalid)/i,
  /\b401\b[^\n]*unauthori[sz]ed/i,
];

const NAMED_PROVIDER: Array<[RegExp, string]> = [
  [/\bclaude\b/i, "claude"],
  [/\bcodex\b|\bopenai\b|chatgpt/i, "codex"],
  [/\bgemini\b/i, "gemini"],
  [/\bcopilot\b/i, "copilot"],
  [/\bopencode\b/i, "opencode"],
];

export function authProblem(text: string | null | undefined): AuthProblem | null {
  if (!text || !SIGNED_OUT.some((re) => re.test(text))) return null;
  const quoted = /Account "([^"]+)" is not signed in to provider "([^"]+)"/.exec(text);
  if (quoted) return { account: quoted[1] ?? null, provider: quoted[2] ?? null };
  const named = NAMED_PROVIDER.find(([re]) => re.test(text));
  return { account: null, provider: named?.[1] ?? null };
}
