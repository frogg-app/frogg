import { brand } from "@frogg/branding";
import path from "node:path";
import type { Command } from "commander";
import { loadPersistedConfig, savePersistedConfig, type PersistedConfig } from "@frogg/server";

import type {
  CommandError,
  CommandOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";
import { connectToDaemon } from "../../utils/client.js";
import { resolveLocalDaemonState, resolveLocalFroggHome } from "./local-daemon.js";

/**
 * `<cli> daemon claim-mode [on|off]`: claim mode means the LAN is not trusted
 * and the first client to claim an unclaimed daemon becomes its owner
 * (self-hosting/security.mdx). With no argument it reports the mode that
 * applies; with one it writes `daemon.auth.claimMode` to config.json and asks a
 * running daemon to reload, so the change applies live.
 *
 * This is the recovery path when claim mode locks everyone out, so it must work
 * from a local shell with no device credential: it edits config.json directly,
 * and the live reload runs over loopback, which is trusted regardless of claim
 * mode.
 */
const CONFIG_FILENAME = "config.json";
const CLAIM_MODE_PATH = "daemon.auth.claimMode";
const CLAIM_MODE_ENV = `${brand.envPrefix}_CLAIM_MODE`;
const LIVE_RELOAD_TIMEOUT_MS = 3000;

export type ClaimModeMode = "on" | "off";

export type ClaimModeApplied =
  | { status: "live" }
  | { status: "restart_required"; reason: string }
  | { status: "env_override" };

/** Where the mode that applies came from, so the report can explain itself. */
export type ClaimModeSource = "env" | "config" | "brand";

export interface ClaimModeResult {
  action: "claim_mode_set" | "claim_mode_read";
  claimMode: boolean;
  source: ClaimModeSource;
  configPath: string;
  applied?: ClaimModeApplied;
  message: string;
}

export interface ClaimModeOptions {
  home?: string;
  env?: NodeJS.ProcessEnv;
  /** Live apply through the daemon's config reload; injectable for tests. */
  reloadLive?: (listen: string) => Promise<ClaimModeApplied>;
}

function createCommandError(code: string, message: string): CommandError {
  return { code, message };
}

export function parseClaimModeMode(value: unknown): ClaimModeMode {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["on", "true", "1", "yes"].includes(normalized)) return "on";
  if (["off", "false", "0", "no"].includes(normalized)) return "off";
  throw createCommandError(
    "CLAIM_MODE_INVALID",
    `Expected "on" or "off", got ${JSON.stringify(value)}`,
  );
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

/** The same precedence the daemon uses: environment, then config.json, then the brand. */
export function resolveClaimMode(input: { home?: string; env?: NodeJS.ProcessEnv }): {
  claimMode: boolean;
  source: ClaimModeSource;
} {
  const fromEnv = parseBooleanEnv((input.env ?? process.env)[CLAIM_MODE_ENV]);
  if (fromEnv !== undefined) return { claimMode: fromEnv, source: "env" };
  const persisted = loadPersistedConfig(resolveLocalFroggHome(input.home)).daemon?.auth?.claimMode;
  if (persisted !== undefined) return { claimMode: persisted, source: "config" };
  return { claimMode: brand.daemon.claimMode, source: "brand" };
}

async function reloadDaemonLive(listen: string): Promise<ClaimModeApplied> {
  let client: Awaited<ReturnType<typeof connectToDaemon>>;
  try {
    client = await connectToDaemon({ host: listen, timeout: LIVE_RELOAD_TIMEOUT_MS });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { status: "restart_required", reason: `could not reach the daemon (${detail})` };
  }
  try {
    const reload = await client.reloadDaemonConfig();
    if (reload.overrideControlledPaths.includes(CLAIM_MODE_PATH)) return { status: "env_override" };
    if (reload.restartRequiredPaths.includes(CLAIM_MODE_PATH)) {
      return { status: "restart_required", reason: "this daemon cannot reload the setting" };
    }
    return { status: "live" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { status: "restart_required", reason: `config reload failed (${detail})` };
  } finally {
    await client.close().catch(() => {});
  }
}

function describeMode(claimMode: boolean): string {
  return claimMode
    ? "Claim mode on: your private network is not trusted, and the first client to claim this unclaimed daemon becomes its owner."
    : "Claim mode off: clients connect under the trusted-LAN, pairing and password rules alone.";
}

function describeApplied(claimMode: boolean, applied: ClaimModeApplied): string {
  switch (applied.status) {
    case "live":
      return `${describeMode(claimMode)}\nApplied to the running daemon.`;
    case "env_override":
      return `${describeMode(claimMode)}\nThe running daemon is controlled by ${CLAIM_MODE_ENV}; unset it and restart for config.json to take effect.`;
    case "restart_required":
      return `${describeMode(claimMode)}\nRestart the daemon for the change to take effect (${applied.reason}).\nRun: ${brand.cliName} daemon restart`;
  }
}

export async function setClaimModeInConfig(
  mode: ClaimModeMode,
  options: ClaimModeOptions = {},
): Promise<ClaimModeResult> {
  const froggHome = resolveLocalFroggHome(options.home);
  const configPath = path.join(froggHome, CONFIG_FILENAME);
  const claimMode = mode === "on";
  const persisted = loadPersistedConfig(froggHome);
  const nextConfig: PersistedConfig = {
    ...persisted,
    daemon: {
      ...persisted.daemon,
      auth: { ...persisted.daemon?.auth, claimMode },
    },
  };
  savePersistedConfig(froggHome, nextConfig);

  const state = resolveLocalDaemonState({ home: options.home });
  const applied: ClaimModeApplied = state.running
    ? await (options.reloadLive ?? reloadDaemonLive)(state.listen)
    : { status: "restart_required", reason: "the daemon is not running; it applies on next start" };

  return {
    action: "claim_mode_set",
    claimMode,
    source: "config",
    configPath,
    applied,
    message: `Claim mode ${claimMode ? "on" : "off"}: ${CLAIM_MODE_PATH}=${claimMode} written to ${configPath}\n${describeApplied(claimMode, applied)}`,
  };
}

export function readClaimModeFromConfig(options: ClaimModeOptions = {}): ClaimModeResult {
  const froggHome = resolveLocalFroggHome(options.home);
  const { claimMode, source } = resolveClaimMode({ home: options.home, env: options.env });
  const origin = {
    env: `${CLAIM_MODE_ENV} in this shell`,
    config: `${CLAIM_MODE_PATH} in ${path.join(froggHome, CONFIG_FILENAME)}`,
    brand: `the ${brand.name} default (nothing configured)`,
  }[source];
  return {
    action: "claim_mode_read",
    claimMode,
    source,
    configPath: path.join(froggHome, CONFIG_FILENAME),
    message: `Claim mode ${claimMode ? "on" : "off"}, from ${origin}.\n${describeMode(claimMode)}`,
  };
}

const claimModeResultSchema: OutputSchema<ClaimModeResult> = {
  idField: "action",
  columns: [
    { header: "CLAIM MODE", field: "claimMode" },
    { header: "SOURCE", field: "source" },
    { header: "CONFIG", field: "configPath" },
  ],
  renderHuman: (result) => (result.type === "single" ? result.data.message : ""),
};

export async function runClaimModeCommand(
  mode: string | undefined,
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<ClaimModeResult>> {
  const home = typeof options.home === "string" ? options.home : undefined;
  const data =
    mode === undefined
      ? readClaimModeFromConfig({ home })
      : await setClaimModeInConfig(parseClaimModeMode(mode), { home });
  return { type: "single", data, schema: claimModeResultSchema };
}
