import { execFile } from "node:child_process";

import { parseTailscaleStatus, type TailscaleNodeStatus } from "@frogg/protocol/tailscale";

/**
 * The daemon machine's Tailscale node, read with `tailscale status --json` and cached. Absent
 * (null) when Tailscale is not installed or not answering, which is most hosts; checked again
 * every hour so a re-login or a new expiry shows up without a daemon restart.
 */
const REFRESH_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 5000;

export type RunTailscale = () => Promise<string>;

const CANDIDATES: Record<string, string[]> = {
  darwin: ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"],
  win32: ["tailscale", "C:\\Program Files\\Tailscale\\tailscale.exe"],
};

export function defaultRunTailscale(platform: NodeJS.Platform = process.platform): RunTailscale {
  const binaries = CANDIDATES[platform] ?? ["tailscale"];
  return async () => {
    let lastError: unknown = null;
    for (const bin of binaries) {
      try {
        return await new Promise<string>((resolve, reject) => {
          execFile(
            bin,
            ["status", "--json"],
            { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
            (error, stdout) => {
              if (error && !stdout) reject(error);
              else resolve(stdout);
            },
          );
        });
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error("tailscale not found");
  };
}

export interface TailscaleMonitor {
  get(): TailscaleNodeStatus | null;
  refresh(): Promise<TailscaleNodeStatus | null>;
  start(onChange?: (status: TailscaleNodeStatus | null) => void): void;
  stop(): void;
}

export function createTailscaleMonitor(
  run: RunTailscale = defaultRunTailscale(),
): TailscaleMonitor {
  let current: TailscaleNodeStatus | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let listener: ((status: TailscaleNodeStatus | null) => void) | undefined;
  const refresh = async () => {
    let next: TailscaleNodeStatus | null = null;
    try {
      next = parseTailscaleStatus(JSON.parse(await run()));
    } catch {
      next = null;
    }
    const changed = JSON.stringify(next) !== JSON.stringify(current);
    current = next;
    if (changed) listener?.(current);
    return current;
  };
  return {
    get: () => current,
    refresh,
    start(onChange) {
      listener = onChange;
      void refresh();
      timer = setInterval(() => void refresh(), REFRESH_MS);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
