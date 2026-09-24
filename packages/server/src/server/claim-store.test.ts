import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  createClaimStore,
  hashCredential,
  PRINCIPALS_FILENAME,
  PRINCIPALS_V1_BACKUP_FILENAME,
} from "./claim-store.js";

const homes: string[] = [];

function createHome(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), "frogg-claim-store-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("claim store", () => {
  test("a fresh home is unclaimed and has no credentials", () => {
    const store = createClaimStore(createHome());
    expect(store.isClaimed()).toBe(false);
    expect(store.claimedAt()).toBeNull();
    expect(store.credentialHashes()).toEqual([]);
  });

  test("minting the first principal claims the daemon and persists only a digest", () => {
    const home = createHome();
    const store = createClaimStore(home);
    const minted = store.mintPrincipal({ label: "Alice's laptop" });

    expect(store.isClaimed()).toBe(true);
    expect(store.claimedAt()).not.toBeNull();
    expect(store.credentialHashes()).toEqual([hashCredential(minted.credential)]);
    expect(minted.permissions).toContain("access.manage");

    const raw = readFileSync(path.join(home, PRINCIPALS_FILENAME), "utf8");
    expect(raw).not.toContain(minted.credential);
    expect(raw).toContain("Alice's laptop");
    if (process.platform !== "win32") {
      expect(statSync(path.join(home, PRINCIPALS_FILENAME)).mode & 0o777).toBe(0o600);
    }
  });

  test("picks up an external rewrite of the file and reset unclaims", () => {
    const home = createHome();
    const store = createClaimStore(home);
    store.mintPrincipal({ label: "first" });
    const claimedAt = store.claimedAt();

    // Another process (frogg daemon reset-claim) removes the file while the daemon runs.
    const other = createClaimStore(home);
    expect(other.reset()).toBe(true);
    expect(store.isClaimed()).toBe(false);
    expect(other.reset()).toBe(false);

    store.mintPrincipal({ label: "second" });
    expect(store.read().principals.map((principal) => principal.label)).toEqual(["second"]);
    // Two mints inside the same millisecond share an ISO timestamp, so assert the claim moved
    // forward rather than that the strings differ; the label assertion above proves the rewrite.
    const reclaimedAt = store.claimedAt();
    expect(reclaimedAt).not.toBeNull();
    expect(Date.parse(reclaimedAt as string)).toBeGreaterThanOrEqual(
      Date.parse(claimedAt as string),
    );
  });

  test("rejects a corrupt principals file instead of treating it as unclaimed", () => {
    const home = createHome();
    writeFileSync(path.join(home, PRINCIPALS_FILENAME), '{"version":1,"principals":"nope"}');
    const store = createClaimStore(home);
    expect(() => store.isClaimed()).toThrow();
  });
});

describe("per-device credentials", () => {
  test("migrates a v1 file: every credential becomes an owner device", () => {
    const home = createHome();
    const secret = "legacy-secret";
    writeFileSync(
      path.join(home, PRINCIPALS_FILENAME),
      JSON.stringify({
        version: 1,
        claimedAt: "2026-01-01T00:00:00.000Z",
        principals: [
          {
            id: "prn_a",
            label: "Alice",
            createdAt: "2026-01-01T00:00:00.000Z",
            permissions: ["daemon.read", "access.manage"],
            credentials: [
              {
                id: "crd_a",
                sha256: hashCredential(secret),
                createdAt: "2026-01-01T00:00:00.000Z",
              },
              {
                id: "crd_b",
                sha256: hashCredential("other"),
                createdAt: "2026-01-02T00:00:00.000Z",
                label: "Alice's phone",
              },
            ],
          },
        ],
      }),
    );
    const store = createClaimStore(home);
    expect(store.listDevices().map((d) => [d.id, d.name, d.role, d.pairedVia])).toEqual([
      ["crd_a", "Alice", "owner", "legacy"],
      ["crd_b", "Alice's phone", "owner", "legacy"],
    ]);
    expect(store.findDeviceByToken(secret)?.id).toBe("crd_a");
    expect(store.claimedAt()).toBe("2026-01-01T00:00:00.000Z");

    expect(store.migrate()).toBe(true);
    const raw = JSON.parse(readFileSync(path.join(home, PRINCIPALS_FILENAME), "utf8"));
    expect(raw.version).toBe(2);
    expect(store.migrate()).toBe(false);
    expect(createClaimStore(home).findDeviceByToken(secret)?.name).toBe("Alice");
  });

  test("devices are named, role-scoped, renamed and revoked individually", () => {
    const store = createClaimStore(createHome());
    const owner = store.mintPrincipal({ label: "Owner", pairedVia: "claim" });
    const phone = store.mintPrincipal({
      label: "Bob",
      deviceName: "Bob's phone",
      role: "viewer",
      pairedVia: "code",
    });
    expect(owner.role).toBe("owner");
    expect(phone).toMatchObject({ role: "viewer", deviceName: "Bob's phone" });
    expect(store.findDeviceByToken(phone.credential)).toMatchObject({
      id: phone.credentialId,
      role: "viewer",
      pairedVia: "code",
    });
    expect(store.findDeviceByToken("nope")).toBeNull();

    expect(store.renameDevice(phone.credentialId, "  Tablet ")?.name).toBe("Tablet");
    expect(store.renameDevice(phone.credentialId, "  ")).toBeNull();
    expect(store.renameDevice("crd_missing", "x")).toBeNull();

    expect(store.setCredentialRole(phone.credentialId, "operator")).toBe(true);
    expect(store.getCredentialRole(phone.credentialId)).toBe("operator");
    expect(store.getCredentialRole("crd_missing")).toBeNull();

    expect(store.revokeDevice(phone.credentialId)).toBe(true);
    expect(store.revokeDevice(phone.credentialId)).toBe(false);
    expect(store.findDeviceByToken(phone.credential)).toBeNull();
    expect(store.listDevices().map((d) => d.id)).toEqual([owner.credentialId]);
    expect(store.isClaimed()).toBe(true);

    expect(store.revokeDevice(owner.credentialId)).toBe(true);
    // The claim is latched: revoking every device does not reopen it.
    expect(store.isClaimed()).toBe(true);
    expect(store.isLastOwner(owner.credentialId)).toBe(false);
    store.reset();
    expect(store.isClaimed()).toBe(false);
  });

  test("last-seen is visible immediately but persisted at most once a minute", () => {
    const home = createHome();
    const store = createClaimStore(home);
    const minted = store.mintPrincipal({ label: "d" });
    const t0 = new Date("2026-09-01T00:00:00.000Z");
    store.touchLastSeen(minted.credentialId, t0);
    const onDisk = () => createClaimStore(home).getDevice(minted.credentialId)?.lastSeenAt ?? null;
    expect(onDisk()).toBe(t0.toISOString());

    const t1 = new Date(t0.getTime() + 10_000);
    store.touchLastSeen(minted.credentialId, t1);
    expect(store.getDevice(minted.credentialId)?.lastSeenAt).toBe(t1.toISOString());
    expect(onDisk()).toBe(t0.toISOString());

    const t2 = new Date(t0.getTime() + 61_000);
    store.touchLastSeen(minted.credentialId, t2);
    expect(onDisk()).toBe(t2.toISOString());
  });
});

describe("v1 downgrade backup", () => {
  const v1 = JSON.stringify({
    version: 1,
    principals: [
      {
        id: "prn_a",
        label: "Alice",
        createdAt: "2026-01-01T00:00:00.000Z",
        permissions: ["daemon.read"],
        credentials: [
          {
            id: "crd_a",
            sha256: hashCredential("s"),
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    ],
  });

  test("copies the v1 file once before the first v2 write, mode 0600, never overwritten", () => {
    const home = createHome();
    const backup = path.join(home, PRINCIPALS_V1_BACKUP_FILENAME);
    writeFileSync(path.join(home, PRINCIPALS_FILENAME), v1, { mode: 0o644 });

    const store = createClaimStore(home);
    expect(existsSync(backup)).toBe(false);
    expect(store.migrate()).toBe(true);
    expect(readFileSync(backup, "utf8")).toBe(v1);
    if (process.platform !== "win32") expect(statSync(backup).mode & 0o777).toBe(0o600);

    // Further v2 writes leave the backup alone.
    store.mintPrincipal({ label: "Bob" });
    expect(readFileSync(backup, "utf8")).toBe(v1);

    // A later v1 file (e.g. after a rollback and re-upgrade) does not overwrite it.
    writeFileSync(path.join(home, PRINCIPALS_FILENAME), v1.replace("Alice", "Carol"));
    expect(createClaimStore(home).migrate()).toBe(true);
    expect(readFileSync(backup, "utf8")).toBe(v1);
  });

  test("no backup for fresh or v2 stores", () => {
    const home = createHome();
    const store = createClaimStore(home);
    store.mintPrincipal({ label: "Owner" });
    store.mintPrincipal({ label: "Second" });
    expect(existsSync(path.join(home, PRINCIPALS_V1_BACKUP_FILENAME))).toBe(false);
  });
});
