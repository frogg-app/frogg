/** @vitest-environment jsdom */
import React, { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProviderAccounts } from "./use-provider-accounts";

const runtime = vi.hoisted(() => ({
  connected: true,
  supported: true,
  clients: new Map<string, Record<string, ReturnType<typeof vi.fn>>>(),
}));

vi.mock("@/runtime/host-features", () => ({
  useHostFeature: (_serverId: string, feature: string) =>
    feature === "providerAccounts" && runtime.supported,
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: (serverId: string) => runtime.clients.get(serverId) ?? null,
  useHostRuntimeIsConnected: () => runtime.connected,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>
  );
}

const payload = {
  requestId: "r1",
  accounts: [],
  capabilities: [],
  activeAccountIds: {},
  error: null,
};

function makeClient() {
  return {
    listProviderAccounts: vi.fn(async () => payload),
    createProviderAccount: vi.fn(async () => ({ ...payload, warnings: ["linked skills"] })),
    deleteProviderAccount: vi.fn(async () => payload),
    setActiveProviderAccount: vi.fn(async () => payload),
  };
}

describe("provider accounts host state", () => {
  beforeEach(() => {
    runtime.connected = true;
    runtime.supported = true;
    runtime.clients.clear();
  });

  it("loads accounts from the selected host", async () => {
    const client = makeClient();
    runtime.clients.set("remote", client);

    const { result } = renderHook(() => useProviderAccounts("remote"), { wrapper });

    await waitFor(() => expect(result.current.payload).toEqual(payload));
    expect(client.listProviderAccounts).toHaveBeenCalledOnce();
  });

  it("never calls a daemon that does not advertise the feature", async () => {
    runtime.supported = false;
    const client = makeClient();
    runtime.clients.set("old-host", client);

    const { result } = renderHook(() => useProviderAccounts("old-host"), { wrapper });

    expect(result.current.supported).toBe(false);
    expect(client.listProviderAccounts).not.toHaveBeenCalled();
  });

  it("does not fetch while the host is disconnected", async () => {
    runtime.connected = false;
    const client = makeClient();
    runtime.clients.set("offline", client);

    const { result } = renderHook(() => useProviderAccounts("offline"), { wrapper });

    expect(result.current.connected).toBe(false);
    expect(client.listProviderAccounts).not.toHaveBeenCalled();
  });

  it("sends the create request and adopts the response payload", async () => {
    const client = makeClient();
    runtime.clients.set("remote", client);

    const { result } = renderHook(() => useProviderAccounts("remote"), { wrapper });
    await waitFor(() => expect(result.current.payload).not.toBeNull());

    let created: { warnings?: string[] } | undefined;
    await act(async () => {
      created = await result.current.create.mutateAsync({
        provider: "claude",
        name: "work",
        linkedFolders: ["skills"],
      });
    });

    expect(client.createProviderAccount).toHaveBeenCalledWith({
      provider: "claude",
      name: "work",
      linkedFolders: ["skills"],
    });
    // Warnings are carried through verbatim for the caller to render.
    expect(created?.warnings).toEqual(["linked skills"]);
    await waitFor(() => expect(result.current.payload?.warnings).toEqual(["linked skills"]));
  });

  it("clears the active account with an explicit null", async () => {
    const client = makeClient();
    runtime.clients.set("remote", client);

    const { result } = renderHook(() => useProviderAccounts("remote"), { wrapper });
    await waitFor(() => expect(result.current.payload).not.toBeNull());

    await act(async () => {
      await result.current.setActive.mutateAsync({ provider: "claude", accountId: null });
    });

    expect(client.setActiveProviderAccount).toHaveBeenCalledWith({
      provider: "claude",
      accountId: null,
    });
  });
});
