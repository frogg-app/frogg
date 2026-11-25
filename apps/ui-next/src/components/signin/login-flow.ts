/**
 * Headless sign-in commands, run by the daemon in a hidden terminal under the account's config
 * directory. Each prints a URL (and a code or a code prompt) instead of opening a TUI, so the app
 * can show them. Providers not listed fall back to the daemon's own interactive login command.
 */
export const LOGIN_COMMANDS: Partial<Record<string, { command: string; args: string[] }>> = {
  // Prints an authorize URL, then waits at "Paste code here if prompted >".
  claude: { command: "claude", args: ["auth", "login"] },
  // Device-code flow: a URL plus a one-time code; it polls until the browser finishes.
  codex: { command: "codex", args: ["login", "--device-auth"] },
};

export interface LoginState {
  url: string | null;
  /** A one-time code the user types into the provider's page (device flow). */
  userCode: string | null;
  /** The CLI waits for the code the provider's page shows after sign-in. */
  wantsCode: boolean;
  done: boolean;
  error: string | null;
}

/** Drops OSC (hyperlinks, titles) and CSI sequences; keeps the visible text. */
// Terminal escape sequences are control characters by definition.
// oxlint-disable-next-line no-control-regex
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// oxlint-disable-next-line no-control-regex
const CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
// oxlint-disable-next-line no-control-regex
const ESC = /\x1b[@-Z\\-_]/g;

export function stripAnsi(raw: string): string {
  return raw.replace(OSC, "").replace(CSI, "").replace(ESC, "").replace(/\r\n?/g, "\n");
}

const URL_RE = /https:\/\/[^\s"'<>]+/g;
const DEVICE_CODE = /\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/;
const SUCCESS =
  /login successful|successfully logged in|logged in (?:as|successfully)|signed in as/i;
// Claude prints "Couldn't log in: <reason>" on stderr when the code exchange fails, then exits.
const FAILURE =
  /^.*(?:login failed|oauth error|invalid code|couldn['\u2019]t log in|error:)[^\n]*$/im;

/** Reads the sign-in state out of everything the login command has printed so far. */
export function parseLogin(raw: string): LoginState {
  const text = stripAnsi(raw);
  const urls = text.match(URL_RE) ?? [];
  const url = urls.find((u) => /oauth|authorize|device|login|auth\./i.test(u)) ?? urls[0] ?? null;
  const afterCodePrompt = /one-time code/i.exec(text);
  const userCode = afterCodePrompt
    ? (DEVICE_CODE.exec(text.slice(afterCodePrompt.index))?.[0] ?? null)
    : null;
  const done = SUCCESS.test(text);
  const failure = done ? null : (FAILURE.exec(text)?.[0].trim() ?? null);
  return {
    url,
    userCode,
    wantsCode: !done && !failure && /paste (?:the )?code/i.test(text),
    done,
    error: failure,
  };
}

/** How long the app waits for the provider to answer a submitted code before giving up. */
export const CODE_CHECK_TIMEOUT_MS = 90_000;

/** The last non-empty line the CLI printed, to explain an exit the parser did not recognise. */
export function lastLine(raw: string): string | null {
  const lines = stripAnsi(raw)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.at(-1) ?? null;
}

/**
 * Decides how a sign-in ends once the login command has exited (or vanished while the app was
 * away). The CLI's own success line wins; otherwise a credential that appeared during this
 * sign-in proves it, and anything else is a failure with the CLI's last words as the reason.
 */
export function settleOnExit(input: {
  raw: string;
  wasSignedIn: boolean;
  authenticatedNow: boolean;
}): { done: true } | { done: false; error: string } {
  const parsed = parseLogin(input.raw);
  if (parsed.done) return { done: true };
  if (parsed.error) return { done: false, error: parsed.error };
  if (input.authenticatedNow && !input.wasSignedIn) return { done: true };
  const why = lastLine(input.raw);
  return {
    done: false,
    error: why
      ? `The sign-in ended without confirming: ${why}`
      : "The sign-in ended without confirming. Try again.",
  };
}
