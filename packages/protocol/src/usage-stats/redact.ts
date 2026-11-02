/**
 * Scrubs text before it leaves the device in a bug report: secrets (API keys, tokens, private
 * keys, passwords in assignments and URLs), email addresses, IP addresses, tailnet names and
 * home-directory paths. It is a best-effort pattern pass, which is why the report is always
 * shown, editable, before it is sent.
 */
export type RedactionKind = "secret" | "email" | "path" | "ip" | "host";

export interface RedactionResult {
  text: string;
  counts: Record<RedactionKind, number>;
}

export interface RedactOptions {
  /** Home directories to replace with `~` (the app's and each host's, when known). */
  homeDirs?: readonly string[];
  /** Account names to replace with `<user>` wherever they appear as a path segment. */
  userNames?: readonly string[];
}

const SECRET = "[REDACTED_SECRET]";

/** Token shapes with a recognisable prefix. Order matters: specific before generic. */
const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-(?:ant-|proj-|svcacct-)?[A-Za-z0-9_-]{16,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{16,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\btskey-[A-Za-z0-9-]{10,}/g,
  /\bnpm_[A-Za-z0-9]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];

/** `Authorization: Bearer x`, `token=x`, `"apiKey": "x"`, `PASSWORD=x` and the like. */
const ASSIGNMENT =
  /\b((?:authorization|bearer|api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|secret|client[_-]?secret|password|passwd|pwd)["']?\s*[:=]\s*(?:bearer\s+)?["']?)([^\s"',;]{6,})/gi;
const BEARER = /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{12,})/g;
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const TAILNET = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net\b/gi;
const HOME_PATHS: readonly RegExp[] = [
  /(^|[\s"'`(=:])\/home\/[^/\s"'`]+/g,
  /(^|[\s"'`(=:])\/Users\/[^/\s"'`]+/g,
  /(^|[\s"'`(=:])[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\\\s"'`]+/gi,
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactText(input: string, options: RedactOptions = {}): RedactionResult {
  const counts: Record<RedactionKind, number> = { secret: 0, email: 0, path: 0, ip: 0, host: 0 };
  let text = input;
  /** `replace` returns null to leave a match as it is (and uncounted). */
  const swap = (
    pattern: RegExp,
    kind: RedactionKind,
    replace: (...m: string[]) => string | null,
  ) => {
    text = text.replace(pattern, (...match: string[]) => {
      const next = replace(...match);
      if (next === null) return match[0]!;
      counts[kind] += 1;
      return next;
    });
  };

  for (const pattern of SECRET_PATTERNS) swap(pattern, "secret", () => SECRET);
  swap(URL_CREDENTIALS, "secret", (_m, scheme) => `${scheme}${SECRET}@`);
  swap(BEARER, "secret", (_m, prefix) => `${prefix}${SECRET}`);
  swap(ASSIGNMENT, "secret", (_m, key, value) =>
    value!.includes("[REDACTED_") ? null : `${key}${SECRET}`,
  );

  swap(EMAIL, "email", () => "[REDACTED_EMAIL]");

  const homes = [...new Set((options.homeDirs ?? []).map((h) => h.replace(/[\\/]+$/, "")))]
    .filter((h) => h.length > 1)
    .sort((a, b) => b.length - a.length);
  for (const home of homes) swap(new RegExp(escapeRegExp(home), "g"), "path", () => "~");
  for (const pattern of HOME_PATHS) swap(pattern, "path", (_m, lead) => `${lead}~`);
  for (const name of options.userNames ?? []) {
    if (name.length < 2) continue;
    swap(new RegExp(`(?<=[\\\\/])${escapeRegExp(name)}(?=[\\\\/]|$)`, "g"), "path", () => "<user>");
  }

  swap(TAILNET, "host", () => "[REDACTED_HOST]");
  // Loopback and wildcard binds are not identifying.
  swap(IPV4, "ip", (m) => (m === "127.0.0.1" || m === "0.0.0.0" ? null : "[REDACTED_IP]"));
  return { text, counts };
}

export function redactionTotal(result: RedactionResult): number {
  return Object.values(result.counts).reduce((sum, n) => sum + n, 0);
}
