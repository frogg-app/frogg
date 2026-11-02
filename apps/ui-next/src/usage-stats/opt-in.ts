import { loadConfig, patchConfig, useConfig } from "../daemon/config";
import { getClient } from "../daemon/store";
import { setUsageStatsConsent } from "./store";

/**
 * What turning on "Send usage statistics" did for the connected host. An owner's opt-in also
 * turns on that host's own statistics (`daemon.usageStats`); anyone else's leaves the host alone,
 * because only an owner may change its config. Turning statistics off in the app never touches a
 * host: its own toggle stays the way to change it.
 */
export type HostOptIn =
  /** The host's statistics were off and are now on. */
  | "enabled"
  /** Already on. */
  | "already"
  /** This device is not an owner of the host. */
  | "not_owner"
  /** The daemon predates `daemon.usageStats`, or no host is connected. */
  | "unsupported"
  /** The host refused or the request failed; its statistics stay off. */
  | "failed";

/** Pure decision: should an opt-in by a device with `role` turn on a host whose value is `current`? */
export function hostOptInAction(
  role: string | null | undefined,
  current: boolean | undefined,
): Exclude<HostOptIn, "enabled" | "failed"> | "enable" {
  if (current === undefined) return "unsupported";
  if (role !== "owner") return "not_owner";
  if (current) return "already";
  return "enable";
}

function callerRole(): string | null {
  const info = getClient()?.getLastServerInfoMessage() as { callerRole?: string } | null;
  return info?.callerRole ?? null;
}

/** Turns app statistics on, and the connected host's too when this device owns it. */
export async function optInToUsageStats(): Promise<HostOptIn> {
  setUsageStatsConsent(true);
  if (!getClient()) return "unsupported";
  if (!useConfig.getState().config) await loadConfig();
  const action = hostOptInAction(callerRole(), useConfig.getState().config?.usageStats);
  if (action !== "enable") return action;
  await patchConfig({ usageStats: true });
  return useConfig.getState().config?.usageStats === true ? "enabled" : "failed";
}
