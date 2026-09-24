import { brand } from "@frogg/branding";
import type { Command } from "commander";
import type { SecurityFinding, SecurityPosture } from "@frogg/protocol/messages";
import {
  createClaimStore,
  isDaemonClaimed,
  loadPersistedConfig,
  type DaemonIdentity,
} from "@frogg/server";

import type {
  CommandOptions,
  OutputOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";
import { daemonHttpJson, resolveLoopbackHttpBase } from "./daemon-http.js";
import { resolveLocalDaemonState, resolveLocalFroggHome } from "./local-daemon.js";
import { readCliLocalToken } from "../../utils/local-token.js";

/**
 * `frogg daemon claim-status` and `frogg daemon reset-claim`: inspect or clear the
 * paired principals under $FROGG_HOME (see getting-started/connect-and-pair.mdx).
 * claim-status asks the running daemon first (`/api/setup/status` with the
 * local token) so env-only settings such as <PREFIX>_PASSWORD are reflected,
 * and falls back to config.json when no daemon answers; `source` says which.
 * reset-claim works on the files directly; the daemon re-reads the principals
 * file on every check, so a reset takes effect live and the pairing page comes
 * back for LAN visitors.
 */
interface ClaimPrincipalSummary {
  id: string;
  label: string;
  createdAt: string;
  credentials: number;
}

export interface ClaimStatusResult {
  home: string;
  principalsPath: string;
  claimed: boolean;
  claimedAt: string | null;
  passwordConfigured: boolean;
  /** daemon.auth.trustLan: private-network clients connect without pairing or a password. */
  lanTrusted: boolean;
  principals: ClaimPrincipalSummary[];
  /** Where claimed / password / LAN trust came from: the live daemon, or config.json. */
  source: "daemon" | "config";
  /** Security findings from the running daemon; absent when read from config. */
  findings?: SecurityFinding[];
  daemon:
    | { reachable: true; listen: string | null; pairingRequired: boolean; connectedClients: number }
    | { reachable: false };
}

export interface ResetClaimResult {
  action: "claim_reset" | "not_claimed";
  home: string;
  principalsPath: string;
  removedPrincipals: number;
  message: string;
}

const claimStatusSchema: OutputSchema<ClaimStatusResult> = {
  idField: (result) => (result.claimed ? "claimed" : "unclaimed"),
  columns: [
    { header: "CLAIMED", field: (result) => (result.claimed ? "yes" : "no") },
    { header: "PRINCIPALS", field: (result) => String(result.principals.length) },
    { header: "PASSWORD", field: (result) => (result.passwordConfigured ? "yes" : "no") },
    { header: "HOME", field: "home" },
  ],
  renderHuman: (result, options: OutputOptions) => {
    const data = result.data as ClaimStatusResult;
    if (options.format !== "table") return JSON.stringify(data);
    const lines = [
      `Claimed:        ${data.claimed ? `yes (${data.claimedAt ?? "unknown time"})` : "no"}`,
      `Password:       ${data.passwordConfigured ? "configured" : "not configured"}`,
      `LAN trusted:    ${data.lanTrusted ? `yes (${brand.cliName} auth trust-lan off to require pairing on the LAN)` : "no"}`,
      `Source:         ${data.source === "daemon" ? "running daemon" : "config.json (daemon not reachable)"}`,
      `Principals:     ${data.principalsPath}`,
      `Daemon:         ${
        data.daemon.reachable
          ? `reachable at ${data.daemon.listen ?? "?"} (pairingRequired=${data.daemon.pairingRequired}, connectedClients=${data.daemon.connectedClients})`
          : "not reachable over HTTP"
      }`,
    ];
    for (const finding of data.findings ?? []) {
      lines.push(`Finding:        ${finding.id} (${finding.severity}; fix: ${finding.fixAction})`);
    }
    for (const principal of data.principals) {
      lines.push(
        `  - ${principal.label} (${principal.id}, ${principal.credentials} credential${principal.credentials === 1 ? "" : "s"}, ${principal.createdAt})`,
      );
    }
    return lines.join("\n");
  },
};

const resetClaimSchema: OutputSchema<ResetClaimResult> = {
  idField: "action",
  columns: [
    { header: "STATUS", field: "action", color: () => "green" },
    { header: "REMOVED", field: (result) => String(result.removedPrincipals) },
    { header: "PRINCIPALS", field: "principalsPath" },
  ],
  renderHuman: (result, options: OutputOptions) => {
    const data = result.data as ResetClaimResult;
    return options.format === "table" ? data.message : JSON.stringify(data);
  },
};

async function probeDaemonIdentity(listen: string): Promise<ClaimStatusResult["daemon"]> {
  const base = resolveLoopbackHttpBase(listen);
  if (!base) return { reachable: false };
  try {
    const identity = await daemonHttpJson<DaemonIdentity>({ base, path: "/api/identity" });
    return {
      reachable: true,
      listen: identity.listen,
      pairingRequired: identity.pairingRequired,
      connectedClients: identity.connectedClients,
    };
  } catch {
    return { reachable: false };
  }
}

interface OwnerSetupStatus {
  claimed: boolean;
  passwordEnabled?: boolean;
  trustLan?: boolean;
  posture?: SecurityPosture;
}

/**
 * The daemon's own view, authenticated with the local token. Only a response
 * carrying `posture` counts: an older daemon, or one that rejected the token,
 * answers with the public shape and the caller falls back to config.json.
 */
async function probeOwnerSetupStatus(
  listen: string,
  froggHome: string,
): Promise<Required<OwnerSetupStatus> | null> {
  const base = resolveLoopbackHttpBase(listen);
  const token = readCliLocalToken(froggHome);
  if (!base || !token) return null;
  try {
    const status = await daemonHttpJson<OwnerSetupStatus>({
      base,
      path: "/api/setup/status",
      bearer: token,
    });
    if (!status.posture || status.passwordEnabled === undefined || status.trustLan === undefined) {
      return null;
    }
    return status as Required<OwnerSetupStatus>;
  } catch {
    return null;
  }
}

export async function describeClaimStatus(home?: string): Promise<ClaimStatusResult> {
  const froggHome = resolveLocalFroggHome(home);
  const store = createClaimStore(froggHome);
  const file = store.read();
  const persistedAuth = loadPersistedConfig(froggHome).daemon?.auth;
  const passwordConfigured = Boolean(persistedAuth?.password);
  const lanTrusted = persistedAuth?.trustLan ?? brand.daemon.trustLan;
  // Same rule as the daemon's /api/setup/status: a set password claims it too.
  const claimed = isDaemonClaimed(store, persistedAuth?.password);
  const state = resolveLocalDaemonState({ home });
  const live = state.running ? await probeOwnerSetupStatus(state.listen, froggHome) : null;
  return {
    home: froggHome,
    principalsPath: store.filePath,
    claimed: live?.claimed ?? claimed,
    claimedAt: file.claimedAt ?? null,
    passwordConfigured: live?.passwordEnabled ?? passwordConfigured,
    lanTrusted: live?.trustLan ?? lanTrusted,
    source: live ? "daemon" : "config",
    ...(live ? { findings: live.posture.findings } : {}),
    principals: file.principals.map((principal) => ({
      id: principal.id,
      label: principal.label,
      createdAt: principal.createdAt,
      credentials: principal.credentials.length,
    })),
    daemon: state.running ? await probeDaemonIdentity(state.listen) : { reachable: false },
  };
}

export function resetClaim(home?: string): ResetClaimResult {
  const froggHome = resolveLocalFroggHome(home);
  const store = createClaimStore(froggHome);
  const removedPrincipals = store.read().principals.length;
  const existed = store.reset();
  return {
    action: existed ? "claim_reset" : "not_claimed",
    home: froggHome,
    principalsPath: store.filePath,
    removedPrincipals,
    message: existed
      ? `Removed ${removedPrincipals} paired principal${removedPrincipals === 1 ? "" : "s"} (${store.filePath}). Paired devices lose access; the next LAN visitor sees the pairing page.`
      : `Nothing to reset: no paired principals at ${store.filePath}.`,
  };
}

export async function runClaimStatusCommand(
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<ClaimStatusResult>> {
  const home = typeof options.home === "string" ? options.home : undefined;
  return { type: "single", data: await describeClaimStatus(home), schema: claimStatusSchema };
}

export async function runResetClaimCommand(
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<ResetClaimResult>> {
  const home = typeof options.home === "string" ? options.home : undefined;
  return { type: "single", data: resetClaim(home), schema: resetClaimSchema };
}
