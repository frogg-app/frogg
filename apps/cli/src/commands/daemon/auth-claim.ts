import { brand } from "@frogg/branding";
import type { Command } from "commander";
import type { DeviceClaimResponse } from "@frogg/protocol/device-access";

import type {
  CommandError,
  CommandOptions,
  OutputOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";
import { readCliLocalToken } from "../../utils/local-token.js";
import { DaemonHttpError, daemonHttpJson, resolveLoopbackHttpBase } from "./daemon-http.js";
import { resolveLocalDaemonState, resolveLocalFroggHome } from "./local-daemon.js";

/**
 * `frogg auth claim`: claim an unclaimed daemon in claim mode from the host
 * itself. POSTs `{ claim: true }` to `/api/setup/claim` over loopback with the
 * daemon's local token as bearer, which satisfies `claimScope: local` and is
 * harmless under `any`. The minted owner credential is printed once; the daemon
 * keeps only its hash.
 */
export interface AuthClaimResult extends DeviceClaimResponse {
  home: string;
}

export interface AuthClaimOptions {
  home?: string;
  deviceName?: string;
  /** Test seam: the daemon's listen target, instead of the pid file / config. */
  listen?: string;
}

const DEFAULT_CLAIM_DEVICE_NAME = `${brand.cliName} CLI`;
const CLAIM_TIMEOUT_MS = 5000;

function commandError(code: string, message: string): CommandError {
  return { code, message };
}

const authClaimSchema: OutputSchema<AuthClaimResult> = {
  idField: "principalId",
  columns: [
    { header: "ROLE", field: "role" },
    { header: "DEVICE", field: "deviceName" },
    { header: "PRINCIPAL", field: "principalId" },
    { header: "CREDENTIAL", field: "credential" },
  ],
  renderHuman: (result, options: OutputOptions) => {
    const data = result.data as AuthClaimResult;
    if (options.format !== "table") return JSON.stringify(data);
    return [
      `Claimed this daemon as ${data.role} "${data.deviceName}" (${data.principalId}).`,
      `Credential (shown once; store it now): ${data.credential}`,
      ...(data.fingerprint ? [`Daemon fingerprint: ${data.fingerprint}`] : []),
      `Pair other devices with \`${brand.cliName} auth pair\`.`,
    ].join("\n");
  },
};

export async function claimLocalDaemon(options: AuthClaimOptions = {}): Promise<AuthClaimResult> {
  const home = resolveLocalFroggHome(options.home);
  let listen = options.listen;
  if (listen === undefined) {
    const state = resolveLocalDaemonState({ home });
    if (!state.running) {
      throw commandError(
        "DAEMON_NOT_RUNNING",
        `No daemon is running for ${home}. Start it with \`${brand.cliName} start\` and retry.`,
      );
    }
    listen = state.listen;
  }
  const base = resolveLoopbackHttpBase(listen);
  if (!base) {
    throw commandError(
      "DAEMON_NOT_TCP",
      `The daemon listens on ${listen}, which has no HTTP endpoint to claim over.`,
    );
  }
  const token = readCliLocalToken(home);
  try {
    const claimed = await daemonHttpJson<DeviceClaimResponse>({
      base,
      path: "/api/setup/claim",
      method: "POST",
      body: {
        claim: true,
        deviceName: options.deviceName ?? DEFAULT_CLAIM_DEVICE_NAME,
      },
      ...(token ? { bearer: token } : {}),
      timeoutMs: CLAIM_TIMEOUT_MS,
    });
    return { ...claimed, home };
  } catch (error) {
    throw toClaimError(error, base, token !== null);
  }
}

function toClaimError(error: unknown, base: string, hadToken: boolean): CommandError {
  if (!(error instanceof DaemonHttpError)) {
    return commandError(
      "DAEMON_UNREACHABLE",
      `Could not reach the daemon at ${base}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const detail = error.detail ?? "";
  if (error.status === 409 && /already been claimed/i.test(detail)) {
    return commandError(
      "ALREADY_CLAIMED",
      `This daemon is already claimed. Pair another device with \`${brand.cliName} auth pair\`, or clear owners with \`${brand.cliName} auth reset-claim\`.`,
    );
  }
  if (error.status === 409) {
    return commandError(
      "NOT_IN_CLAIM_MODE",
      `This daemon is not in claim mode. Turn it on with \`${brand.cliName} auth claim-mode on\`, or pair with \`${brand.cliName} auth pair\`.`,
    );
  }
  if (error.status === 403) {
    return commandError(
      "CLAIM_REFUSED",
      hadToken
        ? `The daemon refused the claim: ${
            detail || "forbidden"
          }. Check --home points at the running daemon's home.`
        : `The daemon refused the claim: ${
            detail || "forbidden"
          }. The CLI could not read the daemon's local-token; run as the user that owns the daemon home, or pass --home.`,
    );
  }
  if (error.status === 429) {
    return commandError("CLAIM_RATE_LIMITED", "Too many failed attempts; wait and retry.");
  }
  return commandError(
    "CLAIM_FAILED",
    `The daemon rejected the claim (HTTP ${error.status})${detail ? `: ${detail}` : ""}.`,
  );
}

export async function runAuthClaimCommand(
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<AuthClaimResult>> {
  const data = await claimLocalDaemon({
    home: typeof options.home === "string" ? options.home : undefined,
    deviceName: typeof options.deviceName === "string" ? options.deviceName : undefined,
  });
  return { type: "single", data, schema: authClaimSchema };
}
