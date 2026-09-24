import {
  DAEMON_KEY_FINGERPRINT_PREFIX,
  IdentityProofResponseSchema,
  daemonKeyFingerprint,
  type DirectPairingLink,
} from "@frogg/protocol/device-access";
import {
  decrypt,
  deriveSharedKey,
  exportPublicKey,
  generateKeyPair,
  importPublicKey,
} from "@frogg/relay/e2ee";

/**
 * Two-way authorisation for a direct pairing link, before anything is paired.
 *
 * A pairing link names a host, a port and `fp`, the fingerprint of the daemon's
 * long-term Curve25519 key. `POST /api/identity/proof` makes the daemon sign a
 * nonce we chose with the secret half of that key, so a link that points at an
 * impostor fails here rather than after the impostor has our device credential.
 *
 * The check is deliberately separate from redeeming the link: the UI shows the
 * verified identity and waits for the user before it pairs or claims.
 */

export type DaemonIdentityErrorCode =
  /** Nothing answered, or the answer was not an identity proof. */
  | "unreachable"
  /** The daemon's key hashes to something other than the link's `fp`. */
  | "fingerprint_mismatch"
  /** The fingerprint matched but the daemon could not sign our nonce. */
  | "proof_invalid"
  /** We already know this `serverId` under a different key. */
  | "server_key_changed";

export class DaemonIdentityError extends Error {
  readonly code: DaemonIdentityErrorCode;
  /** The fingerprint the daemon actually presented, when there was one. */
  readonly actualFingerprint: string | null;

  constructor(
    code: DaemonIdentityErrorCode,
    message: string,
    actualFingerprint: string | null = null,
  ) {
    super(message);
    this.name = "DaemonIdentityError";
    this.code = code;
    this.actualFingerprint = actualFingerprint;
  }
}

export interface VerifiedDaemonIdentity {
  serverId: string;
  fingerprint: string;
  daemonPublicKeyB64: string;
}

export type IdentityFetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<Response>;

export interface VerifyDaemonIdentityOptions {
  /** `host:port` of the daemon. */
  endpoint: string;
  useTls?: boolean;
  /**
   * The `fp` from the pairing link. Omit it only for a code the user typed by
   * hand, where there is no link to compare against: possession is still
   * proved and `knownFingerprint` is still enforced, but the fingerprint has
   * to be shown to the user to check out of band.
   */
  expectedFingerprint?: string;
  /**
   * The fingerprint already stored for this `serverId`, if the host is known.
   * A daemon that answers with the same id under a different key is refused.
   */
  knownFingerprint?: string | null;
  fetchImpl?: IdentityFetchLike;
  timeoutMs?: number;
}

export const DEFAULT_IDENTITY_PROOF_TIMEOUT_MS = 8_000;

function randomChallengeB64(): string {
  const bytes = new Uint8Array(32);
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (!webCrypto?.getRandomValues) {
    throw new DaemonIdentityError("proof_invalid", "No secure random source is available here");
  }
  webCrypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

/** Normalises the two fingerprint spellings a daemon or link might carry. */
export function fingerprintsMatch(a: string, b: string): boolean {
  const strip = (value: string) =>
    value.trim().replace(new RegExp(`^${DAEMON_KEY_FINGERPRINT_PREFIX}`), "");
  return strip(a).length > 0 && strip(a) === strip(b);
}

/** A short, readable form for a fingerprint shown next to a Pair button. */
export function formatFingerprint(fingerprint: string): string {
  const body = fingerprint.startsWith(DAEMON_KEY_FINGERPRINT_PREFIX)
    ? fingerprint.slice(DAEMON_KEY_FINGERPRINT_PREFIX.length)
    : fingerprint;
  return (body.match(/.{1,4}/g) ?? [body]).join(" ");
}

/**
 * Proves the daemon at `endpoint` holds the secret key behind
 * `expectedFingerprint`. Throws {@link DaemonIdentityError} otherwise.
 */
export async function verifyDaemonIdentity(
  options: VerifyDaemonIdentityOptions,
): Promise<VerifiedDaemonIdentity> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as IdentityFetchLike | undefined);
  if (!fetchImpl) {
    throw new DaemonIdentityError("unreachable", "fetch is unavailable in this runtime");
  }
  const base = `${options.useTls ? "https" : "http"}://${options.endpoint}`;
  const challengeB64 = randomChallengeB64();
  const keyPair = generateKeyPair();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_IDENTITY_PROOF_TIMEOUT_MS,
  );
  let parsed: unknown;
  try {
    const response = await fetchImpl(`${base}/api/identity/proof`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeB64,
        clientPublicKeyB64: exportPublicKey(keyPair.publicKey),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new DaemonIdentityError(
        "unreachable",
        `The daemon answered the identity check with HTTP ${response.status}`,
      );
    }
    parsed = await response.json();
  } catch (error) {
    if (error instanceof DaemonIdentityError) throw error;
    throw new DaemonIdentityError(
      "unreachable",
      error instanceof Error ? error.message : "The daemon did not answer the identity check",
    );
  } finally {
    clearTimeout(timer);
  }

  const proof = IdentityProofResponseSchema.safeParse(parsed);
  if (!proof.success) {
    throw new DaemonIdentityError("unreachable", "The identity check answer was not understood");
  }

  // The fingerprint is a hash of the key, so recompute it rather than trusting
  // the `fingerprint` field the daemon also sends.
  let actual: string;
  try {
    actual = daemonKeyFingerprint(proof.data.daemonPublicKeyB64);
  } catch {
    throw new DaemonIdentityError("proof_invalid", "The daemon sent an unreadable public key");
  }
  if (options.expectedFingerprint && !fingerprintsMatch(actual, options.expectedFingerprint)) {
    throw new DaemonIdentityError(
      "fingerprint_mismatch",
      "This daemon's key does not match the pairing link",
      actual,
    );
  }
  if (options.knownFingerprint && !fingerprintsMatch(actual, options.knownFingerprint)) {
    throw new DaemonIdentityError(
      "server_key_changed",
      "This host is already known under a different key",
      actual,
    );
  }

  // Possession: only the holder of the secret key can seal our nonce.
  try {
    const shared = deriveSharedKey(
      keyPair.secretKey,
      importPublicKey(proof.data.daemonPublicKeyB64),
    );
    const bytes = Uint8Array.from(globalThis.atob(proof.data.proofB64), (c) => c.charCodeAt(0));
    const opened = new TextDecoder().decode(
      new Uint8Array(decrypt(shared, bytes.buffer as ArrayBuffer)),
    );
    if (opened !== challengeB64) {
      throw new DaemonIdentityError(
        "proof_invalid",
        "The daemon signed the wrong challenge",
        actual,
      );
    }
  } catch (error) {
    if (error instanceof DaemonIdentityError) throw error;
    throw new DaemonIdentityError(
      "proof_invalid",
      "The daemon could not prove it holds its key",
      actual,
    );
  }

  return {
    serverId: proof.data.serverId,
    fingerprint: actual,
    daemonPublicKeyB64: proof.data.daemonPublicKeyB64,
  };
}

/** {@link verifyDaemonIdentity} for the host and port named by a pairing link. */
export function verifyDirectPairingLink(
  link: DirectPairingLink,
  options: Omit<VerifyDaemonIdentityOptions, "endpoint" | "useTls" | "expectedFingerprint"> = {},
): Promise<VerifiedDaemonIdentity> {
  return verifyDaemonIdentity({
    ...options,
    endpoint: link.host.includes(":") ? `[${link.host}]:${link.port}` : `${link.host}:${link.port}`,
    useTls: link.useTls === true,
    expectedFingerprint: link.fingerprint,
  });
}
