import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getHostClient } from "../../daemon/store";
import { LOGIN_COMMANDS, parseLogin, type LoginState } from "./login-flow";
import type { SignInTarget } from "./store";

type Account = Awaited<ReturnType<DaemonClient["listProviderAccounts"]>>["accounts"][number];

export type Phase = "starting" | "confirm" | "waiting" | "done" | "failed";

export interface LoginSession {
  phase: Phase;
  account: Account | null;
  state: LoginState;
  /** Whether this provider has a headless flow; otherwise the CLI's own prompt is shown raw. */
  headless: boolean;
  /** Last lines the login command printed, for providers without a headless flow. */
  tail: string;
  error: string | null;
  sendCode: (code: string) => void;
  /** Starts the login after the user confirms replacing a working sign-in. */
  confirm: () => void;
}

const EMPTY: LoginState = { url: null, userCode: null, wantsCode: false, done: false, error: null };
// Wide enough that the CLI never wraps its authorize URL.
const SIZE = { rows: 40, cols: 2000 };
const POLL_MS = 2000;

function pickAccount(accounts: Account[], t: SignInTarget): Account | null {
  const mine = accounts.filter((a) => a.provider === t.provider);
  return (
    (t.accountId ? mine.find((a) => a.id === t.accountId) : undefined) ??
    (t.accountName ? mine.find((a) => a.name === t.accountName) : undefined) ??
    mine.find((a) => a.isActive) ??
    mine[0] ??
    null
  );
}

/**
 * Runs the provider's sign-in on the host in a hidden terminal under the account's config
 * directory, reads the URL and code out of its output, and kills it when the dialog closes.
 */
export function useLoginSession(target: SignInTarget): LoginSession {
  const [phase, setPhase] = useState<Phase>("starting");
  const [account, setAccount] = useState<Account | null>(null);
  const [state, setState] = useState<LoginState>(EMPTY);
  const [tail, setTail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const term = useRef<{ client: DaemonClient; id: string } | null>(null);
  const headless = Boolean(LOGIN_COMMANDS[target.provider]);

  useEffect(() => {
    let live = true;
    let off: (() => void) | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const fail = (msg: string) => {
      if (!live) return;
      setError(msg);
      setPhase("failed");
    };
    const run = async () => {
      const client = getHostClient(target.hostId);
      if (!client) return fail("Host offline. Reconnect and try again.");
      const list = await client.listProviderAccounts({ provider: target.provider as never });
      const acct = pickAccount(list.accounts, target);
      if (!live) return;
      if (!acct)
        return fail("This provider has no sign-in accounts on this host. Turn accounts on first.");
      setAccount(acct);
      const wasSignedIn = acct.authenticated;
      // Starting a provider's login can drop the account's current credential before the new
      // one exists (Codex clears auth.json at once), so a signed-in account waits for consent.
      if (wasSignedIn && !confirmed) {
        setPhase("confirm");
        return;
      }
      setPhase("starting");
      // Sign-in only uses the account's env, so it runs in the account's own config directory;
      // the daemon files it outside every workspace.
      const cmd = LOGIN_COMMANDS[target.provider];
      const res = await client.createTerminal(acct.configDir, `Sign in · ${acct.name}`, undefined, {
        providerAccountId: acct.id,
        size: SIZE,
        ...(cmd ? { command: cmd.command, args: cmd.args } : {}),
      });
      if (!res.terminal)
        return fail(
          res.error === "workspaceId is required"
            ? "This host's daemon is too old to sign in from the app. Update it first."
            : (res.error ?? "The host could not start the sign-in."),
        );
      const id = res.terminal.id;
      term.current = { client, id };
      if (!live) {
        void client.killTerminal(id).catch(() => undefined);
        return;
      }
      setPhase("waiting");
      const decoder = new TextDecoder();
      let raw = "";
      off = client.onTerminalStreamEvent((e) => {
        if (e.terminalId !== id || e.type === "snapshot") return;
        raw = e.type === "restore" ? decoder.decode(e.data) : raw + decoder.decode(e.data);
        const next = parseLogin(raw);
        setState(next);
        setTail(raw.slice(-2000));
        if (next.done) setPhase("done");
      });
      await client.subscribeTerminal(id, { restore: { mode: "full-snapshot", size: SIZE } });
      // A signed-out account that turns signed-in is done even if the CLI said nothing we know.
      const check = async () => {
        const r = await client.listProviderAccounts({ provider: target.provider as never });
        const now = r.accounts.find((a) => a.id === acct.id);
        if (live && now?.authenticated && !wasSignedIn) setPhase("done");
      };
      if (!wasSignedIn) poll = setInterval(() => void check().catch(() => undefined), POLL_MS);
    };
    run().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
      off?.();
      if (poll) clearInterval(poll);
      const t = term.current;
      term.current = null;
      if (t) {
        t.client.unsubscribeTerminal(t.id);
        void t.client.killTerminal(t.id).catch(() => undefined);
      }
    };
  }, [target, confirmed]);

  const sendCode = useCallback((code: string) => {
    const t = term.current;
    if (t) t.client.sendTerminalInput(t.id, { type: "input", data: `${code.trim()}\r` });
  }, []);

  const confirm = useCallback(() => setConfirmed(true), []);

  return { phase, account, state, headless, tail, error, sendCode, confirm };
}
