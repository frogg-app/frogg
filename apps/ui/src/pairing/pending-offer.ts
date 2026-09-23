import { brand } from "@frogg/branding";
import { extractPairingCode, hasOfferFragment } from "@frogg/protocol/connection-offer";
import { parseDirectPairingDeepLink, type DirectPairingLink } from "@frogg/protocol/device-access";

/**
 * The two shapes a pairing link can take once it has been recognised: the
 * connection-offer payload (v2 relay, v3 claim) carried in an `#offer=`
 * fragment, and the `<scheme>://pair/direct?…` deep link `<cli> pair` prints.
 */
export type PendingPairTarget =
  | { kind: "offer"; url: string }
  | { kind: "direct"; link: DirectPairingLink };

/**
 * A pairing link that arrived from outside the app (web URL, native
 * `Linking`, desktop deep link) waits here until the `/pair-offer` screen
 * picks it up. Kept in memory only: the payload carries a single-use claim
 * token or pairing code and must not be persisted or put in a route
 * parameter. The slot holds one target and reading it clears it.
 */
let pendingTarget: PendingPairTarget | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function setPendingPairTarget(target: PendingPairTarget): void {
  pendingTarget = target;
  notify();
}

export function takePendingPairTarget(): PendingPairTarget | null {
  const target = pendingTarget;
  pendingTarget = null;
  return target;
}

export function peekPendingPairTarget(): PendingPairTarget | null {
  return pendingTarget;
}

export function clearPendingPairTarget(): void {
  pendingTarget = null;
  notify();
}

export function setPendingOfferUrl(url: string): void {
  setPendingPairTarget({ kind: "offer", url });
}

/** Legacy accessor: consumes the slot, and yields a URL only for offer links. */
export function takePendingOfferUrl(): string | null {
  const target = takePendingPairTarget();
  return target?.kind === "offer" ? target.url : null;
}

export function peekPendingOfferUrl(): string | null {
  return pendingTarget?.kind === "offer" ? pendingTarget.url : null;
}

export function subscribePendingPairTarget(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Legacy alias. */
export const subscribePendingOffer = subscribePendingPairTarget;

/**
 * The web build never sees a `<scheme>://` URL — a browser will not navigate
 * to one — so the same link is also accepted as a `#pair/direct?…` fragment on
 * an ordinary https page. The parameters are identical; only the envelope
 * differs, and the parsing stays in the protocol package.
 */
const DIRECT_PAIRING_FRAGMENT = "#pair/direct?";

export function parseDirectPairingFragment(url: string): DirectPairingLink | null {
  const index = url.indexOf(DIRECT_PAIRING_FRAGMENT);
  if (index === -1) return null;
  const params = url.slice(index + DIRECT_PAIRING_FRAGMENT.length);
  return parseDirectPairingDeepLink(`${brand.scheme}://pair/direct?${params}`, brand.scheme);
}

/**
 * Recognises every pairing link the app accepts from outside. Direct pairing
 * deep links are tried first (under the brand scheme and the literal `frogg`
 * scheme, as host-add links are), then the offer forms.
 */
export function extractPairTarget(url: string | null | undefined): PendingPairTarget | null {
  if (!url) return null;
  const trimmed = url.trim();
  const link =
    parseDirectPairingDeepLink(trimmed, brand.scheme) ??
    parseDirectPairingDeepLink(trimmed, "frogg") ??
    parseDirectPairingFragment(trimmed);
  if (link) return { kind: "direct", link };
  const offer = extractOfferLink(trimmed);
  return offer ? { kind: "offer", url: offer } : null;
}

/**
 * Normalises the ways a pairing link reaches the app: the canonical
 * `https://pair.frogg.app/code/<code>`, the `?code=` query, the older
 * `…#offer=<payload>` fragment (including `frogg://pair#offer=…`), and the
 * `?offer=` query the web build also accepts. Returns a string carrying an
 * `#offer=` fragment, or null when the URL carries no offer.
 */
export function extractOfferLink(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (hasOfferFragment(trimmed)) return trimmed;
  const code = extractPairingCode(trimmed) ?? extractOfferQueryParam(trimmed);
  return code ? `#offer=${code}` : null;
}

function extractOfferQueryParam(input: string): string | null {
  const queryIndex = input.indexOf("?");
  if (queryIndex === -1) return null;
  const hashIndex = input.indexOf("#", queryIndex);
  const query = input.slice(queryIndex + 1, hashIndex === -1 ? undefined : hashIndex);
  const encoded = new URLSearchParams(query).get("offer")?.trim();
  return encoded ? encoded : null;
}
