import { spawnSync } from "node:child_process";

import { WINDOWS_RUN_KEY, WINDOWS_RUN_VALUE, windowsRunCommand } from "./plan.js";

/**
 * Installs from before the headless launcher wrote the Run value as just the quoted `.cmd`
 * path, which opens a console window at every login. Re-running `install-service` fixes it,
 * but nobody does that after an update, so `daemon start` and the self-updater upgrade an
 * outdated value in place. Only a value that is exactly a bare launcher path is rewritten: a
 * current value, a missing one, or anything the user edited by hand is left alone.
 */
export interface RunKeyDeps {
  run(command: string, args: string[]): { status: number | null; stdout: string };
}

export type RunKeyOutcome = "upgraded" | "current" | "absent" | "custom" | "failed";

const defaultDeps: RunKeyDeps = {
  run: (command, args) => {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    return { status: result.error ? null : result.status, stdout: result.stdout ?? "" };
  },
};

/** The data of `value` from `reg query <key> /v <value>` output, or null when it is not there. */
export function parseRegQueryValue(output: string, value: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s+(\S+)\s+REG_(?:EXPAND_)?SZ\s+(.*?)\s*$/.exec(line);
    if (match && match[1]!.toLowerCase() === value.toLowerCase()) return match[2]!;
  }
  return null;
}

/** The launcher path when `data` is the pre-headless form (`"C:\...\frogg.cmd"`), else null. */
export function legacyLauncherPath(data: string): string | null {
  const match = /^"?([^"]+\.cmd)"?$/i.exec(data.trim());
  return match ? match[1]! : null;
}

export function upgradeWindowsRunKey(
  platform: NodeJS.Platform = process.platform,
  deps: RunKeyDeps = defaultDeps,
): RunKeyOutcome {
  if (platform !== "win32") return "absent";
  try {
    const query = deps.run("reg", ["query", WINDOWS_RUN_KEY, "/v", WINDOWS_RUN_VALUE]);
    if (query.status !== 0) return "absent";
    const data = parseRegQueryValue(query.stdout, WINDOWS_RUN_VALUE);
    if (data === null) return "absent";
    const launcher = legacyLauncherPath(data);
    if (!launcher) return data.startsWith("conhost.exe --headless") ? "current" : "custom";
    const add = deps.run("reg", [
      "add",
      WINDOWS_RUN_KEY,
      "/v",
      WINDOWS_RUN_VALUE,
      "/t",
      "REG_SZ",
      "/d",
      windowsRunCommand(launcher),
      "/f",
    ]);
    return add.status === 0 ? "upgraded" : "failed";
  } catch {
    // Best effort: a login start must never fail because the registry was unreadable.
    return "failed";
  }
}
