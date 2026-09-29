import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

/** Whether the login keychain holds a generic password under `service`. */
export type KeychainProbe = (service: string) => boolean;

const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";

/**
 * The keychain services Claude Code may have stored an account's OAuth sign-in
 * under. On macOS it never writes `.credentials.json`; it writes a keychain item
 * named `Claude Code-credentials`, suffixed with the first 8 hex chars of
 * sha256(CLAUDE_CONFIG_DIR) whenever that variable is set. The primary `~/.claude`
 * directory is checked under both names: it runs with the variable unset unless
 * its account was explicitly made active, in which case the variable is set to it.
 */
export function claudeKeychainServices(configDir: string): string[] {
  const suffix = createHash("sha256").update(configDir).digest("hex").slice(0, 8);
  const services = [`${CLAUDE_KEYCHAIN_SERVICE}-${suffix}`];
  if (configDir === path.join(os.homedir(), ".claude")) {
    services.push(CLAUDE_KEYCHAIN_SERVICE);
  }
  return services;
}

/**
 * Looks the item up without reading its secret (no `-w`/`-g`), so it never
 * triggers a keychain access prompt. Off macOS there is no keychain to consult.
 */
export const systemKeychainProbe: KeychainProbe = (service) => {
  if (process.platform !== "darwin") return false;
  try {
    execFileSync("security", ["find-generic-password", "-s", service], {
      stdio: "ignore",
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
};
