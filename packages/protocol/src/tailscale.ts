import { z } from "zod";

/**
 * Tailscale awareness for hosts: the daemon reports its own node (from `tailscale status --json`)
 * on server_info, and the app works out from the address it dialled whether the connection runs
 * over the tailnet. Together they let the host view warn before the daemon host's node key
 * expires, which would silently cut the connection until someone logs that machine in again.
 */
export const TailscaleNodeStatusSchema = z.object({
  /** `Running` backend and logged in. */
  online: z.boolean(),
  /** MagicDNS name of the daemon's machine, without the trailing dot. */
  dnsName: z.string().optional(),
  /** ISO time the node key expires; null when key expiry is disabled for this machine. */
  keyExpiry: z.string().nullable(),
});
export type TailscaleNodeStatus = z.infer<typeof TailscaleNodeStatusSchema>;

/** Warn this many days before expiry; urgent inside the last few. */
export const KEY_EXPIRY_WARN_DAYS = 14;
export const KEY_EXPIRY_URGENT_DAYS = 3;

function stripPort(endpoint: string): string {
  const trimmed = endpoint
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/\/.*$/, "");
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(trimmed);
  if (bracketed) return bracketed[1]!.toLowerCase();
  // A bare IPv6 address has several colons; only strip a port from host:port.
  if ((trimmed.match(/:/g) ?? []).length === 1) return trimmed.split(":")[0]!.toLowerCase();
  return trimmed.toLowerCase();
}

/**
 * True when an address is on a tailnet: a MagicDNS `*.ts.net` name, an IPv4 address in Tailscale's
 * 100.64.0.0/10 range, or an IPv6 address in fd7a:115c:a1e0::/48.
 */
export function isTailnetAddress(endpoint: string): boolean {
  const host = stripPort(endpoint);
  if (/(^|\.)ts\.net\.?$/.test(host)) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return a === 100 && b >= 64 && b <= 127;
  }
  return host.startsWith("fd7a:115c:a1e0:");
}

export type KeyExpiryLevel = "none" | "ok" | "soon" | "urgent" | "expired";

export interface KeyExpiryState {
  level: KeyExpiryLevel;
  /** Whole days left (0 on the last day); null when the key does not expire. */
  daysLeft: number | null;
  expiresAt: string | null;
}

export function keyExpiryState(
  status: Pick<TailscaleNodeStatus, "keyExpiry"> | null | undefined,
  now: Date = new Date(),
): KeyExpiryState {
  const at = status?.keyExpiry ? Date.parse(status.keyExpiry) : Number.NaN;
  if (!status || Number.isNaN(at)) return { level: "none", daysLeft: null, expiresAt: null };
  const ms = at - now.getTime();
  const daysLeft = Math.max(0, Math.floor(ms / 86_400_000));
  let level: KeyExpiryLevel = "ok";
  if (ms <= 0) level = "expired";
  else if (daysLeft < KEY_EXPIRY_URGENT_DAYS) level = "urgent";
  else if (daysLeft < KEY_EXPIRY_WARN_DAYS) level = "soon";
  return { level, daysLeft, expiresAt: status.keyExpiry };
}

/** Reads the parts of `tailscale status --json` Frogg needs; null when it is not a status document. */
export function parseTailscaleStatus(json: unknown): TailscaleNodeStatus | null {
  if (!json || typeof json !== "object") return null;
  const doc = json as { BackendState?: unknown; Self?: Record<string, unknown> };
  const self = doc.Self;
  if (!self || typeof self !== "object") return null;
  const dns = typeof self.DNSName === "string" ? self.DNSName.replace(/\.$/, "") : "";
  const expiry = typeof self.KeyExpiry === "string" ? self.KeyExpiry : null;
  // Tailscale reports a zero time when expiry is off on some versions.
  const keyExpiry = expiry && !expiry.startsWith("0001-") ? expiry : null;
  return {
    online: doc.BackendState === "Running",
    ...(dns ? { dnsName: dns } : {}),
    keyExpiry,
  };
}
