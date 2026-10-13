import { PluginRequestError } from "@frogg/client/internal/daemon-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

let info: unknown = null;
type Listener = (m: { type: string; payload?: unknown }) => void;
const listeners = new Set<Listener>();
const push = (pluginId: string | null, reason: string) => {
  for (const fn of listeners) fn({ type: "plugins.changed", payload: { pluginId, reason } });
};
let installed: Array<{ id: string; version: string; enabled: boolean }> = [];
const pluginsList = vi.fn(async () => ({ plugins: installed.map((p) => ({ ...p })), policy: {} }));
const pluginsGetCatalog = vi.fn(async () => ({ plugins: [], repos: [] }));
const pluginsReposList = vi.fn(async () => ({ repos: [] }));
const pluginsSetEnabled = vi.fn(async (_id: string, _on: boolean) => ({ plugin: null }));
const client = {
  getLastServerInfoMessage: () => info,
  supportsPlugins: () => true,
  subscribeRawMessages: (fn: Listener) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  pluginsList,
  pluginsGetCatalog,
  pluginsReposList,
  pluginsSetEnabled,
};
vi.mock("./store", () => {
  const useDaemon = () => "online";
  useDaemon.subscribe = () => () => {};
  return { getClient: () => client, onHostSwitch: () => {}, useDaemon };
});
vi.mock("../prefs", () => ({ setPref: vi.fn() }));

const {
  describeCapability,
  describePluginError,
  refreshPluginGate,
  refreshPlugins,
  resetPlugins,
  setPluginEnabled,
  usePluginGate,
  usePlugins,
  wantsRemoteControl,
  watchPlugins,
} = await import("./plugins");

describe("Companion gate", () => {
  beforeEach(() => {
    info = null;
  });

  it("is locked and names the plugin while the host reports it missing", () => {
    const plugin = { id: "frogg.companion", repoUrl: "https://plugins.frogg.app/index.json" };
    info = { capabilities: { companion: { enabled: false, reason: "install it", plugin } } };
    refreshPluginGate();
    expect(usePluginGate.getState()).toEqual({ companion: false, companionPlugin: plugin });
  });

  it("opens once the host's capability names no plugin, even when not ready", () => {
    info = { capabilities: { companion: { enabled: false, reason: "no model" } } };
    refreshPluginGate();
    expect(usePluginGate.getState()).toEqual({ companion: true, companionPlugin: null });
  });

  it("stays locked when the host reports no Companion at all", () => {
    info = { capabilities: {} };
    refreshPluginGate();
    expect(usePluginGate.getState().companion).toBe(false);
  });
});

describe("plugin helpers", () => {
  it("offers remote control only to v2 hosts and plugins granted a remote capability", () => {
    expect(
      wantsRemoteControl({ remoteControl: false, grantedCapabilities: ["agent.manage"] }),
    ).toBe(true);
    expect(wantsRemoteControl({ remoteControl: false, grantedCapabilities: ["todos.read"] })).toBe(
      false,
    );
    expect(wantsRemoteControl({ grantedCapabilities: ["agent.manage"] })).toBe(false);
  });

  it("labels known capabilities and passes unknown ones through", () => {
    expect(describeCapability("agent.permissions")).toBe(
      "Approve or deny agents' permission requests",
    );
    expect(describeCapability("future.thing")).toBe("future.thing");
  });

  it("describes plugin errors by code", () => {
    const e = new PluginRequestError({ code: "signature_invalid", message: "bad key" });
    expect(describePluginError(e)).toBe("The repository signature did not verify. bad key");
  });
});

const watchPluginsForTest = (kinds: Parameters<typeof watchPlugins>[0][]) => {
  const off = kinds.map(watchPlugins);
  return () => off.forEach((f) => f());
};

describe("shared plugin store", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  let unwatch: () => void = () => {};
  beforeEach(() => {
    resetPlugins();
    unwatch();
    unwatch = () => {};
    installed = [{ id: "a", version: "1.0.0", enabled: true }];
    vi.clearAllMocks();
  });

  it("shares one request between readers mounting together", async () => {
    unwatch = watchPluginsForTest(["installed", "installed", "installed"]);
    await flush();
    expect(pluginsList).toHaveBeenCalledTimes(1);
    expect(usePlugins.getState().installed?.map((p) => p.id)).toEqual(["a"]);
  });

  it("reruns once when a change lands mid-request, so the result is never stale", async () => {
    const first = refreshPlugins("installed");
    installed = [...installed, { id: "b", version: "2.0.0", enabled: true }];
    void refreshPlugins("installed");
    void refreshPlugins("installed");
    await first;
    expect(pluginsList).toHaveBeenCalledTimes(2);
    expect(usePlugins.getState().installed?.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("refetches the installed list and catalog on an external install while watched", async () => {
    unwatch = watchPluginsForTest(["installed", "catalog"]);
    await flush();
    vi.clearAllMocks();
    installed = [...installed, { id: "b", version: "2.0.0", enabled: true }];
    push("b", "installed");
    await flush();
    expect(pluginsList).toHaveBeenCalledTimes(1);
    expect(pluginsGetCatalog).toHaveBeenCalledTimes(1);
    expect(pluginsReposList).not.toHaveBeenCalled();
    expect(usePlugins.getState().installed?.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("routes repo, settings and contribution changes to what they touch", async () => {
    unwatch = watchPluginsForTest(["installed", "catalog", "repos"]);
    await flush();
    vi.clearAllMocks();
    push(null, "repos");
    push("a", "settings");
    push("a", "contributions");
    await flush();
    expect(pluginsList).not.toHaveBeenCalled();
    expect(pluginsReposList).toHaveBeenCalledTimes(1);
    expect(pluginsGetCatalog).toHaveBeenCalledTimes(1);
    expect(usePlugins.getState().settingsRev).toEqual({ a: 1 });
  });

  it("does not fetch for a list nobody shows", async () => {
    unwatch = watchPluginsForTest(["installed"]);
    await flush();
    vi.clearAllMocks();
    push(null, "repos");
    await flush();
    expect(pluginsReposList).not.toHaveBeenCalled();
  });

  it("drops a response from before a host switch", async () => {
    const pending = refreshPlugins("installed");
    resetPlugins();
    await pending;
    expect(usePlugins.getState().installed).toBeNull();
  });

  it("shows this client's toggle at once and refetches when the host refuses it", async () => {
    await refreshPlugins("installed");
    let fail: (e: Error) => void = () => {};
    pluginsSetEnabled.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)));
    const done = setPluginEnabled("a", false);
    expect(usePlugins.getState().installed?.[0].enabled).toBe(false);
    fail(new Error("no"));
    await expect(done).rejects.toThrow("no");
    await flush();
    expect(usePlugins.getState().installed?.[0].enabled).toBe(true);
  });
});
