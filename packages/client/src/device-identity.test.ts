import { describe, expect, it } from "vitest";
import { daemonKeyFingerprint } from "@frogg/protocol/device-access";
import {
  deriveSharedKey,
  encrypt,
  exportPublicKey,
  generateKeyPair,
  importPublicKey,
} from "@frogg/relay/e2ee";

import {
  DaemonIdentityError,
  fingerprintsMatch,
  formatFingerprint,
  verifyDaemonIdentity,
} from "./device-identity.js";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

/** Stands in for `POST /api/identity/proof`, exactly as the daemon answers it. */
function daemonProofServer(options: {
  serverId?: string;
  /** Sign with a different key than the one advertised. */
  signWith?: ReturnType<typeof generateKeyPair>;
  advertise?: ReturnType<typeof generateKeyPair>;
  status?: number;
} = {}) {
  const keyPair = options.advertise ?? generateKeyPair();
  const signingKey = options.signWith ?? keyPair;
  const publicKeyB64 = exportPublicKey(keyPair.publicKey);
  const fetchImpl = async (_url: string, init?: { body?: string }) => {
    if (options.status && options.status !== 200) {
      return new Response("{}", { status: options.status });
    }
    const body = JSON.parse(init?.body ?? "{}") as {
      challengeB64: string;
      clientPublicKeyB64: string;
    };
    const shared = deriveSharedKey(
      signingKey.secretKey,
      importPublicKey(body.clientPublicKeyB64),
    );
    const proofB64 = bytesToBase64(new Uint8Array(encrypt(shared, body.challengeB64)));
    return new Response(
      JSON.stringify({
        serverId: options.serverId ?? "server-1",
        daemonPublicKeyB64: exportPublicKey(signingKey.publicKey),
        fingerprint: daemonKeyFingerprint(exportPublicKey(signingKey.publicKey)),
        proofB64,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  return { keyPair, publicKeyB64, fingerprint: daemonKeyFingerprint(publicKeyB64), fetchImpl };
}

describe("verifyDaemonIdentity", () => {
  it("accepts a daemon that proves it holds the key behind the link's fingerprint", async () => {
    const daemon = daemonProofServer();
    const verified = await verifyDaemonIdentity({
      endpoint: "10.0.0.5:9999",
      expectedFingerprint: daemon.fingerprint,
      fetchImpl: daemon.fetchImpl,
    });
    expect(verified.serverId).toBe("server-1");
    expect(verified.fingerprint).toBe(daemon.fingerprint);
  });

  it("refuses a daemon whose key hashes to a different fingerprint", async () => {
    const daemon = daemonProofServer();
    const other = daemonProofServer();
    await expect(
      verifyDaemonIdentity({
        endpoint: "10.0.0.5:9999",
        expectedFingerprint: other.fingerprint,
        fetchImpl: daemon.fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "fingerprint_mismatch" });
  });

  it("refuses a known serverId whose key changed", async () => {
    const daemon = daemonProofServer();
    const previous = daemonProofServer();
    const error = await verifyDaemonIdentity({
      endpoint: "10.0.0.5:9999",
      expectedFingerprint: daemon.fingerprint,
      knownFingerprint: previous.fingerprint,
      fetchImpl: daemon.fetchImpl,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DaemonIdentityError);
    expect((error as DaemonIdentityError).code).toBe("server_key_changed");
    expect((error as DaemonIdentityError).actualFingerprint).toBe(daemon.fingerprint);
  });

  it("accepts a known serverId that still holds the same key", async () => {
    const daemon = daemonProofServer();
    await expect(
      verifyDaemonIdentity({
        endpoint: "10.0.0.5:9999",
        expectedFingerprint: daemon.fingerprint,
        knownFingerprint: daemon.fingerprint,
        fetchImpl: daemon.fetchImpl,
      }),
    ).resolves.toMatchObject({ serverId: "server-1" });
  });

  it("reports an unreachable daemon rather than a proof failure", async () => {
    await expect(
      verifyDaemonIdentity({
        endpoint: "10.0.0.5:9999",
        expectedFingerprint: "sha256:whatever",
        fetchImpl: () => Promise.reject(new Error("connect ECONNREFUSED")),
      }),
    ).rejects.toMatchObject({ code: "unreachable" });
  });

  it("reports HTTP failures as unreachable", async () => {
    const daemon = daemonProofServer({ status: 429 });
    await expect(
      verifyDaemonIdentity({
        endpoint: "10.0.0.5:9999",
        expectedFingerprint: daemon.fingerprint,
        fetchImpl: daemon.fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "unreachable" });
  });
});

describe("fingerprint helpers", () => {
  it("matches across the prefixed and bare spellings", () => {
    expect(fingerprintsMatch("sha256:abc", "abc")).toBe(true);
    expect(fingerprintsMatch("sha256:abc", "sha256:abd")).toBe(false);
    expect(fingerprintsMatch("", "")).toBe(false);
  });

  it("groups a fingerprint for reading aloud", () => {
    expect(formatFingerprint("sha256:abcdefgh")).toBe("abcd efgh");
  });
});
