import type { DaemonRuntimeConfig } from "./session/daemon/daemon-session.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Server as HTTPServer } from "http";
import type pino from "pino";
import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentStorage } from "./agent/agent-storage.js";
import type { DownloadTokenStore } from "./file-download/token-store.js";
import type { DaemonConfigStore } from "./daemon-config-store.js";
import type { CheckoutDiffManager } from "./checkout-diff-manager.js";
import type { WorkspaceAutoName } from "./workspace-auto-name.js";
import { asInternals, createStub } from "./test-utils/class-mocks.js";
import { createProviderSnapshotManagerStub } from "./test-utils/session-stubs.js";
import {
  asUint8Array,
  decodeTerminalStreamFrame,
  encodeTerminalStreamFrame,
  TerminalStreamOpcode,
} from "@frogg/protocol/terminal-stream-protocol";
import { CLIENT_CAPS } from "@frogg/protocol/client-capabilities";
import type { DaemonAuthConfig } from "./auth.js";
import type { DaemonAccessPolicy } from "./access-policy.js";
import type { DeviceAccessService } from "./device-access-service.js";
import type { PresenceService } from "./presence-service.js";
import { OWNER_PERMISSIONS } from "./authorization/index.js";
import type { SessionAdmission } from "./websocket-server.js";

type SocketListener = (...args: unknown[]) => void;

const wsModuleMock = vi.hoisted(() => {
  class MockWebSocketServer {
    static instances: MockWebSocketServer[] = [];
    readonly handlers = new Map<string, (...args: unknown[]) => void>();

    constructor(_options: unknown) {
      MockWebSocketServer.instances.push(this);
    }

    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, handler);
      return this;
    }

    close() {
      // no-op
    }
  }

  return { MockWebSocketServer };
});

const sessionMock = vi.hoisted(() => {
  const instances: MockSession[] = [];

  class MockSession {
    cleanup = vi.fn(async () => {});
    handleMessage = vi.fn(async () => {});
    handleBinaryFrame = vi.fn((_frame: unknown) => {});
    supports = vi.fn((capability: string) => this.args.clientCapabilities?.[capability] === true);
    updateClientCapabilities = vi.fn((capabilities: Record<string, unknown> | null) => {
      this.args.clientCapabilities = capabilities;
    });
    clearAgentTimelineSubscription = vi.fn();
    getClientActivity = vi.fn(() => null);
    getSessionId = vi.fn(() => "mock-session-id");
    getDevice = vi.fn(() => (this.args.device as unknown) ?? null);
    getDeviceId = vi.fn(() => (this.args.device as { id?: string } | null)?.id ?? null);
    getPermissions = vi.fn(() => this.args.permissions as string[]);
    allowsInbound = vi.fn(() => true);
    getRole = vi.fn(() => (this.args.role as string | undefined) ?? "owner");
    setRole = vi.fn((role: string) => {
      this.args.role = role;
    });
    setLocalityTrusted = vi.fn((localityTrusted: boolean) => {
      this.args.localityTrusted = localityTrusted;
    });
    allowsPermission = vi.fn(() => true);
    publish = vi.fn((message: unknown) => {
      const onMessage = this.args.onMessage as ((message: unknown) => void) | undefined;
      onMessage?.(message);
    });
    resetPeakInflight = vi.fn(() => {});
    getRuntimeMetrics = vi.fn(() => ({
      checkoutDiffTargetCount: 0,
      checkoutDiffSubscriptionCount: 0,
      checkoutDiffWatcherCount: 0,
      checkoutDiffFallbackRefreshTargetCount: 0,
      terminalDirectorySubscriptionCount: 0,
      terminalSubscriptionCount: 0,
      inflightRequests: 0,
      peakInflightRequests: 0,
    }));
    readonly args: Record<string, unknown>;

    constructor(args: Record<string, unknown>) {
      this.args = args;
      instances.push(this);
    }
  }

  return { MockSession, instances };
});

vi.mock("ws", () => ({
  WebSocketServer: wsModuleMock.MockWebSocketServer,
}));

vi.mock("./session.js", () => ({
  Session: sessionMock.MockSession,
}));

vi.mock("./push/index.js", () => ({
  createPushNotifications: () => ({
    renew: () => undefined,
    revoke: () => undefined,
    send: async () => undefined,
  }),
}));

import { z } from "zod";
import { VoiceAssistantWebSocketServer } from "./websocket-server";
import { admissionForPrincipal } from "./authorization/admission.js";
import { createMemoryDeviceRoleStore } from "./authorization/device-role-store.js";
import type { DeviceRole } from "./authorization/index.js";
import type { DeviceRecord } from "./claim-store.js";
import { DAEMON_PERMISSIONS, parseServerInfoStatusPayload } from "./messages.js";
import type { SpeechReadinessSnapshot } from "./speech/speech-runtime.js";

interface WebSocketServerInternals {
  attachSocket(ws: unknown, req: unknown): Promise<void>;
}

const TEST_DAEMON_VERSION = "1.2.3-test";

const WireEnvelopeSchema = z.object({
  type: z.string().optional(),
  message: z
    .object({
      type: z.string().optional(),
      payload: z.unknown().optional(),
    })
    .optional(),
});

function parseSentEnvelope(data: unknown): z.infer<typeof WireEnvelopeSchema> {
  if (typeof data !== "string") throw new Error("Expected string frame");
  return WireEnvelopeSchema.parse(JSON.parse(data));
}

function sentEnvelopes(socket: MockSocket): z.infer<typeof WireEnvelopeSchema>[] {
  return socket.sent.filter((data) => typeof data === "string").map(parseSentEnvelope);
}

function sentServerInfoEnvelopes(socket: MockSocket): z.infer<typeof WireEnvelopeSchema>[] {
  return sentEnvelopes(socket).filter(
    (envelope) => parseServerInfoStatusPayload(envelope.message?.payload) !== null,
  );
}

function sentBinaryFrames(socket: MockSocket): Uint8Array[] {
  return socket.sent.map(asUint8Array).filter((frame): frame is Uint8Array => frame !== null);
}

function sentTerminalFrames(
  socket: MockSocket,
): NonNullable<ReturnType<typeof decodeTerminalStreamFrame>>[] {
  return sentBinaryFrames(socket)
    .map(decodeTerminalStreamFrame)
    .filter(
      (frame): frame is NonNullable<ReturnType<typeof decodeTerminalStreamFrame>> => frame !== null,
    );
}

const BinaryFrameSchema = z.object({
  kind: z.literal("terminal"),
  frame: z.object({
    opcode: z.number(),
    slot: z.number(),
    payload: z.instanceof(Uint8Array),
  }),
});

class MockSocket {
  readyState = 1;
  bufferedAmount = 0;
  sent: unknown[] = [];
  private listeners = new Map<string, SocketListener[]>();

  on(event: "message" | "close" | "error", listener: SocketListener): void {
    const handlers = this.listeners.get(event) ?? [];
    handlers.push(listener);
    this.listeners.set(event, handlers);
  }

  once(event: "close" | "error", listener: SocketListener): void {
    const wrapped: SocketListener = (...args) => {
      this.off(event, wrapped);
      listener(...args);
    };
    this.on(event, wrapped);
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.emit("close", code ?? 1000, reason ?? "");
  }

  emit(event: "message" | "close" | "error", ...args: unknown[]): void {
    const handlers = this.listeners.get(event) ?? [];
    for (const handler of handlers.slice()) {
      handler(...args);
    }
  }

  private off(event: "close" | "error", listener: SocketListener): void {
    const handlers = this.listeners.get(event) ?? [];
    this.listeners.set(
      event,
      handlers.filter((handler) => handler !== listener),
    );
  }
}

function createLogger() {
  const logger = {
    child: vi.fn(() => logger),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return logger;
}

function createWorkspaceAutoNameStub(): WorkspaceAutoName {
  return createStub<WorkspaceAutoName>({
    scheduleForWorktree: () => {},
    scheduleForDirectory: () => {},
  });
}

/** Relay hellos need a credential; this stands in for the paired device store. */
const RELAY_DEVICE_TOKEN = "relay-device-token";

function createRelayAuthConfig(): DaemonAuthConfig {
  return {
    access: createStub<DaemonAccessPolicy>({
      isClaimed: () => true,
      findDevice: (token: string) =>
        token === RELAY_DEVICE_TOKEN
          ? {
              id: "cred_relay",
              name: "Relay phone",
              role: "owner" as const,
              // Matches the default admission principal, so switching between
              // the direct and relay paths still resolves to one session.
              principalId: "owner",
              principalLabel: "Relay phone",
              createdAt: new Date(0).toISOString(),
              lastSeenAt: null,
              pairedVia: "pairing_code" as const,
              permissions: [...OWNER_PERMISSIONS],
            }
          : null,
      touchDevice: () => {},
    }),
  };
}

function createServer(options?: {
  speechReadiness?: SpeechReadinessSnapshot | null;
  logger?: ReturnType<typeof createLogger>;
  startPaused?: boolean;
  /** `null` runs the server with no auth at all, so relay hellos are refused. */
  auth?: DaemonAuthConfig | null;
  daemonRuntimeConfig?: DaemonRuntimeConfig;
}) {
  const speechReadiness = options?.speechReadiness ?? null;
  const daemonConfigStore = {
    onApply: vi.fn(() => () => {}),
    onChange: vi.fn(() => () => {}),
  };
  const logger = options?.logger ?? createLogger();
  return new VoiceAssistantWebSocketServer(
    createStub<HTTPServer>({}),
    createStub<pino.Logger>(logger),
    "srv_test",
    createStub<AgentManager>({
      subscribe: vi.fn(() => () => {}),
      setAgentAttentionCallback: vi.fn(),
      getAgent: vi.fn(() => null),
      getMetricsSnapshot: vi.fn(() => ({
        totalAgents: 0,
        idleAgents: 0,
        runningAgents: 0,
        pendingPermissionAgents: 0,
        erroredAgents: 0,
      })),
    }),
    createStub<AgentStorage>({}),
    createStub<DownloadTokenStore>({}),
    "/tmp/frogg-test",
    createStub<DaemonConfigStore>(daemonConfigStore),
    null,
    { allowedOrigins: new Set(), startPaused: options?.startPaused },
    createWorkspaceAutoNameStub(),
    options?.auth === null ? undefined : (options?.auth ?? createRelayAuthConfig()),
    speechReadiness
      ? {
          resolveStt: () => null,
          resolveSttLanguage: () => "en",
          resolveTts: () => null,
          resolveTurnDetection: () => null,
          resolveDictationStt: () => null,
          resolveDictationSttLanguage: () => "en",
          getReadiness: () => speechReadiness,
          onReadinessChange: vi.fn(() => () => {}),
          start: vi.fn(),
          stop: vi.fn(),
          ready: Promise.resolve(),
        }
      : undefined,
    undefined,
    undefined,
    TEST_DAEMON_VERSION,
    undefined,
    undefined,
    undefined,
    createStub<CheckoutDiffManager>({
      subscribe: vi.fn(),
      scheduleRefreshForCwd: vi.fn(),
      getMetrics: vi.fn(() => ({
        checkoutDiffTargetCount: 0,
        checkoutDiffSubscriptionCount: 0,
        checkoutDiffWatcherCount: 0,
        checkoutDiffFallbackRefreshTargetCount: 0,
      })),
      dispose: vi.fn(),
    }),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    createProviderSnapshotManagerStub().manager,
    options?.daemonRuntimeConfig,
  );
}

function createReadySpeechReadinessSnapshot(): SpeechReadinessSnapshot {
  return {
    generatedAt: "2026-02-14T00:00:00.000Z",
    requiredLocalModelIds: [],
    missingLocalModelIds: [],
    download: {
      inProgress: false,
      error: null,
    },
    dictation: {
      enabled: true,
      available: true,
      reasonCode: "ready",
      message: "Dictation is ready.",
      retryable: false,
      missingModelIds: [],
    },
    realtimeVoice: {
      enabled: true,
      available: true,
      reasonCode: "ready",
      message: "Realtime voice is ready.",
      retryable: false,
      missingModelIds: [],
    },
    voiceFeature: {
      enabled: true,
      available: true,
      reasonCode: "ready",
      message: "Voice features are ready.",
      retryable: false,
      missingModelIds: [],
    },
  };
}

function createDownloadInProgressSpeechReadinessSnapshot(): SpeechReadinessSnapshot {
  return {
    generatedAt: "2026-02-14T00:00:00.000Z",
    requiredLocalModelIds: ["parakeet-tdt-0.6b-v2-int8"],
    missingLocalModelIds: ["parakeet-tdt-0.6b-v2-int8"],
    download: {
      inProgress: true,
      error: null,
    },
    dictation: {
      enabled: true,
      available: false,
      reasonCode: "stt_unavailable",
      message: "Dictation is unavailable: speech-to-text service is not ready.",
      retryable: false,
      missingModelIds: [],
    },
    realtimeVoice: {
      enabled: true,
      available: false,
      reasonCode: "stt_unavailable",
      message: "Realtime voice is unavailable: speech-to-text service is not ready.",
      retryable: false,
      missingModelIds: [],
    },
    voiceFeature: {
      enabled: true,
      available: false,
      reasonCode: "model_download_in_progress",
      message:
        "Voice features are unavailable while models download in the background (parakeet-tdt-0.6b-v2-int8).",
      retryable: true,
      missingModelIds: ["parakeet-tdt-0.6b-v2-int8"],
    },
  };
}

function createHelloMessage(
  clientId: string,
  options?: { capabilities?: Record<string, boolean> },
) {
  return {
    type: "hello" as const,
    clientId,
    clientType: "cli" as const,
    protocolVersion: 1,
    auth: { token: RELAY_DEVICE_TOKEN },
    ...(options?.capabilities ? { capabilities: options.capabilities } : {}),
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createDirectRequest() {
  return {
    headers: {
      host: "localhost:9999",
      origin: "http://localhost:9999",
      "user-agent": "vitest",
    },
    socket: {
      remoteAddress: "127.0.0.1",
    },
    url: "/ws",
  };
}

async function attachRelayAndHello(params: {
  server: VoiceAssistantWebSocketServer;
  socket: MockSocket;
  clientId: string;
}) {
  await params.server.attachExternalSocket(params.socket, {
    transport: "relay",
  });
  params.socket.emit("message", JSON.stringify(createHelloMessage(params.clientId)));
  // The relay credential is verified asynchronously before the session opens.
  await flushMicrotasks();
  expect(params.socket.sent.length).toBeGreaterThan(0);
  const envelope = parseSentEnvelope(params.socket.sent[0]);
  expect(envelope.type).toBe("session");
  const serverInfo = parseServerInfoStatusPayload(envelope.message?.payload);
  expect(envelope.message?.type).toBe("status");
  expect(serverInfo).not.toBeNull();
  return serverInfo!;
}

async function attachDirectAndHello(params: {
  server: VoiceAssistantWebSocketServer;
  socket: MockSocket;
  clientId: string;
  /** Admission to attach with; sessions are keyed per device credential. */
  admission?: SessionAdmission;
}) {
  await asInternals<WebSocketServerInternals>(params.server).attachSocket(
    params.socket,
    createDirectRequest(),
    undefined,
    params.admission,
  );
  params.socket.emit("message", JSON.stringify(createHelloMessage(params.clientId)));
  expect(params.socket.sent.length).toBeGreaterThan(0);
  const envelope = parseSentEnvelope(params.socket.sent[0]);
  expect(envelope.type).toBe("session");
  const serverInfo = parseServerInfoStatusPayload(envelope.message?.payload);
  expect(envelope.message?.type).toBe("status");
  expect(serverInfo).not.toBeNull();
  return serverInfo!;
}

function holdNextSessionMessage(session: (typeof sessionMock.instances)[number]): {
  finish: () => void;
} {
  let finish = () => {};
  session.handleMessage.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  return {
    finish: () => finish(),
  };
}

function holdSessionCleanup(session: (typeof sessionMock.instances)[number]): {
  finish: () => void;
} {
  let finish = () => {};
  session.cleanup.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  return {
    finish: () => finish(),
  };
}

describe("relay external socket reconnect behavior", () => {
  beforeEach(() => {
    sessionMock.instances.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("keeps the same session when relay reconnects within grace window", async () => {
    const server = createServer();
    const clientId = "cid-relay-reconnect";

    const socket1 = new MockSocket();
    await attachRelayAndHello({
      server,
      socket: socket1,
      clientId,
    });
    expect(sessionMock.instances).toHaveLength(1);
    const session = sessionMock.instances[0];

    socket1.emit("close", 1006, "");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.cleanup).not.toHaveBeenCalled();

    const socket2 = new MockSocket();
    await attachRelayAndHello({
      server,
      socket: socket2,
      clientId,
    });
    expect(sessionMock.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(session.cleanup).not.toHaveBeenCalled();

    await server.close();
  });

  test("passes hello capabilities through to the created session", async () => {
    const server = createServer();
    const socket = new MockSocket();

    await asInternals<WebSocketServerInternals>(server).attachSocket(socket, createDirectRequest());
    socket.emit(
      "message",
      JSON.stringify(
        createHelloMessage("client-capabilities", {
          capabilities: { [CLIENT_CAPS.reasoningMergeEnum]: true },
        }),
      ),
    );
    expect(sessionMock.instances).toHaveLength(1);
    const session = sessionMock.instances[0];
    expect(session.args.clientCapabilities).toEqual({
      [CLIENT_CAPS.reasoningMergeEnum]: true,
    });

    await server.close();
  });

  test("rejects sockets attached after shutdown begins", async () => {
    const server = createServer();
    const existingSocket = new MockSocket();
    await attachRelayAndHello({
      server,
      socket: existingSocket,
      clientId: "existing-client",
    });

    const heldCleanup = holdSessionCleanup(sessionMock.instances[0]);
    const closePromise = server.close();

    const lateSocket = new MockSocket();
    try {
      await server.attachExternalSocket(lateSocket, { transport: "relay" });
      lateSocket.emit("message", JSON.stringify(createHelloMessage("late-client")));

      expect({
        readyState: lateSocket.readyState,
        sessionCount: sessionMock.instances.length,
      }).toEqual({
        readyState: 3,
        sessionCount: 1,
      });
    } finally {
      heldCleanup.finish();
      await closePromise;
    }
  });

  test("closes pending connection when hello timeout elapses", async () => {
    const server = createServer();

    const socket = new MockSocket();
    let closeCode: number | null = null;
    let closeReason = "";
    socket.on("close", (code: unknown, reason: unknown) => {
      closeCode = typeof code === "number" ? code : null;
      closeReason = typeof reason === "string" ? reason : "";
    });

    await asInternals<WebSocketServerInternals>(server).attachSocket(socket, createDirectRequest());
    await vi.advanceTimersByTimeAsync(15_000);

    expect(closeCode).toBe(4001);
    expect(closeReason).toBe("Hello timeout");
    expect(sessionMock.instances).toHaveLength(0);

    await server.close();
  });

  test("returns server_info when clientId reconnects with existing session", async () => {
    const server = createServer();
    const clientId = "cid-resume-flag";

    const firstSocket = new MockSocket();
    await attachRelayAndHello({
      server,
      socket: firstSocket,
      clientId,
    });

    firstSocket.emit("close", 1006, "");
    await vi.advanceTimersByTimeAsync(1_000);

    const secondSocket = new MockSocket();
    await attachRelayAndHello({
      server,
      socket: secondSocket,
      clientId,
    });

    await server.close();
  });

  test("returns server_info for distinct clientIds", async () => {
    const server = createServer();

    const firstSocket = new MockSocket();
    await attachRelayAndHello({
      server,
      socket: firstSocket,
      clientId: "cid-new-1",
    });

    const secondSocket = new MockSocket();
    await attachRelayAndHello({
      server,
      socket: secondSocket,
      clientId: "cid-new-2",
    });
    expect(sessionMock.instances).toHaveLength(2);

    await server.close();
  });

  test("isolates resumable sessions by principal while sharing hello bootstrap", async () => {
    const server = createServer();
    const clientId = "shared-client-id";
    const ownerSocket = new MockSocket();
    const hubSocket = new MockSocket();

    const ownerInfo = await attachRelayAndHello({
      server,
      socket: ownerSocket,
      clientId,
    });
    await server.attachExternalSocket(
      hubSocket,
      { transport: "hub", hubDaemonId: "daemon-1" },
      { principalId: "hub:daemon-1", permissions: ["hub.execute"] },
    );
    hubSocket.emit("message", JSON.stringify(createHelloMessage(clientId)));
    const hubEnvelope = parseSentEnvelope(hubSocket.sent[0]);
    const hubInfo = parseServerInfoStatusPayload(hubEnvelope.message?.payload);

    expect(sessionMock.instances).toHaveLength(2);
    expect(ownerInfo.permissions).toEqual(DAEMON_PERMISSIONS);
    expect(hubInfo?.permissions).toEqual(["hub.execute"]);
    await server.close();
  });

  test("rejects session messages before hello", async () => {
    const server = createServer();
    const socket = new MockSocket();
    let closeCode: number | null = null;
    let closeReason = "";
    socket.on("close", (code: unknown, reason: unknown) => {
      closeCode = typeof code === "number" ? code : null;
      closeReason = typeof reason === "string" ? reason : "";
    });

    await server.attachExternalSocket(socket, { transport: "relay" });
    socket.emit(
      "message",
      JSON.stringify({
        type: "session",
        message: {
          type: "ping",
        },
      }),
    );
    expect(closeCode).toBe(4002);
    expect(["Invalid hello", "Session message before hello"]).toContain(closeReason);
    expect(sessionMock.instances).toHaveLength(0);

    await server.close();
  });

  test("refuses a relay hello that carries no device credential", async () => {
    const server = createServer();
    const socket = new MockSocket();
    let closeCode: number | null = null;
    socket.on("close", (code: unknown) => {
      closeCode = typeof code === "number" ? code : null;
    });

    await server.attachExternalSocket(socket, { transport: "relay" });
    socket.emit(
      "message",
      JSON.stringify({
        type: "hello",
        clientId: "cid-no-credential",
        clientType: "cli",
        protocolVersion: 1,
      }),
    );
    await flushMicrotasks();

    expect(sessionMock.instances).toHaveLength(0);
    expect(closeCode).toBe(4401);

    await server.close();
  });

  test("refuses a relay hello whose credential is not a known device", async () => {
    const server = createServer();
    const socket = new MockSocket();

    await server.attachExternalSocket(socket, { transport: "relay" });
    socket.emit(
      "message",
      JSON.stringify({
        type: "hello",
        clientId: "cid-wrong-credential",
        clientType: "cli",
        protocolVersion: 1,
        auth: { token: "not-a-real-credential" },
      }),
    );
    await flushMicrotasks();

    expect(sessionMock.instances).toHaveLength(0);

    await server.close();
  });

  test("a relay session runs as the device its credential belongs to", async () => {
    const server = createServer();
    const socket = new MockSocket();

    await attachRelayAndHello({ server, socket, clientId: "cid-device-admission" });

    const session = sessionMock.instances.at(-1)!;
    expect((session.args.device as { id: string }).id).toBe("cred_relay");
    expect(session.args.permissions).toEqual([...OWNER_PERMISSIONS]);

    await server.close();
  });

  test("logs control RPCs with the socket identity", async () => {
    const logger = createLogger();
    const server = createServer({ logger });
    const socket = new MockSocket();

    await server.attachExternalSocket(socket, {
      transport: "relay",
      relayConnectionId: "relay-conn-1",
    });
    socket.emit("message", JSON.stringify(createHelloMessage("cid-control-log")));
    await flushMicrotasks();
    socket.emit(
      "message",
      JSON.stringify({
        type: "session",
        message: {
          type: "shutdown_server_request",
          requestId: "shutdown-1",
        },
      }),
    );
    await Promise.resolve();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: expect.stringMatching(/^conn_/),
        transport: "relay",
        relayConnectionId: "relay-conn-1",
        clientId: "cid-control-log",
        sessionId: "mock-session-id",
        requestType: "shutdown_server_request",
        requestId: "shutdown-1",
        reason: "client_shutdown_rpc",
      }),
      "ws_control_rpc_received",
    );

    await server.close();
  });

  test("responds to top-level ping while provider diagnostic is still running", async () => {
    const server = createServer();
    const socket = new MockSocket();
    await attachRelayAndHello({
      server,
      socket,
      clientId: "cid-ping-during-provider-diagnostic",
    });

    const session = sessionMock.instances[0];
    const providerDiagnostic = holdNextSessionMessage(session);

    const sentBeforeDiagnostic = socket.sent.length;
    socket.emit(
      "message",
      JSON.stringify({
        type: "session",
        message: {
          type: "provider_diagnostic_request",
          provider: "grok",
          requestId: "slow-provider-diagnostic",
        },
      }),
    );
    await vi.waitFor(() => {
      expect(session.handleMessage).toHaveBeenCalledTimes(1);
    });

    socket.emit("message", JSON.stringify({ type: "ping" }));
    await Promise.resolve();

    expect(sentEnvelopes(socket).slice(sentBeforeDiagnostic)).toContainEqual({
      type: "pong",
    });

    providerDiagnostic.finish();
    await Promise.resolve();
    await server.close();
  });

  test("routes later session requests while provider diagnostic is still running", async () => {
    const server = createServer();
    const socket = new MockSocket();
    await attachRelayAndHello({
      server,
      socket,
      clientId: "cid-session-request-during-provider-diagnostic",
    });

    const session = sessionMock.instances[0];
    const providerDiagnostic = holdNextSessionMessage(session);

    socket.emit(
      "message",
      JSON.stringify({
        type: "session",
        message: {
          type: "provider_diagnostic_request",
          provider: "grok",
          requestId: "slow-provider-diagnostic",
        },
      }),
    );
    await vi.waitFor(() => {
      expect(session.handleMessage).toHaveBeenCalledTimes(1);
    });

    socket.emit(
      "message",
      JSON.stringify({
        type: "session",
        message: {
          type: "ping",
          requestId: "second-session-request",
          clientSentAt: Date.now(),
        },
      }),
    );
    await vi.waitFor(() => {
      expect(session.handleMessage).toHaveBeenCalledTimes(2);
    });

    providerDiagnostic.finish();
    await Promise.resolve();
    await server.close();
  });

  test("sends rpc_error when an async session request fails", async () => {
    const server = createServer();
    const socket = new MockSocket();
    await attachRelayAndHello({
      server,
      socket,
      clientId: "cid-session-request-failure",
    });

    const session = sessionMock.instances[0];
    session.handleMessage.mockRejectedValueOnce(new Error("handler exploded"));

    const sentBeforeRequest = socket.sent.length;
    socket.emit(
      "message",
      JSON.stringify({
        type: "session",
        message: {
          type: "provider_diagnostic_request",
          provider: "grok",
          requestId: "failing-provider-diagnostic",
        },
      }),
    );

    await vi.waitFor(() => {
      expect(sentEnvelopes(socket).slice(sentBeforeRequest)).toContainEqual({
        type: "session",
        message: {
          type: "rpc_error",
          payload: {
            requestId: "failing-provider-diagnostic",
            requestType: "provider_diagnostic_request",
            error: "Invalid message",
            code: "invalid_message",
          },
        },
      });
    });

    await server.close();
  });

  test("reuses direct session when same clientId reconnects within grace window", async () => {
    const server = createServer();
    const clientId = "cid-direct-reconnect";

    const socket1 = new MockSocket();
    await attachDirectAndHello({
      server,
      socket: socket1,
      clientId,
    });
    expect(sessionMock.instances).toHaveLength(1);
    const session = sessionMock.instances[0];

    socket1.emit("close", 1006, "");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.cleanup).not.toHaveBeenCalled();

    const socket2 = new MockSocket();
    await attachDirectAndHello({
      server,
      socket: socket2,
      clientId,
    });
    expect(sessionMock.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(session.cleanup).not.toHaveBeenCalled();

    await server.close();
  });

  test("reuses one session when switching from direct to relay with the same clientId", async () => {
    const server = createServer();
    const clientId = "cid-switch-path";

    const directSocket = new MockSocket();
    await attachDirectAndHello({
      server,
      socket: directSocket,
      clientId,
      // The same device on both paths: one session, whichever way it arrives.
      admission: {
        principalId: "owner",
        permissions: [...OWNER_PERMISSIONS],
        device: { id: "cred_relay", name: "Relay phone", role: "owner" },
      },
    });
    expect(sessionMock.instances).toHaveLength(1);
    const session = sessionMock.instances[0];

    const relaySocket = new MockSocket();
    await attachRelayAndHello({
      server,
      socket: relaySocket,
      clientId,
    });
    expect(sessionMock.instances).toHaveLength(1);

    const { onMessage } = session.args;
    expect(onMessage).toBeTypeOf("function");
    if (typeof onMessage === "function") {
      onMessage({
        type: "status",
        payload: { status: "ok" },
      });
    }

    expect(directSocket.sent.length).toBeGreaterThan(0);
    expect(relaySocket.sent.length).toBeGreaterThan(0);

    directSocket.emit("close", 1006, "");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.cleanup).not.toHaveBeenCalled();

    relaySocket.emit("close", 1006, "");
    await vi.advanceTimersByTimeAsync(90_000);
    expect(session.cleanup).toHaveBeenCalledTimes(1);

    await server.close();
  });

  test("cleans up relay session when reconnect grace expires", async () => {
    const server = createServer();
    const clientId = "cid-relay-grace-expire";

    const socket1 = new MockSocket();
    await attachRelayAndHello({
      server,
      socket: socket1,
      clientId,
    });
    expect(sessionMock.instances).toHaveLength(1);
    const session = sessionMock.instances[0];

    socket1.emit("close", 1006, "");
    await vi.advanceTimersByTimeAsync(90_000);
    expect(session.cleanup).toHaveBeenCalledTimes(1);

    await server.close();
  });

  test("advertises current features in initial server_info", async () => {
    const server = createServer();
    const socket = new MockSocket();

    const serverInfo = await attachRelayAndHello({
      server,
      socket,
      clientId: "cid-stable-project-identity",
    });

    expect(serverInfo.features?.stableProjectIdentity).toBe(true);
    expect(serverInfo.features?.canonicalSubmittedPrompts).toBe(true);
    expect(serverInfo.features?.workspaceCreatedAt).toBe(true);
    expect(serverInfo.features?.providersSnapshotCwd).toBe(true);
    expect(serverInfo.features).not.toHaveProperty("plugins");
    expect(serverInfo.features?.["terminal-input-mode-replay"]).toBe(true);
    expect(serverInfo.features?.["terminal-size-ownership"]).toBe(true);
    expect(serverInfo.features?.agentTurnIdentity).toBeUndefined();
    expect(serverInfo.permissions).toEqual(DAEMON_PERMISSIONS);
    await server.close();
  });

  test("advertises deviceAccess and sessionPresence once their services are wired", async () => {
    const server = createServer();
    server.setDeviceAccessServices({
      deviceAccess: createStub<DeviceAccessService>({}),
      presence: createStub<PresenceService>({}),
    });

    const serverInfo = await attachRelayAndHello({
      server,
      socket: new MockSocket(),
      clientId: "cid-device-access-features",
    });

    // The CLI and the client UI gate the whole device-access feature on these.
    expect(serverInfo.features?.deviceAccess).toBe(true);
    expect(serverInfo.features?.sessionPresence).toBe(true);
    expect(serverInfo.features?.deviceRoles).toBe(true);
    await server.close();
  });

  test("omits deviceAccess and sessionPresence when the services are absent", async () => {
    const server = createServer();

    const serverInfo = await attachRelayAndHello({
      server,
      socket: new MockSocket(),
      clientId: "cid-no-device-access",
    });

    expect(serverInfo.features).not.toHaveProperty("deviceAccess");
    expect(serverInfo.features).not.toHaveProperty("sessionPresence");
    await server.close();
  });

  test("includes voice capabilities in initial server_info when speech readiness exists", async () => {
    const speechReadiness = createReadySpeechReadinessSnapshot();
    const server = createServer({ speechReadiness });

    const socket = new MockSocket();
    const serverInfo = (await attachRelayAndHello({
      server,
      socket,
      clientId: "cid-server-info-capabilities",
    })) as {
      version?: unknown;
      capabilities?: {
        voice?: {
          dictation?: { enabled?: unknown; reason?: unknown };
          voice?: { enabled?: unknown; reason?: unknown };
        };
      };
    };
    expect(serverInfo.version).toBe(TEST_DAEMON_VERSION);
    expect(serverInfo.capabilities?.voice?.dictation?.enabled).toBe(
      speechReadiness.dictation.enabled,
    );
    expect(serverInfo.capabilities?.voice?.dictation?.reason).toBe("");
    expect(serverInfo.capabilities?.voice?.voice?.enabled).toBe(
      speechReadiness.realtimeVoice.enabled,
    );
    expect(serverInfo.capabilities?.voice?.voice?.reason).toBe("");

    await server.close();
  });

  test("broadcasts updated server_info when capabilities change", async () => {
    const server = createServer();

    const socket = new MockSocket();
    await attachRelayAndHello({
      server,
      socket,
      clientId: "cid-server-info-broadcast",
    });
    expect(sentServerInfoEnvelopes(socket)).toHaveLength(1);

    const speechReadiness = createReadySpeechReadinessSnapshot();
    server.publishSpeechReadiness(speechReadiness);
    expect(sentServerInfoEnvelopes(socket)).toHaveLength(2);

    const secondEnvelope = sentServerInfoEnvelopes(socket)[1];
    const secondPayload = parseServerInfoStatusPayload(secondEnvelope.message?.payload);
    expect(secondPayload?.capabilities?.voice?.dictation.enabled).toBe(true);
    expect(secondPayload?.capabilities?.voice?.voice.enabled).toBe(true);

    // Same readiness should not produce another server_info broadcast.
    server.publishSpeechReadiness(speechReadiness);
    expect(sentServerInfoEnvelopes(socket)).toHaveLength(2);

    await server.close();
  });

  test("includes temporary retry guidance while models are downloading", async () => {
    const server = createServer();
    const socket = new MockSocket();
    await attachRelayAndHello({
      server,
      socket,
      clientId: "cid-server-info-download-guidance",
    });
    expect(sentServerInfoEnvelopes(socket)).toHaveLength(1);

    server.publishSpeechReadiness(createDownloadInProgressSpeechReadinessSnapshot());
    expect(sentServerInfoEnvelopes(socket)).toHaveLength(2);

    const envelope = sentServerInfoEnvelopes(socket)[1];
    const payload = parseServerInfoStatusPayload(envelope.message?.payload);
    expect(payload?.capabilities?.voice?.dictation.enabled).toBe(true);
    expect(payload?.capabilities?.voice?.voice.enabled).toBe(true);
    expect(payload?.capabilities?.voice?.dictation.reason).toContain("Try again in a few minutes.");
    expect(payload?.capabilities?.voice?.voice.reason).toContain("Try again in a few minutes.");

    await server.close();
  });

  test("routes inbound terminal frames to session.handleBinaryFrame", async () => {
    const server = createServer();

    const socket = new MockSocket();
    await attachRelayAndHello({
      server,
      socket,
      clientId: "cid-binary-inbound",
    });
    expect(sessionMock.instances).toHaveLength(1);
    const session = sessionMock.instances[0];

    socket.emit(
      "message",
      Buffer.from(
        encodeTerminalStreamFrame({
          opcode: TerminalStreamOpcode.Input,
          slot: 9,
          payload: new TextEncoder().encode("ls\r"),
        }),
      ),
    );
    expect(session.handleBinaryFrame).toHaveBeenCalledTimes(1);
    const { frame } = BinaryFrameSchema.parse(session.handleBinaryFrame.mock.calls[0]?.[0]);
    expect(frame.opcode).toBe(TerminalStreamOpcode.Input);
    expect(frame.slot).toBe(9);
    expect(new TextDecoder().decode(frame.payload)).toBe("ls\r");

    await server.close();
  });

  test("sends status error when async binary frame handling fails", async () => {
    const server = createServer();

    const socket = new MockSocket();
    await attachRelayAndHello({
      server,
      socket,
      clientId: "cid-binary-inbound-failure",
    });
    expect(sessionMock.instances).toHaveLength(1);
    const session = sessionMock.instances[0];
    session.handleBinaryFrame.mockRejectedValueOnce(new Error("binary exploded"));

    const sentBeforeFrame = socket.sent.length;
    socket.emit(
      "message",
      Buffer.from(
        encodeTerminalStreamFrame({
          opcode: TerminalStreamOpcode.Input,
          slot: 11,
          payload: new TextEncoder().encode("pwd\r"),
        }),
      ),
    );

    await vi.waitFor(() => {
      expect(sentEnvelopes(socket).slice(sentBeforeFrame)).toContainEqual({
        type: "session",
        message: {
          type: "status",
          payload: {
            status: "error",
            message: "Invalid message: binary exploded",
          },
        },
      });
    });

    await server.close();
  });

  test("sends outbound terminal frames from session over websocket", async () => {
    const server = createServer();

    const socket = new MockSocket();
    await attachRelayAndHello({
      server,
      socket,
      clientId: "cid-binary-outbound",
    });
    expect(sessionMock.instances).toHaveLength(1);
    const session = sessionMock.instances[0];

    const { onBinaryMessage } = session.args;
    expect(onBinaryMessage).toBeTypeOf("function");
    if (typeof onBinaryMessage === "function") {
      onBinaryMessage(new Uint8Array([TerminalStreamOpcode.Output, 12, 0x6f, 0x6b]));
    }

    const terminalFrames = sentTerminalFrames(socket);
    expect(terminalFrames).toHaveLength(1);
    const frame = terminalFrames[0];
    expect(frame.opcode).toBe(TerminalStreamOpcode.Output);
    expect(frame.slot).toBe(12);
    expect(new TextDecoder().decode(frame.payload ?? new Uint8Array())).toBe("ok");

    await server.close();
  });
});

describe("per-device roles over a socket", () => {
  beforeEach(() => {
    sessionMock.instances.length = 0;
    wsModuleMock.MockWebSocketServer.instances.length = 0;
  });

  function deviceRecord(role: DeviceRole, id = "cred-1"): DeviceRecord {
    return {
      id,
      name: "Phone",
      role,
      principalId: `principal-${id}`,
      principalLabel: "Sam",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: null,
      pairedVia: "code",
      permissions: [],
    };
  }

  async function attachDevice(params: {
    server: VoiceAssistantWebSocketServer;
    socket: MockSocket;
    clientId: string;
    device: DeviceRecord;
  }) {
    await params.server.attachExternalSocket(
      params.socket,
      { transport: "relay" },
      admissionForPrincipal({ kind: "device", device: params.device }, "relay"),
    );
    params.socket.emit("message", JSON.stringify(createHelloMessage(params.clientId)));
    const envelope = parseSentEnvelope(params.socket.sent[0]);
    return parseServerInfoStatusPayload(envelope.message?.payload);
  }

  test("a relayed viewer device is admitted as a viewer, not as the owner", async () => {
    const server = createServer();
    const socket = new MockSocket();

    const serverInfo = await attachDevice({
      server,
      socket,
      clientId: "cid-viewer",
      device: deviceRecord("viewer"),
    });

    expect(sessionMock.instances).toHaveLength(1);
    expect(sessionMock.instances[0].args.role).toBe("viewer");
    expect(serverInfo?.callerRole).toBe("viewer");
    expect(serverInfo?.features?.deviceRoles).toBe(true);
    await server.close();
  });

  test("a socket with no device credential keeps owner authority", async () => {
    const server = createServer();
    const socket = new MockSocket();

    const serverInfo = await attachDirectAndHello({
      server,
      socket,
      clientId: "cid-direct",
    });

    expect(sessionMock.instances[0].args.role).toBe("owner");
    expect(serverInfo.callerRole).toBe("owner");
    await server.close();
  });

  test("role management is advertised to owners only, and only with a store", async () => {
    const withoutStore = createServer();
    const ownerSocket = new MockSocket();
    const noStoreInfo = await attachDevice({
      server: withoutStore,
      socket: ownerSocket,
      clientId: "cid-no-store",
      device: deviceRecord("owner"),
    });
    expect(noStoreInfo?.features).not.toHaveProperty("deviceRoleManagement");
    await withoutStore.close();

    const server = createServer();
    server.setDeviceRoleStore(
      createMemoryDeviceRoleStore({ "cred-1": "owner", "cred-2": "viewer" }),
    );

    const ownerInfo = await attachDevice({
      server,
      socket: new MockSocket(),
      clientId: "cid-owner",
      device: deviceRecord("owner", "cred-1"),
    });
    expect(ownerInfo?.features?.deviceRoleManagement).toBe(true);

    const viewerInfo = await attachDevice({
      server,
      socket: new MockSocket(),
      clientId: "cid-viewer-2",
      device: deviceRecord("viewer", "cred-2"),
    });
    expect(viewerInfo?.features).not.toHaveProperty("deviceRoleManagement");
    await server.close();
  });

  test("security posture reaches owners only and is advertised only when wired", async () => {
    const unwired = createServer();
    const unwiredInfo = await attachDevice({
      server: unwired,
      socket: new MockSocket(),
      clientId: "cid-unwired",
      device: deviceRecord("owner"),
    });
    expect(unwiredInfo?.features).not.toHaveProperty("securityPosture");
    expect(unwiredInfo).not.toHaveProperty("security");
    await unwired.close();

    const posture = { findings: [{ id: "unclaimed", severity: "critical", fixAction: "claim" }] };
    const server = createServer({
      daemonRuntimeConfig: {
        listen: null,
        getRelayConfig: () => null,
        getSecurityPosture: () => posture,
      },
    });
    const ownerInfo = await attachDevice({
      server,
      socket: new MockSocket(),
      clientId: "cid-owner-sp",
      device: deviceRecord("owner", "cred-1"),
    });
    expect(ownerInfo?.features?.securityPosture).toBe(true);
    expect(ownerInfo?.security).toEqual(posture);

    for (const role of ["operator", "viewer"] as const) {
      const info = await attachDevice({
        server,
        socket: new MockSocket(),
        clientId: `cid-${role}-sp`,
        device: deviceRecord(role, `cred-${role}`),
      });
      expect(info?.features?.securityPosture).toBe(true);
      expect(info).not.toHaveProperty("security");
    }
    await server.close();
  });

  test("changing a credential's role narrows its live session and re-announces it", async () => {
    const server = createServer();
    server.setDeviceRoleStore(createMemoryDeviceRoleStore({ "cred-1": "owner" }));
    const socket = new MockSocket();
    await attachDevice({
      server,
      socket,
      clientId: "cid-demote",
      device: deviceRecord("owner"),
    });
    const session = sessionMock.instances[0];

    await expect(server.setCredentialRole("cred-1", "viewer")).resolves.toBe(true);

    expect(session.setRole).toHaveBeenCalledWith("viewer");
    expect(session.args.role).toBe("viewer");
    const announced = sentServerInfoEnvelopes(socket).map(
      (envelope) => parseServerInfoStatusPayload(envelope.message?.payload)?.callerRole,
    );
    expect(announced.at(-1)).toBe("viewer");

    await expect(server.setCredentialRole("cred-unknown", "viewer")).resolves.toBe(false);
    await server.close();
  });

  test("two credentials on one clientId never share a session", async () => {
    const server = createServer();
    const clientId = "cid-shared";

    await attachDevice({
      server,
      socket: new MockSocket(),
      clientId,
      device: deviceRecord("owner", "cred-1"),
    });
    await attachDevice({
      server,
      socket: new MockSocket(),
      clientId,
      device: deviceRecord("viewer", "cred-2"),
    });

    expect(sessionMock.instances).toHaveLength(2);
    expect(sessionMock.instances.map((session) => session.args.role)).toEqual(["owner", "viewer"]);
    await server.close();
  });
});
