import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  constants as fsConstants,
  copyFileSync,
  existsSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";

import { DEVICE_ROLES, type DeviceRole } from "@frogg/protocol/device-access";
import { DAEMON_PERMISSIONS, type DaemonPermission } from "@frogg/protocol/messages";
import { ensurePrivateFile, writePrivateFileAtomicSync } from "./private-files.js";

/**
 * Paired principals and their per-device credentials, persisted under
 * `$FROGG_HOME/principals.json` (mode 0600). The daemon is "claimed" once at
 * least one device credential exists; pairing the first device claims it.
 *
 * Every credential is one device: it has its own name, role, created and
 * last-seen times, and is revoked on its own. Credentials are high-entropy
 * random secrets, so they are stored as SHA-256 digests and compared in
 * constant time instead of going through a password hash.
 *
 * File versions: v1 (pre-device-access) is read and upgraded in memory — each
 * v1 credential becomes an `owner` device named after its credential label or
 * principal — and written back as v2 on the next change (or `migrate()`).
 */
export const PRINCIPALS_FILENAME = "principals.json";
/**
 * Verbatim copy of a v1 `principals.json`, taken just before the first v2
 * write. v1 daemons cannot read v2, so this is the rollback path; it is never
 * overwritten once it exists.
 */
export const PRINCIPALS_V1_BACKUP_FILENAME = "principals.v1.bak.json";

/** lastSeenAt is persisted at most this often per device. */
export const LAST_SEEN_WRITE_INTERVAL_MS = 60_000;

export const PAIRED_VIA = ["claim", "offer", "code", "approval", "password", "legacy"] as const;
export type PairedVia = (typeof PAIRED_VIA)[number];

const LegacyCredentialSchema = z
  .object({
    id: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    createdAt: z.string().min(1),
    label: z.string().optional(),
  })
  .strict();

const LegacyFileSchema = z
  .object({
    version: z.literal(1),
    claimedAt: z.string().optional(),
    principals: z.array(
      z
        .object({
          id: z.string().min(1),
          label: z.string().min(1),
          createdAt: z.string().min(1),
          permissions: z.array(z.enum(DAEMON_PERMISSIONS)),
          credentials: z.array(LegacyCredentialSchema),
        })
        .strict(),
    ),
  })
  .strict();

const CredentialRecordSchema = z
  .object({
    id: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    createdAt: z.string().min(1),
    name: z.string().min(1),
    /** Absent reads as owner, so hand-edited or legacy records keep full access. */
    role: z.enum(DEVICE_ROLES).optional(),
    pairedVia: z.enum(PAIRED_VIA).optional(),
    lastSeenAt: z.string().optional(),
  })
  .strict();

const PrincipalRecordSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    createdAt: z.string().min(1),
    permissions: z.array(z.enum(DAEMON_PERMISSIONS)),
    credentials: z.array(CredentialRecordSchema),
  })
  .strict();

const PrincipalsFileSchema = z
  .object({
    version: z.literal(2),
    claimedAt: z.string().optional(),
    principals: z.array(PrincipalRecordSchema),
  })
  .strict();

export type CredentialRecord = z.infer<typeof CredentialRecordSchema>;
export type PrincipalRecord = z.infer<typeof PrincipalRecordSchema>;
export type PrincipalsFile = z.infer<typeof PrincipalsFileSchema>;

export interface DeviceRecord {
  id: string;
  name: string;
  role: DeviceRole;
  principalId: string;
  principalLabel: string;
  createdAt: string;
  lastSeenAt: string | null;
  pairedVia: PairedVia | null;
  permissions: DaemonPermission[];
}

export interface MintedPrincipal {
  principalId: string;
  credentialId: string;
  /** Plaintext credential; shown exactly once to the pairing client. */
  credential: string;
  permissions: DaemonPermission[];
  role: DeviceRole;
  deviceName: string;
}

export interface MintInput {
  /** Principal (user) label; also the device name when `deviceName` is absent. */
  label: string;
  deviceName?: string;
  role?: DeviceRole;
  pairedVia?: PairedVia;
  permissions?: readonly DaemonPermission[];
}

export interface ClaimStore {
  readonly filePath: string;
  read(): PrincipalsFile;
  isClaimed(): boolean;
  claimedAt(): string | null;
  credentialHashes(): string[];
  /** The device whose credential is `token`, compared in constant time. */
  findDeviceByToken(token: string): DeviceRecord | null;
  listDevices(): DeviceRecord[];
  getDevice(credentialId: string): DeviceRecord | null;
  mintPrincipal(input: MintInput): MintedPrincipal;
  renameDevice(credentialId: string, name: string): DeviceRecord | null;
  /** Removes the credential (and its principal when it was the last one). */
  revokeDevice(credentialId: string): boolean;
  getCredentialRole(credentialId: string): DeviceRole | null;
  setCredentialRole(credentialId: string, role: DeviceRole): boolean;
  /** Records a successful authentication; persisted at most once a minute per device. */
  touchLastSeen(credentialId: string, now?: Date): void;
  /** Rewrites a v1 file as v2. Returns true when a rewrite happened. */
  migrate(): boolean;
  reset(): boolean;
}

export function hashCredential(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function emptyPrincipalsFile(): PrincipalsFile {
  return { version: 2, principals: [] };
}

function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

export function upgradePrincipalsFile(raw: unknown): {
  file: PrincipalsFile;
  upgraded: boolean;
} {
  const version = (raw as { version?: unknown } | null)?.version;
  if (version === 1) {
    const legacy = LegacyFileSchema.parse(raw);
    return {
      upgraded: true,
      file: {
        version: 2,
        ...(legacy.claimedAt ? { claimedAt: legacy.claimedAt } : {}),
        principals: legacy.principals.map((principal) => ({
          id: principal.id,
          label: principal.label,
          createdAt: principal.createdAt,
          permissions: principal.permissions,
          credentials: principal.credentials.map((credential) => ({
            id: credential.id,
            sha256: credential.sha256,
            createdAt: credential.createdAt,
            name: credential.label?.trim() || principal.label,
            role: "owner" as const,
            pairedVia: "legacy" as const,
          })),
        })),
      },
    };
  }
  return { file: PrincipalsFileSchema.parse(raw), upgraded: false };
}

function toDevice(principal: PrincipalRecord, credential: CredentialRecord): DeviceRecord {
  return {
    id: credential.id,
    name: credential.name,
    role: credential.role ?? "owner",
    principalId: principal.id,
    principalLabel: principal.label,
    createdAt: credential.createdAt,
    lastSeenAt: credential.lastSeenAt ?? null,
    pairedVia: credential.pairedVia ?? null,
    permissions: [...principal.permissions],
  };
}

export function createClaimStore(froggHome: string): ClaimStore {
  const filePath = path.join(froggHome, PRINCIPALS_FILENAME);
  const backupPath = path.join(froggHome, PRINCIPALS_V1_BACKUP_FILENAME);
  let cache: {
    mtimeMs: number;
    size: number;
    value: PrincipalsFile;
    upgraded: boolean;
  } | null = null;
  // In-memory last-seen times newer than what is on disk.
  const pendingLastSeen = new Map<string, string>();

  function load(): { value: PrincipalsFile; upgraded: boolean } {
    if (!existsSync(filePath)) {
      cache = null;
      return { value: emptyPrincipalsFile(), upgraded: false };
    }
    const stat = statSync(filePath);
    if (cache && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) {
      return cache;
    }
    ensurePrivateFile(filePath);
    const { file, upgraded } = upgradePrincipalsFile(JSON.parse(readFileSync(filePath, "utf8")));
    cache = { mtimeMs: stat.mtimeMs, size: stat.size, value: file, upgraded };
    return cache;
  }

  function read(): PrincipalsFile {
    const value = load().value;
    if (pendingLastSeen.size === 0) return value;
    return {
      ...value,
      principals: value.principals.map((principal) => ({
        id: principal.id,
        label: principal.label,
        createdAt: principal.createdAt,
        permissions: principal.permissions,
        credentials: principal.credentials.map((credential) => {
          const seen = pendingLastSeen.get(credential.id);
          return seen && (!credential.lastSeenAt || seen > credential.lastSeenAt)
            ? { ...credential, lastSeenAt: seen }
            : credential;
        }),
      })),
    };
  }

  function backupV1BeforeFirstWrite(): void {
    if (!existsSync(filePath) || existsSync(backupPath) || !load().upgraded) return;
    try {
      copyFileSync(filePath, backupPath, fsConstants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return;
    }
    chmodSync(backupPath, 0o600);
  }

  function write(value: PrincipalsFile): void {
    backupV1BeforeFirstWrite();
    writePrivateFileAtomicSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
    cache = null;
    pendingLastSeen.clear();
  }

  function mutateCredential(
    credentialId: string,
    update: (credential: CredentialRecord) => CredentialRecord,
  ): DeviceRecord | null {
    const current = read();
    let found: DeviceRecord | null = null;
    const principals = current.principals.map((principal) => ({
      ...principal,
      credentials: principal.credentials.map((credential) => {
        if (credential.id !== credentialId) return credential;
        const next = update(credential);
        found = toDevice(principal, next);
        return next;
      }),
    }));
    const result = found as DeviceRecord | null;
    if (!result) return null;
    write({ ...current, principals });
    return result;
  }

  function listDevices(): DeviceRecord[] {
    return read().principals.flatMap((principal) =>
      principal.credentials.map((credential) => toDevice(principal, credential)),
    );
  }

  const lastPersistedAt = new Map<string, number>();

  return {
    filePath,
    read,
    isClaimed: () => read().principals.some((principal) => principal.credentials.length > 0),
    claimedAt: () => read().claimedAt ?? null,
    credentialHashes: () =>
      read().principals.flatMap((principal) =>
        principal.credentials.map((credential) => credential.sha256),
      ),
    findDeviceByToken: (token) => {
      const provided = Buffer.from(hashCredential(token), "hex");
      let match: DeviceRecord | null = null;
      for (const principal of read().principals) {
        for (const credential of principal.credentials) {
          const expected = Buffer.from(credential.sha256, "hex");
          if (expected.length === provided.length && timingSafeEqual(provided, expected)) {
            match = toDevice(principal, credential);
          }
        }
      }
      return match;
    },
    listDevices,
    getDevice: (credentialId) => listDevices().find((device) => device.id === credentialId) ?? null,
    mintPrincipal: ({ label, deviceName, role, pairedVia, permissions }) => {
      const current = read();
      const now = new Date().toISOString();
      const credential = randomBytes(32).toString("base64url");
      const principalLabel = label.trim() || "Paired device";
      const name = deviceName?.trim() || principalLabel;
      const resolvedRole: DeviceRole = role ?? "owner";
      const principal: PrincipalRecord = {
        id: generateId("prn"),
        label: principalLabel,
        createdAt: now,
        permissions: [...(permissions ?? DAEMON_PERMISSIONS)],
        credentials: [
          {
            id: generateId("crd"),
            sha256: hashCredential(credential),
            createdAt: now,
            name,
            role: resolvedRole,
            ...(pairedVia ? { pairedVia } : {}),
          },
        ],
      };
      write({
        version: 2,
        claimedAt: current.claimedAt ?? now,
        principals: [...current.principals, principal],
      });
      return {
        principalId: principal.id,
        credentialId: principal.credentials[0]!.id,
        credential,
        permissions: principal.permissions,
        role: resolvedRole,
        deviceName: name,
      };
    },
    renameDevice: (credentialId, name) => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      return mutateCredential(credentialId, (credential) => ({
        ...credential,
        name: trimmed,
      }));
    },
    revokeDevice: (credentialId) => {
      const current = read();
      let removed = false;
      const principals = current.principals
        .map((principal) => {
          const credentials = principal.credentials.filter((credential) => {
            if (credential.id !== credentialId) return true;
            removed = true;
            return false;
          });
          return { ...principal, credentials };
        })
        .filter((principal) => principal.credentials.length > 0);
      if (!(removed as boolean)) return false;
      write({ ...current, principals });
      lastPersistedAt.delete(credentialId);
      return true;
    },
    getCredentialRole: (credentialId) =>
      listDevices().find((device) => device.id === credentialId)?.role ?? null,
    setCredentialRole: (credentialId, role) =>
      mutateCredential(credentialId, (credential) => ({
        ...credential,
        role,
      })) !== null,
    touchLastSeen: (credentialId, now = new Date()) => {
      const iso = now.toISOString();
      pendingLastSeen.set(credentialId, iso);
      const last = lastPersistedAt.get(credentialId) ?? 0;
      if (now.getTime() - last < LAST_SEEN_WRITE_INTERVAL_MS) return;
      lastPersistedAt.set(credentialId, now.getTime());
      mutateCredential(credentialId, (credential) => ({
        ...credential,
        lastSeenAt: iso,
      }));
    },
    migrate: () => {
      const loaded = load();
      if (!loaded.upgraded) return false;
      write(loaded.value);
      return true;
    },
    reset: () => {
      const existed = existsSync(filePath);
      rmSync(filePath, { force: true });
      cache = null;
      pendingLastSeen.clear();
      lastPersistedAt.clear();
      return existed;
    },
  };
}
