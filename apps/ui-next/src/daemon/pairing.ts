import {
  formatFingerprint,
  verifyDaemonIdentity,
  verifyDirectPairingLink,
  type VerifiedDaemonIdentity,
} from "@frogg/client/internal/device-identity";
import {
  parseAnyConnectionOfferFromUrl,
  type AnyConnectionOffer,
} from "@frogg/protocol/connection-offer";
import { normalizeHostPort } from "@frogg/protocol/daemon-endpoints";
import {
  daemonKeyFingerprint,
  DeviceRoleSchema,
  normalizePairingCode,
  parseDirectPairingDeepLink,
  type DeviceRole,
  type DirectPairingLink,
} from "@frogg/protocol/device-access";
import { Platform } from "react-native";
import { create } from "zustand";
import { upsertHost, useHosts, type Host } from "./hosts";

/**
 * Pairing for ui-next. Every way in (pasted link, typed code, `frogg-next://` or
 * `frogg://` deep link, a scanned QR once a camera module lands) becomes a
 * `PairTarget`; nothing contacts the daemon to pair until `pair()` runs from a
 * button press.
 *
 * - v2 offer: relay only. The host is saved as a relay host (E2EE to the offer's key)
 *   and connected; no LAN path needed.
 * - v3 offer: direct claim. The offer's endpoints are probed for `/api/identity`, then
 *   the single-use token is redeemed at `POST /api/setup/claim` for a device credential.
 * - direct link (`<scheme>://pair/direct?…`): identity proved with
 *   `/api/identity/proof`, then the link's pairing code (or claim mode) is redeemed.
 * - bare 8-character code: redeemed against an address the user types.
 */

export type PairTarget =
  | { kind: "offer"; offer: AnyConnectionOffer; raw: string }
  | { kind: "direct"; link: DirectPairingLink; raw: string }
  | { kind: "code"; code: string; endpoint: string | null; tls: boolean };

const SCHEMES = ["frogg-next", "frogg"];

/** Parses whatever the user pasted or a deep link carried. Null when it is not a pairing input. */
export function parsePairInput(input: string, endpoint?: string, tls = false): PairTarget | null {
  const raw = input.trim();
  if (!raw) return null;
  for (const scheme of SCHEMES) {
    const link = parseDirectPairingDeepLink(raw, scheme);
    if (link) return { kind: "direct", link, raw };
  }
  try {
    const offer = parseAnyConnectionOfferFromUrl(raw.replace(/^frogg-next:/, "frogg:"));
    if (offer) return { kind: "offer", offer, raw };
  } catch {
    return null;
  }
  const code = normalizePairingCode(raw);
  if (code) return { kind: "code", code, endpoint: endpoint?.trim() || null, tls };
  return null;
}

export interface PairDetails {
  /** What the device will connect to, e.g. `relay.frogg.dev → devbox`. */
  address: string;
  name: string;
  fingerprint: string | null;
  role: DeviceRole | null;
  expiresAt: string | null;
  serverId: string | null;
  /** True when this is a claim (first owner) rather than joining with a role. */
  claim: boolean;
  /** True when the target can be claimed instead of paired (no owner yet). */
  canClaim: boolean;
  relay: boolean;
}

export function describePairTarget(t: PairTarget): PairDetails {
  if (t.kind === "offer") {
    const o = t.offer;
    if (o.v === 2)
      return {
        address: `${o.relay.endpoint} → ${o.serverId}`,
        name: o.serverId,
        fingerprint: daemonKeyFingerprint(o.daemonPublicKeyB64),
        role: null,
        expiresAt: null,
        serverId: o.serverId,
        claim: false,
        canClaim: false,
        relay: true,
      };
    return {
      address: o.direct.endpoints[0] ?? "",
      name: o.hostname ?? o.serverId,
      fingerprint: daemonKeyFingerprint(o.daemonPublicKeyB64),
      role: "owner",
      expiresAt: o.claim.expiresAt,
      serverId: o.serverId,
      claim: true,
      canClaim: false,
      relay: false,
    };
  }
  if (t.kind === "direct") {
    const l = t.link;
    return {
      address: `${l.host}:${l.port}`,
      name: l.label ?? l.host,
      fingerprint: l.fingerprint,
      role: l.role ?? (l.claim ? "owner" : null),
      expiresAt: null,
      serverId: l.serverId ?? null,
      claim: Boolean(l.claim && !l.pairingCode),
      canClaim: false,
      relay: false,
    };
  }
  return {
    address: t.endpoint ?? "",
    name: t.endpoint?.split(":")[0] ?? "host",
    fingerprint: null,
    role: null,
    expiresAt: null,
    serverId: null,
    claim: false,
    canClaim: true,
    relay: false,
  };
}

/** `sha256:abcd…` → `ABCD·EFGH·…` for display, first four groups. */
export const shortFingerprint = (fp: string | null, groups = 4) =>
  fp ? formatFingerprint(fp).toUpperCase().split(" ").slice(0, groups).join("·") : "—";

// ---------------------------------------------------------------------------
// Verification (read-only)

export type Verify =
  | { status: "idle" }
  | { status: "verifying" }
  | { status: "verified"; identity: VerifiedDaemonIdentity | null }
  | { status: "unverified"; message: string }
  | { status: "refused"; message: string };

const REFUSE = new Set(["fingerprint_mismatch", "proof_invalid", "server_key_changed"]);

function knownFingerprint(serverId: string | null | undefined): string | null {
  if (!serverId) return null;
  return useHosts.getState().hosts.find((h) => h.serverId === serverId)?.fingerprint ?? null;
}

/** Proves the daemon holds the key the target names, where the target lets us check. */
export async function verifyPairTarget(t: PairTarget): Promise<Verify> {
  try {
    if (t.kind === "direct") {
      const proved = await verifyDirectPairingLink(t.link, {
        knownFingerprint: knownFingerprint(t.link.serverId),
      });
      return { status: "verified", identity: proved };
    }
    if (t.kind === "code" && t.endpoint) {
      const proved = await verifyDaemonIdentity({ endpoint: t.endpoint, useTls: t.tls });
      return { status: "verified", identity: proved };
    }
    // Offers carry the key; the relay's E2EE handshake (v2) or the identity probe (v3) proves it.
    return { status: "verified", identity: null };
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    const message = e instanceof Error ? e.message : String(e);
    return REFUSE.has(code) ? { status: "refused", message } : { status: "unverified", message };
  }
}

// ---------------------------------------------------------------------------
// Redeeming

const deviceLabel = () => `Frogg (next) on ${Platform.OS}`;

const httpBase = (endpoint: string, tls: boolean) =>
  `${tls ? "https" : "http"}://${normalizeHostPort(endpoint)}`;

async function identity(endpoint: string, tls: boolean, timeoutMs = 4000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${httpBase(endpoint, tls)}/api/identity`, { signal: ctl.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { serverId?: string; hostname?: string };
    return { endpoint, serverId: body.serverId ?? null, hostname: body.hostname ?? null };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function claim(input: {
  endpoint: string;
  tls: boolean;
  token?: string;
  pairingCode?: string;
  claim?: boolean;
}): Promise<{ credential: string; serverId: string | null; role: DeviceRole | null }> {
  let res: Response;
  try {
    res = await fetch(`${httpBase(input.endpoint, input.tls)}/api/setup/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(input.token ? { token: input.token } : {}),
        ...(input.pairingCode ? { pairingCode: input.pairingCode } : {}),
        ...(input.claim ? { claim: true } : {}),
        label: deviceLabel(),
      }),
    });
  } catch {
    throw new Error(`${input.endpoint} did not answer`);
  }
  if (res.status === 403) throw new Error("The pairing code was already used or has expired");
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok)
    throw new Error(
      typeof body.error === "string" ? body.error : `Pairing failed (HTTP ${res.status})`,
    );
  if (typeof body.credential !== "string") throw new Error("The daemon returned no credential");
  const role = DeviceRoleSchema.safeParse(body.role);
  return {
    credential: body.credential,
    serverId: typeof body.serverId === "string" ? body.serverId : null,
    role: role.success ? role.data : null,
  };
}

/**
 * Pairs and saves the host. `asOwner` redeems a bare code target as a claim
 * instead (the "Claim as owner" button). Returns the saved host; the caller connects.
 */
export async function pair(
  t: PairTarget,
  opts: { asOwner?: boolean; verified?: VerifiedDaemonIdentity | null } = {},
): Promise<Host> {
  if (t.kind === "offer") return pairOffer(t.offer);
  if (t.kind === "direct") return pairDirect(t.link, opts.verified ?? null);
  return pairCode(t, opts);
}

async function pairOffer(o: AnyConnectionOffer): Promise<Host> {
  if (o.v === 2) {
    return upsertHost({
      name: o.serverId,
      endpoint: normalizeHostPort(o.relay.endpoint),
      ...(o.relay.useTls === undefined ? {} : { tls: o.relay.useTls }),
      serverId: o.serverId,
      relay: { daemonPublicKeyB64: o.daemonPublicKeyB64 },
      fingerprint: daemonKeyFingerprint(o.daemonPublicKeyB64),
    });
  }
  {
    if (Date.parse(o.claim.expiresAt) <= Date.now()) throw new Error("This offer has expired");
    const tls = o.direct.useTls ?? false;
    const probes = await Promise.all(o.direct.endpoints.map((e) => identity(e, tls)));
    const hit = probes.find((p) => p?.serverId === o.serverId);
    if (!hit) {
      const other = probes.find((p) => p?.serverId);
      throw new Error(
        other
          ? `${other.endpoint} answered as ${other.serverId}, not ${o.serverId}`
          : `None of the host's addresses answered: ${o.direct.endpoints.join(", ")}`,
      );
    }
    const c = await claim({ endpoint: hit.endpoint, tls, token: o.claim.token });
    if (c.serverId && c.serverId !== o.serverId) throw new Error("A different daemon answered");
    return upsertHost({
      name: hit.hostname ?? o.hostname ?? o.serverId,
      endpoint: normalizeHostPort(hit.endpoint),
      tls,
      password: c.credential,
      serverId: o.serverId,
      fingerprint: daemonKeyFingerprint(o.daemonPublicKeyB64),
      ...(c.role ? { role: c.role } : {}),
    });
  }
}

async function pairDirect(l: DirectPairingLink, verified: VerifiedDaemonIdentity | null) {
  {
    const endpoint = normalizeHostPort(
      l.host.includes(":") ? `[${l.host}]:${l.port}` : `${l.host}:${l.port}`,
    );
    const tls = l.useTls === true;
    const c = await claim({
      endpoint,
      tls,
      ...(l.pairingCode ? { pairingCode: l.pairingCode } : { claim: true }),
    });
    if (l.serverId && c.serverId && c.serverId !== l.serverId)
      throw new Error("A different daemon answered");
    const serverId = c.serverId ?? l.serverId;
    return upsertHost({
      name: l.label ?? l.host,
      endpoint,
      tls,
      password: c.credential,
      ...(serverId ? { serverId } : {}),
      fingerprint: verified?.fingerprint ?? l.fingerprint,
      ...(c.role ? { role: c.role } : {}),
    });
  }
}

async function pairCode(
  t: Extract<PairTarget, { kind: "code" }>,
  opts: { asOwner?: boolean; verified?: VerifiedDaemonIdentity | null },
): Promise<Host> {
  if (!t.endpoint) throw new Error("Enter the host's address to use a code");
  const endpoint = normalizeHostPort(t.endpoint);
  const c = await claim({
    endpoint,
    tls: t.tls,
    ...(opts.asOwner ? { claim: true } : { pairingCode: t.code }),
  });
  const id = await identity(endpoint, t.tls);
  return upsertHost({
    name: id?.hostname ?? endpoint.split(":")[0] ?? "host",
    endpoint,
    tls: t.tls,
    password: c.credential,
    ...((c.serverId ?? id?.serverId) ? { serverId: (c.serverId ?? id?.serverId)! } : {}),
    ...(opts.verified ? { fingerprint: opts.verified.fingerprint } : {}),
    ...(c.role ? { role: c.role } : {}),
  });
}

// ---------------------------------------------------------------------------
// Incoming links (deep links, pasted links) wait here for the confirm sheet.

interface PendingPair {
  target: PairTarget | null;
  /** Set when a link arrived that is not a pairing link, so the sheet can say so. */
  invalid: string | null;
}

export const usePendingPair = create<PendingPair>(() => ({ target: null, invalid: null }));

/** Queues a link for confirmation. Returns false when it carries no pairing payload. */
export function offerPairLink(url: string): boolean {
  const target = parsePairInput(url);
  usePendingPair.setState(target ? { target, invalid: null } : { target: null, invalid: url });
  return Boolean(target);
}

export const clearPendingPair = () => usePendingPair.setState({ target: null, invalid: null });

/** True for URLs this app should treat as pairing links. */
export const isPairUrl = (url: string) =>
  /^(frogg-next|frogg):\/\/pair/.test(url) || /\/code\/[\w-]+|#offer=/.test(url);
