import { WebSocket } from "ws";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { readLocalToken } from "./local-token.js";
import { DaemonClient } from "./test-utils/daemon-client.js";
import { createTestFroggDaemon } from "./test-utils/frogg-daemon.js";

const originalEnv = { ...process.env };
const CORRECT_PASSWORD_HASH = "$2b$12$OLxyuuP9uLK30Uzc4wQX0O6liuU/Q1t5P2b0Ebf36mULvpVK3DRZW";

function connectWebSocket(params: {
  port: number;
  protocol?: string;
}): Promise<{ ws: WebSocket; protocol: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${params.port}/ws`,
      params.protocol ? [params.protocol] : undefined,
    );
    ws.once("open", () => resolve({ ws, protocol: ws.protocol }));
    ws.once("error", reject);
  });
}

async function expectWebSocketCloses(params: {
  port: number;
  protocol?: string;
  code: number;
  reason: string;
}): Promise<void> {
  const { ws } = await connectWebSocket(params);
  await expect(
    new Promise<{ code: number; reason: string }>((resolve) => {
      ws.once("close", (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    }),
  ).resolves.toEqual({
    code: params.code,
    reason: params.reason,
  });
}

describe("daemon bearer auth", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env = { ...originalEnv, FROGG_SUPERVISED: "0" };
  });

  test("refuses tokenless loopback HTTP and WebSocket; the local token registers a device", async () => {
    const daemonHandle = await createTestFroggDaemon();
    const clients: DaemonClient[] = [];
    try {
      const response = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/status`);
      expect(response.status).toBe(401);
      await expectWebSocketCloses({
        port: daemonHandle.port,
        code: 4401,
        reason: "Pairing required",
      });

      const localToken = readLocalToken(daemonHandle.froggHome) ?? undefined;
      const connect = async (clientId: string) => {
        const client = new DaemonClient({
          url: `ws://127.0.0.1:${daemonHandle.port}/ws`,
          password: localToken,
          clientId,
          deviceName: "Host CLI",
        });
        clients.push(client);
        await client.connect();
        return client;
      };
      const cli = await connect("clid_host_cli");
      await expect(cli.getDaemonPairingOffer()).resolves.toMatchObject({
        relayEnabled: expect.any(Boolean),
      });
      await connect("clid_host_cli");
      const devices = daemonHandle.daemon.claimStore.listDevices();
      expect(devices).toEqual([
        expect.objectContaining({
          name: "Host CLI",
          pairedVia: "local",
          role: "owner",
        }),
      ]);
      // A local registration does not claim the daemon: pairing stays open.
      expect(daemonHandle.daemon.claimStore.isClaimed()).toBe(false);
    } finally {
      for (const client of clients) await client.close().catch(() => undefined);
      await daemonHandle.close();
    }
  });

  test("requires Authorization bearer on protected HTTP routes when password is configured", async () => {
    const daemonHandle = await createTestFroggDaemon({
      auth: { password: CORRECT_PASSWORD_HASH },
    });
    try {
      const missing = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/status`);
      expect(missing.status).toBe(401);

      const wrong = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/status`, {
        headers: { Authorization: "Bearer wrong-password" },
      });
      expect(wrong.status).toBe(401);

      const correct = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/status`, {
        headers: { Authorization: "Bearer correct-password" },
      });
      expect(correct.status).toBe(200);
    } finally {
      await daemonHandle.close();
    }
  });

  test("allows file downloads with only a capability token when password is configured", async () => {
    const daemonHandle = await createTestFroggDaemon({
      auth: { password: CORRECT_PASSWORD_HASH },
    });
    try {
      // No bearer at all: the route is reachable, but the download token store
      // rejects the request because no token was supplied (400, not 401).
      const missingToken = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/files/download`);
      expect(missingToken.status).toBe(400);

      // An invalid token is rejected by the token store (403, not 401) — proving
      // the token, not the daemon password, is what guards this route.
      const invalidToken = await fetch(
        `http://127.0.0.1:${daemonHandle.port}/api/files/download?token=invalid-token`,
      );
      expect(invalidToken.status).toBe(403);
    } finally {
      await daemonHandle.close();
    }
  });

  test("bypasses bearer auth for preflight and liveness endpoints", async () => {
    const daemonHandle = await createTestFroggDaemon({
      auth: { password: CORRECT_PASSWORD_HASH },
    });
    try {
      const preflight = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/files/download`, {
        method: "OPTIONS",
        headers: { Origin: "https://app.example.test" },
      });
      expect(preflight.status).toBe(204);

      const health = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/health`);
      expect(health.status).toBe(200);

      const status = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/status`);
      expect(status.status).toBe(401);
    } finally {
      await daemonHandle.close();
    }
  });

  test("closes WebSocket connections with readable auth failures when password is configured", async () => {
    const daemonHandle = await createTestFroggDaemon({
      auth: { password: CORRECT_PASSWORD_HASH },
    });
    try {
      await expectWebSocketCloses({
        port: daemonHandle.port,
        code: 4401,
        reason: "Password required",
      });
      await expectWebSocketCloses({
        port: daemonHandle.port,
        protocol: "frogg.bearer.wrong-password",
        code: 4401,
        reason: "Incorrect password",
      });

      const { ws, protocol } = await connectWebSocket({
        port: daemonHandle.port,
        protocol: "frogg.bearer.correct-password",
      });
      expect(protocol).toBe("frogg.bearer.correct-password");
      ws.close();
    } finally {
      await daemonHandle.close();
    }
  });

  test("an unrecognised bearer is 401 from loopback even without a password", async () => {
    const daemonHandle = await createTestFroggDaemon();
    try {
      const base = `http://127.0.0.1:${daemonHandle.port}`;
      expect((await fetch(`${base}/api/status`)).status).toBe(401);
      const stale = await fetch(`${base}/api/status`, {
        headers: { Authorization: "Bearer revoked-or-stale" },
      });
      expect(stale.status).toBe(401);
      await expectWebSocketCloses({
        port: daemonHandle.port,
        protocol: "frogg.bearer.revoked-or-stale",
        code: 4401,
        reason: "Pairing required",
      });

      const localToken = readLocalToken(daemonHandle.froggHome);
      expect(localToken).toBeTruthy();
      const local = await fetch(`${base}/api/status`, {
        headers: { Authorization: `Bearer ${localToken}` },
      });
      expect(local.status).toBe(200);
    } finally {
      await daemonHandle.close();
    }
  });
});
