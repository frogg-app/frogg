import { z } from "zod";
import storage from "@/storage/brand-storage";
import { readValidatedJson } from "@/storage/validated-storage";

/**
 * Trust on first use for daemon keys.
 *
 * A pairing link carries the fingerprint of the daemon's long-term key, and
 * `verifyDirectPairingLink` proves the daemon holds the secret half. That
 * stops an impostor at a fresh link, but it cannot stop a *second* link that
 * points a `serverId` we already trust at a different key. So the fingerprint
 * is pinned here after a successful pair and handed back as `knownFingerprint`
 * before the next verification: a daemon answering with a known id under a new
 * key is refused as `server_key_changed`.
 *
 * Only public fingerprints live here — never a credential or a pairing code.
 */
export const KNOWN_DAEMON_KEYS_STORAGE_KEY = "@frogg:known-daemon-keys";

const KnownDaemonKeysSchema = z.record(z.string(), z.string().min(1));
export type KnownDaemonKeys = z.infer<typeof KnownDaemonKeysSchema>;

export async function readKnownDaemonKeys(): Promise<KnownDaemonKeys> {
  try {
    return (
      (await readValidatedJson(storage, KNOWN_DAEMON_KEYS_STORAGE_KEY, KnownDaemonKeysSchema)) ?? {}
    );
  } catch {
    // A pin we cannot read must not block pairing; it degrades to no pin.
    return {};
  }
}

/** The fingerprint already pinned for `serverId`, or null when it is new. */
export async function readKnownDaemonFingerprint(
  serverId: string | null | undefined,
): Promise<string | null> {
  if (!serverId) return null;
  const keys = await readKnownDaemonKeys();
  return keys[serverId] ?? null;
}

/** Pins `fingerprint` for `serverId`. A no-op when the same pin is already stored. */
export async function rememberDaemonFingerprint(
  serverId: string | null | undefined,
  fingerprint: string | null | undefined,
): Promise<void> {
  if (!serverId || !fingerprint) return;
  try {
    const keys = await readKnownDaemonKeys();
    if (keys[serverId] === fingerprint) return;
    await storage.setItem(
      KNOWN_DAEMON_KEYS_STORAGE_KEY,
      JSON.stringify({ ...keys, [serverId]: fingerprint }),
    );
  } catch {
    // Failing to pin is not a reason to fail a pair the user already approved.
  }
}

/** Drops the pin, so the next link for this daemon is trusted on first use again. */
export async function forgetDaemonFingerprint(serverId: string): Promise<void> {
  try {
    const keys = await readKnownDaemonKeys();
    if (!(serverId in keys)) return;
    const { [serverId]: _removed, ...rest } = keys;
    await storage.setItem(KNOWN_DAEMON_KEYS_STORAGE_KEY, JSON.stringify(rest));
  } catch {
    // Nothing to do: the pin stays until storage works again.
  }
}
