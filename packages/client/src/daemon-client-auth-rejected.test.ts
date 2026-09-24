import { afterEach, expect, test, vi } from "vitest";
import { DaemonClient, type DaemonTransport } from "./daemon-client";

function createMockTransport() {
  let onMessage: (data: unknown) => void = () => {};
  let onOpen: () => void = () => {};
  let onClose: (event?: unknown) => void = () => {};
  let onError: (event?: unknown) => void = () => {};
  const transport: DaemonTransport = {
    send: () => {},
    close: () => {},
    onMessage: (handler) => {
      onMessage = handler;
      return () => {};
    },
    onOpen: (handler) => {
      onOpen = handler;
      return () => {};
    },
    onClose: (handler) => {
      onClose = handler;
      return () => {};
    },
    onError: (handler) => {
      onError = handler;
      return () => {};
    },
  };
  return {
    transport,
    triggerOpen: () => {
      onOpen();
      onMessage(
        JSON.stringify({
          type: "session",
          message: {
            type: "status",
            payload: { status: "server_info", serverId: "srv_test", hostname: null, version: null },
          },
        }),
      );
    },
    triggerClose: (event?: unknown) => onClose(event),
    triggerError: (event?: unknown) => onError(event),
  };
}

const clients: DaemonClient[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

function createHarness(options: { password?: string } = {}) {
  vi.useFakeTimers();
  const transports: Array<ReturnType<typeof createMockTransport>> = [];
  const client = new DaemonClient({
    url: "ws://daemon.test/ws",
    clientId: "clsk_test",
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...(options.password !== undefined ? { password: options.password } : {}),
    reconnect: { enabled: true, baseDelayMs: 5, maxDelayMs: 5 },
    transportFactory: () => {
      const next = createMockTransport();
      transports.push(next);
      return next.transport;
    },
  });
  clients.push(client);
  return { client, transports };
}

test("4401 with a stored credential stops reconnecting and reports a stale credential", async () => {
  const { client, transports } = createHarness({ password: "dev_stale" });
  const connectResult = client.connect().catch((error: Error) => error);
  transports[0]!.triggerClose({ code: 4401, reason: "Device access revoked" });

  expect(await connectResult).toBeInstanceOf(Error);
  expect(client.getConnectionState()).toEqual({
    status: "disconnected",
    reason: "Device access revoked",
  });
  expect(client.lastErrorInfo).toEqual({
    code: "pairing_required",
    credentialRejected: true,
    reason: "Device access revoked",
  });

  await vi.advanceTimersByTimeAsync(1_000);
  expect(transports).toHaveLength(1);
  expect(client.getConnectionState().status).toBe("disconnected");
});

test("4401 on an established session also stops the reconnect loop", async () => {
  const { client, transports } = createHarness({ password: "dev_stale" });
  const connectPromise = client.connect();
  transports[0]!.triggerOpen();
  await connectPromise;

  transports[0]!.triggerClose({ code: 4401, reason: "Incorrect password" });
  await vi.advanceTimersByTimeAsync(1_000);

  expect(transports).toHaveLength(1);
  expect(client.lastErrorInfo).toMatchObject({
    code: "pairing_required",
    credentialRejected: true,
  });
});

test("4401 without a credential reports pairing required but no stale credential", async () => {
  const { client, transports } = createHarness();
  void client.connect().catch(() => undefined);
  transports[0]!.triggerClose({ code: 4401, reason: "Password required" });
  await vi.advanceTimersByTimeAsync(1_000);

  expect(transports).toHaveLength(1);
  expect(client.lastErrorInfo).toEqual({
    code: "pairing_required",
    credentialRejected: false,
    reason: "Password required",
  });
});

test("rate-limited 4401 and transient closes keep the credential and reconnect", async () => {
  const { client, transports } = createHarness({ password: "dev_ok" });
  void client.connect().catch(() => undefined);
  transports[0]!.triggerClose({ code: 4401, reason: "Too many failed attempts" });
  expect(client.lastErrorInfo).toBeNull();
  await vi.advanceTimersByTimeAsync(10);
  expect(transports).toHaveLength(2);

  transports[1]!.triggerClose({ code: 1006, reason: "" });
  expect(client.lastErrorInfo).toBeNull();
  await vi.advanceTimersByTimeAsync(10);
  expect(transports).toHaveLength(3);
});

test("ensureConnected after a 4401 makes one fresh attempt", async () => {
  const { client, transports } = createHarness({ password: "dev_stale" });
  void client.connect().catch(() => undefined);
  transports[0]!.triggerClose({ code: 4401, reason: "Incorrect password" });
  client.ensureConnected();
  expect(transports).toHaveLength(2);
});

test.each([
  ["Node ws", "Unexpected server response: 401"],
  ["Android OkHttp", "Expected HTTP 101 response but was '401 Unauthorized'"],
  ["iOS", "Received bad response code from server: 401."],
  ["desktop shell", "Failed to connect to ssh host: Unexpected server response: 401"],
])("HTTP 401 on the upgrade (%s) is treated like 4401", async (_label, message) => {
  const { client, transports } = createHarness({ password: "dev_stale" });
  const connectResult = client.connect().catch((error: Error) => error);
  transports[0]!.triggerError(new Error(message));
  transports[0]!.triggerClose({ code: 1006, reason: "" });

  expect(await connectResult).toBeInstanceOf(Error);
  expect(client.lastErrorInfo).toEqual({
    code: "pairing_required",
    credentialRejected: true,
    reason: message,
  });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(transports).toHaveLength(1);
});

test("HTTP 429 or other upgrade failures keep reconnecting", async () => {
  const { client, transports } = createHarness({ password: "dev_ok" });
  void client.connect().catch(() => undefined);
  transports[0]!.triggerError(new Error("Unexpected server response: 429"));
  expect(client.lastErrorInfo).toBeNull();
  await vi.advanceTimersByTimeAsync(10);
  expect(transports).toHaveLength(2);

  transports[1]!.triggerError(new Error("Unexpected server response: 4010"));
  expect(client.lastErrorInfo).toBeNull();
  await vi.advanceTimersByTimeAsync(10);
  expect(transports).toHaveLength(3);
});
