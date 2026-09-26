import { z } from "zod";

/**
 * Per-device access: device credentials, roles, pairing codes, claim mode,
 * owner approval, password login, and the direct pairing deep link.
 *
 * HTTP routes (all JSON, public unless noted; see self-hosting/security.mdx):
 * - `POST /api/identity/proof`   {@link IdentityProofRequestSchema} → {@link IdentityProofResponseSchema}
 * - `POST /api/setup/claim`      {@link DeviceClaimRequestSchema}   → {@link DeviceClaimResponseSchema}
 * - `POST /api/setup/request`    {@link PairingRequestCreateSchema} → {@link PairingRequestCreatedSchema}
 * - `GET  /api/setup/request/:pollId` → {@link PairingRequestPollResponseSchema}
 * - `POST /api/auth/login`       {@link PasswordLoginRequestSchema} → {@link DeviceClaimResponseSchema}
 */

export const DEVICE_ROLES = ["owner", "operator", "viewer"] as const;
export const DeviceRoleSchema = z.enum(DEVICE_ROLES);
export type DeviceRole = z.infer<typeof DeviceRoleSchema>;

export const DEVICE_NAME_MAX_LENGTH = 120;
export const DeviceNameSchema = z.string().trim().min(1).max(DEVICE_NAME_MAX_LENGTH);

/** One paired device as the daemon reports it over `auth.device.list`. */
export const DeviceCredentialSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  role: DeviceRoleSchema,
  principalId: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
  /** How the device was paired. */
  pairedVia: z.enum(["claim", "offer", "code", "approval", "password", "legacy"]).optional(),
  /** The requesting connection authenticated with this credential. */
  current: z.boolean(),
  /** At least one live connection uses this credential. */
  connected: z.boolean(),
});
export type DeviceCredential = z.infer<typeof DeviceCredentialSchema>;

/** Daemon access settings as reported by `auth.settings.get` / `.update`. */
export const AuthSettingsSchema = z.object({
  /** `daemon.auth.claimMode`: LAN is not trusted and the first client claims the daemon. */
  claimMode: z.boolean(),
  /** `daemon.auth.trustLan` as configured (ignored while claimMode is on). */
  trustLan: z.boolean(),
  /** Whether LAN clients are trusted right now (trustLan && !claimMode). */
  lanTrustEffective: z.boolean(),
  claimed: z.boolean(),
  passwordEnabled: z.boolean(),
  /** A setting controlled by the environment (FROGG_PASSWORD, FROGG_TRUST_LAN, FROGG_CLAIM_MODE). */
  overrideControlledPaths: z.array(z.string()),
  deviceCount: z.number().int().nonnegative(),
});
export type AuthSettings = z.infer<typeof AuthSettingsSchema>;

// ---------------------------------------------------------------------------
// Pairing codes

/** Crockford base32, no I L O U. Codes are 8 symbols, shown as `XXXX-XXXX`. */
export const PAIRING_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const PAIRING_CODE_LENGTH = 8;

/** Uppercases, strips spaces/dashes and maps the ambiguous I/L→1, O→0. Null if not a code. */
export function normalizePairingCode(input: string): string | null {
  const cleaned = input
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  if (cleaned.length !== PAIRING_CODE_LENGTH) return null;
  for (const char of cleaned) if (!PAIRING_CODE_ALPHABET.includes(char)) return null;
  return cleaned;
}

export function formatPairingCode(code: string): string {
  const normalized = normalizePairingCode(code) ?? code;
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

// ---------------------------------------------------------------------------
// Daemon key fingerprint: `sha256:` + base64url(SHA-256(raw 32-byte public key)), unpadded.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Dependency-free SHA-256 so React Native clients can verify fingerprints. */
export function sha256(data: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const bitLength = data.length * 8;
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i]!);
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const normalized = b64.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = globalThis.atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export const DAEMON_KEY_FINGERPRINT_PREFIX = "sha256:";

/** Fingerprint of the daemon's base64 (standard or url-safe) Curve25519 public key. */
export function daemonKeyFingerprint(daemonPublicKeyB64: string): string {
  return `${DAEMON_KEY_FINGERPRINT_PREFIX}${bytesToBase64Url(sha256(base64ToBytes(daemonPublicKeyB64)))}`;
}

// ---------------------------------------------------------------------------
// Direct pairing deep link
//
//   <scheme>://pair/direct?v=1&host=<host>&port=<port>&fp=<fingerprint>
//        [&pairingCode=<XXXX-XXXX>][&claim=1][&tls=1][&sid=<serverId>][&name=<label>][&role=<role>]
//
// `pairingCode` (not `code`) so older apps' `?code=` offer parser ignores it.
// With `claim=1` and no code the daemon is in claim mode and unclaimed.

export const DIRECT_PAIRING_DEEP_LINK_VERSION = 1;

export const DirectPairingLinkSchema = z.object({
  v: z.literal(DIRECT_PAIRING_DEEP_LINK_VERSION),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  fingerprint: z.string().startsWith(DAEMON_KEY_FINGERPRINT_PREFIX),
  pairingCode: z.string().optional(),
  claim: z.boolean().optional(),
  useTls: z.boolean().optional(),
  serverId: z.string().optional(),
  label: z.string().optional(),
  role: DeviceRoleSchema.optional(),
});
export type DirectPairingLink = z.infer<typeof DirectPairingLinkSchema>;

/** `scheme` is the brand's deep-link scheme (`brand.scheme`); there is no default. */
export function buildDirectPairingDeepLink(
  link: Omit<DirectPairingLink, "v">,
  scheme: string,
): string {
  const parsed = DirectPairingLinkSchema.parse({ ...link, v: DIRECT_PAIRING_DEEP_LINK_VERSION });
  const params = new URLSearchParams({
    v: String(parsed.v),
    host: parsed.host,
    port: String(parsed.port),
    fp: parsed.fingerprint,
  });
  if (parsed.pairingCode) params.set("pairingCode", formatPairingCode(parsed.pairingCode));
  if (parsed.claim) params.set("claim", "1");
  if (parsed.useTls) params.set("tls", "1");
  if (parsed.serverId) params.set("sid", parsed.serverId);
  if (parsed.label) params.set("name", parsed.label);
  if (parsed.role) params.set("role", parsed.role);
  return `${scheme}://pair/direct?${params.toString()}`;
}

/** Null for anything that is not a well-formed direct pairing link for `scheme`. */
export function parseDirectPairingDeepLink(
  input: string,
  scheme: string,
): DirectPairingLink | null {
  const prefix = `${scheme}://pair/direct?`;
  const trimmed = input.trim();
  if (!trimmed.startsWith(prefix)) return null;
  const params = new URLSearchParams(trimmed.slice(prefix.length).split("#")[0]);
  const port = Number(params.get("port"));
  const rawCode = params.get("pairingCode");
  const code = rawCode ? normalizePairingCode(rawCode) : null;
  if (rawCode && !code) return null;
  const flag = (key: string) => params.get(key) === "1" || params.get(key) === "true";
  const serverId = params.get("sid") || params.get("serverId");
  const result = DirectPairingLinkSchema.safeParse({
    v: Number(params.get("v")),
    host: params.get("host") ?? "",
    port: Number.isInteger(port) ? port : -1,
    fingerprint: params.get("fp") ?? "",
    ...(code ? { pairingCode: code } : {}),
    ...(flag("claim") ? { claim: true } : {}),
    ...(flag("tls") ? { useTls: true } : {}),
    // `sid` is what `buildDirectPairingDeepLink` writes; `serverId` is accepted
    // for links assembled by hand or by other tools.
    ...(serverId ? { serverId } : {}),
    ...(params.get("name") ? { label: params.get("name")! } : {}),
    ...(params.get("role") ? { role: params.get("role")! } : {}),
  });
  return result.success ? result.data : null;
}

// ---------------------------------------------------------------------------
// HTTP bodies

/**
 * Two-way authorisation: the client proves the daemon holds the secret key
 * behind the fingerprint it was given. The client sends a random 32-byte
 * challenge and an ephemeral Curve25519 public key; the daemon returns
 * `proofB64` = nacl.box(challenge) under box.before(daemonSecret, clientPublic),
 * in the relay `encrypt` framing (24-byte nonce ‖ ciphertext). The client checks
 * `daemonKeyFingerprint(daemonPublicKeyB64)` against the link, then decrypts.
 */
export const IdentityProofRequestSchema = z.object({
  challengeB64: z.string().min(1).max(128),
  clientPublicKeyB64: z.string().min(1).max(128),
});
export const IdentityProofResponseSchema = z.object({
  serverId: z.string(),
  daemonPublicKeyB64: z.string(),
  fingerprint: z.string(),
  proofB64: z.string(),
});
export type IdentityProofRequest = z.infer<typeof IdentityProofRequestSchema>;
export type IdentityProofResponse = z.infer<typeof IdentityProofResponseSchema>;

/**
 * Redeem exactly one of: `token` (v3 offer), `pairingCode`, or `claim: true`
 * (claim mode, unclaimed daemon only; the claimer becomes owner).
 */
export const DeviceClaimRequestSchema = z.object({
  token: z.string().min(1).optional(),
  pairingCode: z.string().min(1).max(32).optional(),
  claim: z.literal(true).optional(),
  /** Device name. `label` is the legacy spelling. */
  deviceName: DeviceNameSchema.optional(),
  label: DeviceNameSchema.optional(),
});
export type DeviceClaimRequest = z.infer<typeof DeviceClaimRequestSchema>;

export const DeviceClaimResponseSchema = z.object({
  serverId: z.string(),
  principalId: z.string(),
  credentialId: z.string(),
  /** Plaintext bearer; shown once. Use as the WebSocket `frogg.bearer.<credential>`. */
  credential: z.string(),
  role: DeviceRoleSchema,
  deviceName: z.string(),
  fingerprint: z.string().optional(),
  permissions: z.array(z.string()),
});
export type DeviceClaimResponse = z.infer<typeof DeviceClaimResponseSchema>;

export const PairingRequestCreateSchema = z.object({ deviceName: DeviceNameSchema });
export const PairingRequestCreatedSchema = z.object({
  /** Secret; only the requesting device knows it. */
  pollId: z.string(),
  /** Short code both screens show so the owner can match the request. */
  matchCode: z.string(),
  expiresAt: z.string(),
});
export const PairingRequestPollResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending"), expiresAt: z.string() }),
  z.object({ status: z.literal("denied") }),
  z.object({ status: z.literal("expired") }),
  z.object({ status: z.literal("approved"), result: DeviceClaimResponseSchema }),
]);
export type PairingRequestPollResponse = z.infer<typeof PairingRequestPollResponseSchema>;

export const PasswordLoginRequestSchema = z.object({
  password: z.string().min(1).max(1024),
  deviceName: DeviceNameSchema.optional(),
});

/** Pending owner-approval request as the owner sees it. */
export const PendingPairingRequestSchema = z.object({
  id: z.string(),
  deviceName: z.string(),
  matchCode: z.string(),
  remoteAddress: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type PendingPairingRequest = z.infer<typeof PendingPairingRequestSchema>;

// ---------------------------------------------------------------------------
// Presence

export const PresenceTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("agent"), agentId: z.string().min(1) }),
  z.object({ kind: z.literal("terminal"), terminalId: z.string().min(1) }),
]);
export type PresenceTarget = z.infer<typeof PresenceTargetSchema>;

/** What a client reports. `left` removes it from the target. */
export const PresenceReportStateSchema = z.enum(["viewing", "typing", "idle", "left"]);
export type PresenceReportState = z.infer<typeof PresenceReportStateSchema>;
/** What participants show. `sending` / `input` are derived by the daemon. */
export const PresenceActivitySchema = z.enum(["viewing", "typing", "idle", "sending", "input"]);
export type PresenceActivity = z.infer<typeof PresenceActivitySchema>;

export const PresenceParticipantSchema = z.object({
  /** Stable per connection session, opaque. */
  participantId: z.string(),
  deviceId: z.string().nullable(),
  deviceName: z.string(),
  clientType: z.string().nullable(),
  /**
   * COMPAT(connectedClients): added in v1.5.52. A one-way hash of the client's
   * install id: stable across reconnects, so a viewer can attach a nickname,
   * but useless for resuming the other client's session.
   */
  clientKey: z.string().optional(),
  activity: PresenceActivitySchema,
  activityAt: z.string(),
  /** The recipient's own entry. */
  isSelf: z.boolean(),
});
export type PresenceParticipant = z.infer<typeof PresenceParticipantSchema>;

export const PresenceSnapshotSchema = z.object({
  target: PresenceTargetSchema,
  participants: z.array(PresenceParticipantSchema),
});
export type PresenceSnapshot = z.infer<typeof PresenceSnapshotSchema>;

/** One live client connection to the daemon, paired or not. */
export const ConnectedClientSchema = z.object({
  /** Opaque, per connection session. Matches `PresenceParticipant.participantId`. */
  participantId: z.string(),
  /** See `PresenceParticipant.clientKey`. */
  clientKey: z.string(),
  deviceId: z.string().nullable(),
  /** Paired device name, else the name the client gave itself; may be empty. */
  deviceName: z.string(),
  paired: z.boolean(),
  role: DeviceRoleSchema.nullable(),
  clientType: z.string().nullable(),
  appVersion: z.string().nullable(),
  connectedAt: z.string(),
  /** Agents and terminals it currently has presence on. */
  targets: z.array(PresenceTargetSchema),
  isSelf: z.boolean(),
});
export type ConnectedClient = z.infer<typeof ConnectedClientSchema>;
