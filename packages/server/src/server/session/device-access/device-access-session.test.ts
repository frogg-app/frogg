import pino from "pino";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { SessionOutboundMessage } from "../../messages.js";
import { createClaimStore } from "../../claim-store.js";
import { createDeviceAccessService } from "../../device-access-service.js";
import { createPairingCodeStore } from "../../pairing-code-store.js";
import { createPairingRequestStore } from "../../pairing-request-store.js";
import { createPresenceService } from "../../presence-service.js";
import { DeviceAccessSession } from "./device-access-session.js";

const homes: string[] = [];
const logger = pino({ level: "silent" });

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function harness(options: { withServices?: boolean; role?: "owner" | "operator" | "viewer" } = {}) {
  const withServices = options.withServices !== false;
  const home = mkdtempSync(path.join(os.tmpdir(), "frogg-device-access-session-"));
  homes.push(home);
  const claimStore = createClaimStore(home);
  const emitted: SessionOutboundMessage[] = [];
  const presence = withServices ? createPresenceService() : null;
  const service = withServices
    ? createDeviceAccessService({
        claimStore,
        pairingCodes: createPairingCodeStore(),
        pairingRequests: createPairingRequestStore(),
        serverId: "server-1",
        daemonPublicKeyB64: Buffer.from("key").toString("base64"),
        endpoints: () => [{ host: "10.0.0.2", port: 8790 }],
        deepLinkScheme: "frogg",
        settings: {
          read: () => ({ claimMode: false, trustLan: true, passwordEnabled: false }),
          update: async () => undefined,
          setPasswordHash: async () => undefined,
          overrideControlledPaths: () => [],
        },
        connectedCredentialIds: () => new Set<string>(),
      })
    : null;
  const minted = claimStore.mintPrincipal({
    label: "Desk",
    deviceName: "Desk",
    role: options.role ?? "owner",
  });
  const device = claimStore.getDevice(minted.credentialId)!;
  const session = new DeviceAccessSession({
    host: { emit: (msg) => emitted.push(msg) },
    deviceAccess: service,
    presence,
    caller: () => ({ device }),
    presenceIdentity: () => ({
      participantId: "session-1",
      deviceId: device.id,
      deviceName: device.name,
      clientType: "mobile",
    }),
    logger,
  });
  return { session, emitted, presence, device, claimStore };
}

function payloadOf(message: SessionOutboundMessage | undefined): Record<string, unknown> {
  return (message as { payload: Record<string, unknown> }).payload;
}

describe("device access session", () => {
  test("lists the devices the caller may see", async () => {
    const h = harness();
    await h.session.handleDeviceListRequest({ type: "auth.device.list.request", requestId: "r1" });
    const payload = payloadOf(h.emitted[0]);
    expect(h.emitted[0]!.type).toBe("auth.device.list.response");
    expect(payload.error).toBeNull();
    expect((payload.devices as unknown[]).length).toBe(1);
  });

  test("a refused action comes back as an error on the response, not a throw", async () => {
    const h = harness({ role: "viewer" });
    await h.session.handlePairingCodeCreateRequest({
      type: "auth.pairing_code.create.request",
      requestId: "r2",
    });
    const payload = payloadOf(h.emitted[0]);
    expect(payload.code).toBeNull();
    expect(payload.error).toMatch(/viewer/i);
    // The fingerprint still identifies the daemon, so a client can show it.
    expect(payload.fingerprint).toMatch(/^sha256:/);
  });

  test("a daemon without a device store answers every auth RPC with an error", async () => {
    const h = harness({ withServices: false });
    await h.session.handleDeviceListRequest({ type: "auth.device.list.request", requestId: "r3" });
    await h.session.handleSettingsGetRequest({
      type: "auth.settings.get.request",
      requestId: "r4",
    });
    expect(payloadOf(h.emitted[0]).error).toMatch(/not available/);
    expect(payloadOf(h.emitted[1]).settings).toBeNull();
  });

  test("reporting presence answers, and publishes later changes for that target", async () => {
    const h = harness();
    const target = { kind: "agent", agentId: "agent-1" } as const;
    await h.session.handlePresenceReportRequest({
      type: "presence.report.request",
      requestId: "r5",
      target,
      state: "viewing",
    });
    // The report both answers and echoes the new snapshot back.
    expect(h.emitted.map((message) => message.type)).toContain("presence.report.response");

    h.presence!.report(
      { participantId: "other", deviceId: null, deviceName: "Phone", clientType: "mobile" },
      target,
      "typing",
    );
    const update = h.emitted.at(-1)!;
    expect(update.type).toBe("presence.update");
    expect(payloadOf(update).participants).toHaveLength(2);
  });

  test("a target this connection never reported on does not push updates", async () => {
    const h = harness();
    h.presence!.report(
      { participantId: "other", deviceId: null, deviceName: "Phone", clientType: "mobile" },
      { kind: "terminal", terminalId: "term-1" },
      "viewing",
    );
    expect(h.emitted).toHaveLength(0);
  });

  test("cleanup takes the connection out of presence for everyone else", async () => {
    const h = harness();
    const target = { kind: "agent", agentId: "agent-1" } as const;
    await h.session.handlePresenceReportRequest({
      type: "presence.report.request",
      requestId: "r6",
      target,
      state: "viewing",
    });
    h.session.cleanup();
    expect(h.presence!.snapshot(target, null).participants).toEqual([]);
  });

  test("a daemon-observed activity only counts for a target the client is on", async () => {
    const h = harness();
    const target = { kind: "agent", agentId: "agent-1" } as const;
    h.session.noteActivity(target, "sending");
    expect(h.presence!.snapshot(target, null).participants).toEqual([]);

    await h.session.handlePresenceReportRequest({
      type: "presence.report.request",
      requestId: "r7",
      target,
      state: "viewing",
    });
    h.session.noteActivity(target, "sending");
    expect(h.presence!.snapshot(target, null).participants[0]!.activity).toBe("sending");
  });

  test("presence.get on a daemon without presence is an empty snapshot and an error", async () => {
    const h = harness({ withServices: false });
    await h.session.handlePresenceGetRequest({
      type: "presence.get.request",
      requestId: "r8",
      target: { kind: "agent", agentId: "agent-1" },
    });
    const payload = payloadOf(h.emitted[0]);
    expect((payload.snapshot as { participants: unknown[] }).participants).toEqual([]);
    expect(payload.error).toMatch(/not available/);
  });

  test("presence.list_connections puts this connection first, then oldest first", async () => {
    const connection = (participantId: string, connectedAt: string, isSelf: boolean) => ({
      participantId,
      clientKey: `key-${participantId}`,
      deviceId: null,
      deviceName: participantId,
      paired: false,
      role: null,
      clientType: "mobile",
      appVersion: null,
      connectedAt,
      targets: [],
      isSelf,
    });
    const emitted: SessionOutboundMessage[] = [];
    const session = new DeviceAccessSession({
      host: { emit: (msg) => emitted.push(msg) },
      deviceAccess: null,
      presence: null,
      caller: () => ({ device: null }),
      presenceIdentity: () => ({
        participantId: "b",
        deviceId: null,
        deviceName: "",
        clientType: null,
      }),
      listConnections: () => [
        connection("c", "2026-01-03T00:00:00.000Z", false),
        connection("a", "2026-01-01T00:00:00.000Z", false),
        connection("b", "2026-01-02T00:00:00.000Z", true),
      ],
      logger,
    });
    await session.handleListConnectionsRequest({
      type: "presence.list_connections.request",
      requestId: "r9",
    });
    const payload = payloadOf(emitted[0]);
    expect(payload.error).toBeNull();
    expect(
      (payload.connections as { participantId: string }[]).map((c) => c.participantId),
    ).toEqual(["b", "a", "c"]);
  });

  test("a presence report can rename the reporting client, stripped of control characters", async () => {
    const names: string[] = [];
    const session = new DeviceAccessSession({
      host: { emit: () => undefined },
      deviceAccess: null,
      presence: createPresenceService(),
      caller: () => ({ device: null }),
      presenceIdentity: () => ({
        participantId: "a",
        deviceId: null,
        deviceName: "",
        clientType: null,
      }),
      onSelfName: (name) => names.push(name),
      logger,
    });
    await session.handlePresenceReportRequest({
      type: "presence.report.request",
      requestId: "r10",
      target: { kind: "agent", agentId: "agent-1" },
      state: "viewing",
      deviceName: "  Paz\n laptop ",
    });
    await session.handlePresenceReportRequest({
      type: "presence.report.request",
      requestId: "r11",
      target: { kind: "agent", agentId: "agent-1" },
      state: "viewing",
      deviceName: "   ",
    });
    expect(names).toEqual(["Paz laptop"]);
  });
});
