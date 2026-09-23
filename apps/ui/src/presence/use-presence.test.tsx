// @vitest-environment jsdom

import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import type { PresenceSnapshot } from "@frogg/protocol/device-access";
import { useSessionStore, type DaemonServerInfo } from "@/stores/session-store";

let mockClient: FakeClient | null = null;
let mockIsConnected = true;

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => mockClient,
  useHostRuntimeIsConnected: () => mockIsConnected,
}));

const { usePresence } = await import("./use-presence");

interface FakeClient {
  getPresence: ReturnType<typeof vi.fn>;
  reportPresence: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

function snapshotWith(
  activity: PresenceSnapshot["participants"][number]["activity"],
  agentId: string,
) {
  return {
    target: { kind: "agent", agentId },
    participants: [
      {
        participantId: "other",
        deviceId: "device-2",
        deviceName: "Ada's laptop",
        clientType: "desktop",
        activity,
        activityAt: new Date().toISOString(),
        isSelf: false,
      },
    ],
  } satisfies PresenceSnapshot;
}

function createClient(getPresence: ReturnType<typeof vi.fn>): FakeClient {
  return {
    getPresence,
    reportPresence: vi.fn(async () => ({ requestId: "r", error: null })),
    on: vi.fn(() => () => {}),
  };
}

function seedHost(serverId: string, sessionPresence: boolean): void {
  useSessionStore.getState().initializeSession(serverId, null as unknown as DaemonClient);
  useSessionStore.setState((state) => {
    const session = state.sessions[serverId];
    if (!session) return state;
    return {
      ...state,
      sessions: {
        ...state.sessions,
        [serverId]: {
          ...session,
          serverInfo: { features: { sessionPresence } } as unknown as DaemonServerInfo,
        },
      },
    };
  });
}

function PresenceTestWrapper({ children }: { children: React.ReactNode }) {
  // One client per mount: a fresh one per render would throw the cache away and
  // hide exactly the refetch this suite is asserting.
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      }),
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockIsConnected = true;
});

afterEach(() => {
  mockClient = null;
  vi.clearAllMocks();
});

describe("usePresence", () => {
  it("reports nothing and renders nothing when the daemon does not advertise presence", async () => {
    const serverId = "host-off";
    seedHost(serverId, false);
    const getPresence = vi.fn();
    mockClient = createClient(getPresence);

    const { result } = renderHook(
      () => usePresence({ serverId, targetKind: "agent", targetId: "agent-off" }),
      { wrapper: PresenceTestWrapper },
    );

    await waitFor(() => expect(result.current.view.kind).toBe("hidden"));
    expect(getPresence).not.toHaveBeenCalled();
    expect(mockClient.reportPresence).not.toHaveBeenCalled();
    expect(mockClient.on).not.toHaveBeenCalled();
    useSessionStore.getState().clearSession(serverId);
  });

  it("warns about the other person typing, and reports viewing for the target", async () => {
    const serverId = "host-typing";
    const agentId = "agent-typing";
    seedHost(serverId, true);
    mockClient = createClient(
      vi.fn(async () => ({
        requestId: "r",
        snapshot: snapshotWith("typing", agentId),
        error: null,
      })),
    );

    const { result, unmount } = renderHook(
      () => usePresence({ serverId, targetKind: "agent", targetId: agentId }),
      { wrapper: PresenceTestWrapper },
    );

    await waitFor(() => expect(result.current.warning?.deviceName).toBe("Ada's laptop"));
    expect(result.current.view.kind).toBe("list");
    expect(mockClient.reportPresence).toHaveBeenCalledWith({
      target: { kind: "agent", agentId },
      state: "viewing",
    });
    expect(mockClient.on).toHaveBeenCalledWith("presence.update", expect.any(Function));

    // Unmounting the last surface on a target hands the daemon a `left`.
    const client = mockClient;
    unmount();
    await waitFor(() =>
      expect(client.reportPresence).toHaveBeenCalledWith({
        target: { kind: "agent", agentId },
        state: "left",
      }),
    );
    useSessionStore.getState().clearSession(serverId);
  });

  it("does not warn when nobody else is on the target", async () => {
    const serverId = "host-alone";
    const agentId = "agent-alone";
    seedHost(serverId, true);
    mockClient = createClient(
      vi.fn(async () => ({
        requestId: "r",
        snapshot: { target: { kind: "agent", agentId }, participants: [] },
        error: null,
      })),
    );

    const { result } = renderHook(
      () => usePresence({ serverId, targetKind: "agent", targetId: agentId }),
      { wrapper: PresenceTestWrapper },
    );

    await waitFor(() => expect(mockClient?.getPresence).toHaveBeenCalled());
    await waitFor(() => expect(result.current.view.kind).toBe("hidden"));
    expect(result.current.warning).toBeNull();
    useSessionStore.getState().clearSession(serverId);
  });

  it("leaves the composer unhighlighted when the presence request fails", async () => {
    const serverId = "host-failed";
    const agentId = "agent-failed";
    seedHost(serverId, true);
    mockClient = createClient(
      vi.fn(async () => ({ requestId: "r", snapshot: null, error: "presence unavailable" })),
    );

    const { result } = renderHook(
      () => usePresence({ serverId, targetKind: "agent", targetId: agentId }),
      { wrapper: PresenceTestWrapper },
    );

    await waitFor(() => expect(result.current.view.kind).toBe("hidden"));
    expect(result.current.warning).toBeNull();
    // One attempt, not a retry storm.
    expect(mockClient.getPresence).toHaveBeenCalledTimes(1);
    useSessionStore.getState().clearSession(serverId);
  });

  it("re-reports and refetches after a reconnect, because the daemon forgot the target", async () => {
    const serverId = "host-reconnect";
    const agentId = "agent-reconnect";
    seedHost(serverId, true);
    mockClient = createClient(
      vi.fn(async () => ({
        requestId: "r",
        snapshot: snapshotWith("viewing", agentId),
        error: null,
      })),
    );

    const { result, rerender } = renderHook(
      () => usePresence({ serverId, targetKind: "agent", targetId: agentId }),
      { wrapper: PresenceTestWrapper },
    );
    await waitFor(() => expect(result.current.view.kind).toBe("list"));
    const client = mockClient;
    client.reportPresence.mockClear();
    client.getPresence.mockClear();

    mockIsConnected = false;
    rerender();
    mockIsConnected = true;
    rerender();

    await waitFor(() =>
      expect(client.reportPresence).toHaveBeenCalledWith({
        target: { kind: "agent", agentId },
        state: "viewing",
      }),
    );
    await waitFor(() => expect(client.getPresence).toHaveBeenCalled());
    useSessionStore.getState().clearSession(serverId);
  });

  it("stops reporting while its panel is hidden and resumes when it is shown", async () => {
    const serverId = "host-hidden";
    const agentId = "agent-hidden";
    seedHost(serverId, true);
    mockClient = createClient(
      vi.fn(async () => ({
        requestId: "r",
        snapshot: snapshotWith("viewing", agentId),
        error: null,
      })),
    );
    const client = mockClient;

    const { rerender } = renderHook(
      ({ isVisible }: { isVisible: boolean }) =>
        usePresence({ serverId, targetKind: "agent", targetId: agentId, isVisible }),
      { wrapper: PresenceTestWrapper, initialProps: { isVisible: true } },
    );

    await waitFor(() =>
      expect(client.reportPresence).toHaveBeenCalledWith({
        target: { kind: "agent", agentId },
        state: "viewing",
      }),
    );

    rerender({ isVisible: false });
    await waitFor(() =>
      expect(client.reportPresence).toHaveBeenCalledWith({
        target: { kind: "agent", agentId },
        state: "left",
      }),
    );

    client.reportPresence.mockClear();
    rerender({ isVisible: true });
    await waitFor(() =>
      expect(client.reportPresence).toHaveBeenCalledWith({
        target: { kind: "agent", agentId },
        state: "viewing",
      }),
    );
    useSessionStore.getState().clearSession(serverId);
  });
});
