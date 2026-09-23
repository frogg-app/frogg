import { formatFingerprint } from "@frogg/client/internal/device-identity";
import {
  parseAnyConnectionOfferFromUrl,
  type AnyConnectionOffer,
} from "@frogg/protocol/connection-offer";
import { daemonKeyFingerprint, type DeviceRole } from "@frogg/protocol/device-access";
import { normalizeHostPort } from "@frogg/protocol/daemon-endpoints";
import type { PendingPairTarget } from "./pending-offer";

/**
 * What the user is shown before anything is paired, derived from the link
 * alone. Pure so the confirmation screen can be reasoned about (and tested)
 * without a daemon: nothing here talks to the network.
 */
export interface PairConfirmationDetails {
  kind: PendingPairTarget["kind"];
  /** `host:port` of the endpoint the link names, when it names exactly one. */
  endpoint: string | null;
  /** Every endpoint a v3 offer lists, in the order the offer gives them. */
  endpoints: readonly string[];
  /** `sha256:…` as the link states it, or as computed from the offer's key. */
  fingerprint: string | null;
  /** The same fingerprint grouped for reading aloud. */
  formattedFingerprint: string | null;
  expiresAt: string | null;
  /** Taking ownership of the machine, not just getting a device credential. */
  isClaim: boolean;
  /** The role the link says this device will get, when it says. */
  role: DeviceRole | null;
  serverId: string | null;
  hostname: string | null;
  /**
   * Whether the daemon's identity must be proved before the button is offered.
   * A direct link names a single endpoint and a fingerprint, so it can be (and
   * is) checked up front; an offer's own claim flow probes its endpoint list.
   */
  requiresIdentityCheck: boolean;
}

export interface DescribedPairTarget {
  details: PairConfirmationDetails;
  /** Present for offer targets; the parsed payload the pair flow will use. */
  offer: AnyConnectionOffer | null;
}

function safeFingerprint(daemonPublicKeyB64: string): string | null {
  try {
    return daemonKeyFingerprint(daemonPublicKeyB64);
  } catch {
    return null;
  }
}

function describeOffer(offer: AnyConnectionOffer): PairConfirmationDetails {
  const fingerprint = safeFingerprint(offer.daemonPublicKeyB64);
  const endpoints = offer.v === 3 ? offer.direct.endpoints : [offer.relay.endpoint];
  return {
    kind: "offer",
    endpoint: endpoints.length === 1 ? normalizeHostPort(endpoints[0]!) : null,
    endpoints,
    fingerprint,
    formattedFingerprint: fingerprint ? formatFingerprint(fingerprint) : null,
    expiresAt: offer.v === 3 ? offer.claim.expiresAt : null,
    isClaim: offer.v === 3,
    role: null,
    serverId: offer.serverId,
    hostname: offer.v === 3 ? (offer.hostname ?? null) : null,
    requiresIdentityCheck: false,
  };
}

/** A direct link claims the daemon when it carries `claim=1` and no pairing code. */
export function isClaimingLink(link: { claim?: boolean; pairingCode?: string }): boolean {
  return link.claim === true && !link.pairingCode;
}

/** Null when the target is not a pairing link this build understands. */
export function describePairTarget(target: PendingPairTarget): DescribedPairTarget | null {
  if (target.kind === "direct") {
    const { link } = target;
    return {
      offer: null,
      details: {
        kind: "direct",
        endpoint: normalizeHostPort(
          link.host.includes(":") ? `[${link.host}]:${link.port}` : `${link.host}:${link.port}`,
        ),
        endpoints: [],
        fingerprint: link.fingerprint,
        formattedFingerprint: formatFingerprint(link.fingerprint),
        expiresAt: null,
        isClaim: isClaimingLink(link),
        role: link.role ?? null,
        serverId: link.serverId ?? null,
        hostname: link.label ?? null,
        requiresIdentityCheck: true,
      },
    };
  }
  let offer: AnyConnectionOffer | null = null;
  try {
    offer = parseAnyConnectionOfferFromUrl(target.url);
  } catch {
    offer = null;
  }
  return offer ? { offer, details: describeOffer(offer) } : null;
}

/** True once the link's own expiry has passed; links without one never expire here. */
export function isPairTargetExpired(
  details: PairConfirmationDetails,
  now: number = Date.now(),
): boolean {
  if (!details.expiresAt) return false;
  const expiresAt = Date.parse(details.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}
