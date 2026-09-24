import { readFileSync } from "node:fs";
import path from "node:path";

import { normalizeListenTargetForConnect } from "../commands/daemon/listen-target.js";
import { resolveFroggHomePath } from "./frogg-home.js";

/**
 * The daemon writes a 0600 `local-token` into its home on start
 * (`packages/server/src/server/local-token.ts`). Reading it proves the caller
 * shares the daemon's user, so the CLI sends it as the bearer for a local
 * daemon when no password is configured.
 */
export const LOCAL_TOKEN_FILENAME = "local-token";

/** Reads `<home>/local-token` without creating it; `null` when absent or unreadable. */
export function readCliLocalToken(
  home?: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const froggHome = home ?? resolveFroggHomePath(env);
  try {
    const value = readFileSync(path.join(froggHome, LOCAL_TOKEN_FILENAME), "utf8").trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * True for a daemon target on this machine: a unix socket, named pipe, or a
 * TCP endpoint on loopback (wildcard binds count, since they are reached via
 * loopback). The local token is never sent anywhere else.
 */
export function isLocalDaemonHost(host: string): boolean {
  const normalized = normalizeListenTargetForConnect(host);
  if (!normalized) return false;
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("unix://") ||
    normalized.startsWith("pipe://") ||
    normalized.startsWith("\\\\.\\pipe\\") ||
    /^[A-Za-z]:[/\\]/.test(normalized)
  ) {
    return true;
  }
  const address = normalized.replace(/^tcp:\/\//, "").split(/[?/]/)[0] ?? "";
  const withoutUserinfo = address.slice(address.lastIndexOf("@") + 1);
  const lastColon = withoutUserinfo.lastIndexOf(":");
  const rawHost = (lastColon === -1 ? withoutUserinfo : withoutUserinfo.slice(0, lastColon))
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  return LOOPBACK_HOSTS.has(rawHost) || /^127\.\d+\.\d+\.\d+$/.test(rawHost);
}
