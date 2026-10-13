/**
 * A claimed daemon only mints pairing offers for a connection that presents a credential (a
 * paired device or the daemon password). A tokenless loopback or trusted-LAN connection still
 * acts as owner for everything else, which is why its "Pair a device" fails with a bare
 * access_denied. Say what is going on and how to get past it.
 */
export function pairingErrorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/not authorized for (auth\.pairing_code\.create|daemon\.get_pairing_offer)/.test(raw))
    return "This app reaches the host as a trusted local or LAN connection without a device credential, and a claimed daemon only hands out pairing codes to a paired device. Edit this host and add the daemon password, or pair from a device that is already an owner.";
  if (/Only an owner device/.test(raw)) return "Only an owner device can create owner codes.";
  return raw;
}
