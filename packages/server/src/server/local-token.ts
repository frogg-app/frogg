import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { ensurePrivateFile, writePrivateFileAtomicSync } from "./private-files.js";

/**
 * A 0600 token file under `$FROGG_HOME` proving the caller can read the
 * daemon's own home directory — the same thing "is on this machine as this
 * user" is supposed to mean. Loopback alone does not prove it: any process or
 * container sharing the loopback interface reaches the daemon, and a request
 * with no remote address at all (unix socket, named pipe) used to be trusted
 * unconditionally.
 *
 * The local CLI and the desktop shell read this file and send it as a bearer,
 * which is what lets privileged local routes require a real credential.
 */
export const LOCAL_TOKEN_FILENAME = "local-token";

export interface LocalTokenFile {
  readonly filePath: string;
  /** Creates the token on first call; returns the existing one afterwards. */
  ensure(): string;
  read(): string | null;
  /** Constant-time comparison against the token on disk. */
  matches(token: string | null | undefined): boolean;
}

export function createLocalTokenFile(froggHome: string): LocalTokenFile {
  const filePath = path.join(froggHome, LOCAL_TOKEN_FILENAME);

  function read(): string | null {
    if (!existsSync(filePath)) return null;
    try {
      ensurePrivateFile(filePath);
      const value = readFileSync(filePath, "utf8").trim();
      return value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }

  return {
    filePath,
    read,
    ensure: () => {
      const existing = read();
      if (existing) return existing;
      const token = `flt1.${randomBytes(32).toString("base64url")}`;
      writePrivateFileAtomicSync(filePath, `${token}\n`);
      return token;
    },
    matches: (token) => {
      if (!token) return false;
      const expected = read();
      if (!expected) return false;
      const a = Buffer.from(expected, "utf8");
      const b = Buffer.from(token, "utf8");
      return a.length === b.length && timingSafeEqual(a, b);
    },
  };
}

/** Reads the token without creating one — for clients (CLI, desktop). */
export function readLocalToken(froggHome: string): string | null {
  return createLocalTokenFile(froggHome).read();
}
