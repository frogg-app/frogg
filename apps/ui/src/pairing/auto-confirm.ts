import { brand } from "@frogg/branding";
import type { DirectPairingLink } from "@frogg/protocol/device-access";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

/**
 * Whether a `<scheme>://pair/direct?…` link may pair without the confirmation
 * click (`pairing.autoConfirmLocal` in the brand manifest). The screen exists
 * so a web page or a message cannot pair the app with a daemon the user did
 * not choose. None of that applies here:
 *
 * - the host is loopback, so the only reachable daemon is one already running
 *   on this machine;
 * - the link carries a pairing code, and only an owner of that daemon (an
 *   owner device, the password, or the loopback-only local token) can mint
 *   one. A claim link (`claim=1`, no code) never qualifies;
 * - the daemon still has to prove the key behind `fp` before anything is sent,
 *   and the role granted is the code's, whatever the link's `role` says.
 *
 * This only decides whether to try: the caller confirms once the identity
 * check has passed, and falls back to the button when anything fails.
 */
export function canAutoConfirmDirectLink(
  link: DirectPairingLink,
  enabled: boolean = brand.pairing.autoConfirmLocal,
): boolean {
  if (!enabled) return false;
  if (!link.pairingCode) return false;
  return LOOPBACK_HOSTS.has(link.host.trim().toLowerCase());
}
