/**
 * The one gate for requests that mint a pairing credential: the HTTP
 * `/api/setup/offer` route, `daemon.get_pairing_offer` and
 * `auth.pairing_code.create`. Before the daemon is claimed anyone who may reach
 * it can start pairing. Once claimed, locality alone (a tokenless loopback or
 * trusted-LAN socket) no longer suffices: the caller must present a real
 * credential — a device, the daemon password, or the local token.
 */
export const OWNER_OFFER_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  "daemon.get_pairing_offer.request",
  "auth.pairing_code.create.request",
]);

export function mayMintPairingOffer(input: {
  claimed: boolean;
  localityTrusted: boolean;
}): boolean {
  return !input.claimed || !input.localityTrusted;
}
