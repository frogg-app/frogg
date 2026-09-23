import {
  DIRECT_PAIRING_DEEP_LINK_VERSION,
  formatPairingCode,
  normalizePairingCode,
  PAIRING_CODE_LENGTH,
  type DirectPairingLink,
} from "@frogg/protocol/device-access";

/**
 * Pure side of "pair this device with a code": what the user typed, whether it
 * is usable yet, and the pairing link it stands for. Kept out of the component
 * so the parsing rules can be tested without a daemon.
 */

export interface PairingCodeEntryDraft {
  /** `host`, `host:port`, or a full pairing deep link pasted in. */
  endpoint: string;
  code: string;
  useTls: boolean;
}

export const DEFAULT_DAEMON_PORT = 9999;

export type PairingCodeEntryProblem =
  | "host_required"
  | "port_invalid"
  | "code_incomplete"
  | "code_invalid";

export type PairingCodeEntryParse =
  | { ok: true; host: string; port: number; useTls: boolean; code: string }
  | { ok: false; problem: PairingCodeEntryProblem };

/** Formats a code as the user types it: `XXXX-XXXX`, ambiguous letters folded. */
export function formatPairingCodeInput(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[\s-]+/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .slice(0, PAIRING_CODE_LENGTH);
  return cleaned.length > 4 ? `${cleaned.slice(0, 4)}-${cleaned.slice(4)}` : cleaned;
}

function splitHostPort(value: string): { host: string; port: number | null } | null {
  const trimmed = value.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  if (!trimmed) return null;
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(trimmed);
  if (bracketed) {
    return { host: bracketed[1]!, port: bracketed[2] ? Number(bracketed[2]) : null };
  }
  const colons = trimmed.split(":");
  // A bare IPv6 address has several colons and no port.
  if (colons.length > 2) return { host: trimmed, port: null };
  const [host, port] = colons;
  if (!host) return null;
  return { host, port: port !== undefined && port !== "" ? Number(port) : null };
}

export function parsePairingCodeEntry(draft: PairingCodeEntryDraft): PairingCodeEntryParse {
  const split = splitHostPort(draft.endpoint);
  if (!split) return { ok: false, problem: "host_required" };
  const port = split.port ?? DEFAULT_DAEMON_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, problem: "port_invalid" };
  }
  const raw = draft.code.replace(/[\s-]+/g, "");
  if (raw.length < PAIRING_CODE_LENGTH) return { ok: false, problem: "code_incomplete" };
  const code = normalizePairingCode(draft.code);
  if (!code) return { ok: false, problem: "code_invalid" };
  return { ok: true, host: split.host, port, useTls: draft.useTls, code };
}

/**
 * The pairing link a verified manual entry stands for. The fingerprint comes
 * from the daemon's own identity proof, not from the user, so it is a
 * trust-on-first-use pin rather than a check against a link.
 */
export function pairingLinkFromEntry(
  parsed: Extract<PairingCodeEntryParse, { ok: true }>,
  verified: { serverId: string; fingerprint: string },
): DirectPairingLink {
  return {
    v: DIRECT_PAIRING_DEEP_LINK_VERSION,
    host: parsed.host,
    port: parsed.port,
    fingerprint: verified.fingerprint,
    pairingCode: parsed.code,
    serverId: verified.serverId,
    ...(parsed.useTls ? { useTls: true } : {}),
  };
}

/** `host:port`, bracketed when the host is a bare IPv6 address. */
export function entryEndpoint(parsed: { host: string; port: number }): string {
  return parsed.host.includes(":")
    ? `[${parsed.host}]:${parsed.port}`
    : `${parsed.host}:${parsed.port}`;
}

export { formatPairingCode };
