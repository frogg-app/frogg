import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  daemonKeyFingerprint,
  formatPairingCode,
  normalizePairingCode,
} from "@frogg/protocol/device-access";
import {
  decrypt,
  deriveSharedKey,
  exportPublicKey,
  generateKeyPair,
  importPublicKey,
} from "@frogg/relay/e2ee";

import { hashDaemonPassword } from "./auth.js";
import { LOCAL_TOKEN_FILENAME } from "./local-token.js";
import { createTestFroggDaemon, type TestFroggDaemon } from "./test-utils/frogg-daemon.js";

/**
 * The device-access HTTP surface: identity proof, the three ways to get a
 * credential, and the gate on `/api/setup/offer`.
 */
describe("device access routes", () => {
  let daemon: TestFroggDaemon | null = null;

  afterEach(async () => {
    await daemon?.close();
    daemon = null;
  });

  async function start(options: { claimMode?: boolean; password?: string } = {}) {
    daemon = await createTestFroggDaemon({
      mcpEnabled: false,
      claimMode: options.claimMode,
      ...(options.password ? { auth: { password: hashDaemonPassword(options.password) } } : {}),
    });
    return { handle: daemon, base: `http://127.0.0.1:${daemon.port}` };
  }

  function localToken(handle: TestFroggDaemon): string {
    return readFileSync(path.join(handle.froggHome, LOCAL_TOKEN_FILENAME), "utf8").trim();
  }

  async function post(base: string, route: string, body?: unknown, token?: string) {
    const response = await fetch(`${base}${route}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json().catch(() => null)) as never };
  }

  test("proves the daemon holds the key behind the fingerprint in the link", async () => {
    const { base } = await start();
    const client = generateKeyPair();
    const challenge = Buffer.from("a-random-32-byte-challenge-value");

    const { status, body } = await post(base, "/api/identity/proof", {
      challengeB64: challenge.toString("base64"),
      clientPublicKeyB64: exportPublicKey(client.publicKey),
    });

    expect(status).toBe(200);
    const proof = body as { daemonPublicKeyB64: string; fingerprint: string; proofB64: string };
    // The fingerprint is derived from the key the daemon just handed over, so a
    // client can check it against the one printed in its pairing link.
    expect(proof.fingerprint).toBe(daemonKeyFingerprint(proof.daemonPublicKeyB64));
    const shared = deriveSharedKey(client.secretKey, importPublicKey(proof.daemonPublicKeyB64));
    const opened = Buffer.from(
      // Buffer pools its backing store, so copy before handing over an ArrayBuffer.
      decrypt(shared, new Uint8Array(Buffer.from(proof.proofB64, "base64")).buffer),
    ).toString();
    expect(Buffer.from(opened, "base64").toString()).toBe(challenge.toString());
  });

  test("rejects a proof request with a junk client key", async () => {
    const { base } = await start();
    const { status } = await post(base, "/api/identity/proof", {
      challengeB64: "Y2hhbGxlbmdl",
      clientPublicKeyB64: "not-a-key",
    });
    expect(status).toBe(400);
  });

  test("claim mode: the first client becomes owner and the second is refused", async () => {
    const { base } = await start({ claimMode: true });

    const first = await post(base, "/api/setup/claim", { claim: true, deviceName: "Laptop" });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ role: "owner", deviceName: "Laptop" });

    const second = await post(base, "/api/setup/claim", { claim: true, deviceName: "Attacker" });
    expect(second.status).toBe(409);
  });

  test("claiming is refused outright when claim mode is off", async () => {
    const { base } = await start({ claimMode: false });
    expect((await post(base, "/api/setup/claim", { claim: true })).status).toBe(409);
  });

  test("a pairing code pairs exactly one device, with the code's role", async () => {
    const ctx = await start({ claimMode: true });
    const owner = await post(ctx.base, "/api/setup/claim", { claim: true });
    const credential = (owner.body as { credential: string }).credential;
    const code = ctx.handle.daemon.pairingCodes.issue({ role: "viewer" }).code;

    const redeemed = await post(ctx.base, "/api/setup/claim", {
      pairingCode: formatPairingCode(code),
      deviceName: "Phone",
    });
    expect(redeemed.status).toBe(201);
    expect(redeemed.body).toMatchObject({ role: "viewer", deviceName: "Phone" });

    // Single use.
    expect((await post(ctx.base, "/api/setup/claim", { pairingCode: code })).status).toBe(403);
    expect(credential).toBeTruthy();
  });

  test("rejects a claim that names more than one way in", async () => {
    const { base } = await start({ claimMode: true });
    expect(
      (await post(base, "/api/setup/claim", { claim: true, pairingCode: "ABCD1234" })).status,
    ).toBe(400);
  });

  test("owner approval: the requester polls, the owner decides, the device is minted", async () => {
    const ctx = await start({ claimMode: true });
    await post(ctx.base, "/api/setup/claim", { claim: true });

    const created = await post(ctx.base, "/api/setup/request", { deviceName: "Tablet" });
    expect(created.status).toBe(201);
    const { pollId, matchCode } = created.body as { pollId: string; matchCode: string };
    expect(normalizePairingCode(`${matchCode}0000`)).toBeTruthy();

    const pending = await fetch(`${ctx.base}/api/setup/request/${pollId}`);
    expect((await pending.json()).status).toBe("pending");

    const [request] = ctx.handle.daemon.pairingRequests.list();
    expect(request?.deviceName).toBe("Tablet");
    ctx.handle.daemon.pairingRequests.decide({ id: request!.id, decision: "approve" });

    const approved = await (await fetch(`${ctx.base}/api/setup/request/${pollId}`)).json();
    expect(approved.status).toBe("approved");
    expect(approved.result).toMatchObject({ role: "operator", deviceName: "Tablet" });

    // The outcome is collected exactly once, so a leaked pollId cannot be replayed.
    expect((await (await fetch(`${ctx.base}/api/setup/request/${pollId}`)).json()).status).toBe(
      "expired",
    );
  });

  test("a denied request never mints a device", async () => {
    const ctx = await start({ claimMode: true });
    await post(ctx.base, "/api/setup/claim", { claim: true });
    const created = await post(ctx.base, "/api/setup/request", { deviceName: "Tablet" });
    const { pollId } = created.body as { pollId: string };
    const [request] = ctx.handle.daemon.pairingRequests.list();
    ctx.handle.daemon.pairingRequests.decide({ id: request!.id, decision: "deny" });
    expect((await (await fetch(`${ctx.base}/api/setup/request/${pollId}`)).json()).status).toBe(
      "denied",
    );
    expect(ctx.handle.daemon.claimStore.listDevices()).toHaveLength(1);
  });

  test("password login exchanges the password for a revocable device credential", async () => {
    const { base } = await start({ password: "correct-horse" });

    expect((await post(base, "/api/auth/login", { password: "wrong" })).status).toBe(401);
    const login = await post(base, "/api/auth/login", {
      password: "correct-horse",
      deviceName: "Desktop",
    });
    expect(login.status).toBe(201);
    expect(login.body).toMatchObject({ role: "owner", deviceName: "Desktop" });
    // The client keeps a token, not the password.
    expect((login.body as { credential: string }).credential).not.toBe("correct-horse");
  });

  test("/api/setup/offer needs a credential once the daemon is claimed", async () => {
    const ctx = await start({ claimMode: true });
    // Unclaimed: the bootstrap case the claim gate itself drives.
    expect((await post(ctx.base, "/api/setup/offer")).status).toBe(200);

    const owner = await post(ctx.base, "/api/setup/claim", { claim: true });
    const credential = (owner.body as { credential: string }).credential;

    // Claimed and loopback — locality alone is no longer enough.
    expect((await post(ctx.base, "/api/setup/offer")).status).toBe(401);
    expect((await post(ctx.base, "/api/setup/offer", undefined, credential)).status).toBe(200);
    expect(
      (await post(ctx.base, "/api/setup/offer", undefined, localToken(ctx.handle))).status,
    ).toBe(200);
    expect((await post(ctx.base, "/api/setup/offer", undefined, "nonsense")).status).toBe(401);
  });
});
