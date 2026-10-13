import { PluginRequestError } from "@frogg/client/internal/daemon-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

let info: unknown = null;
vi.mock("./store", () => ({
  getClient: () => ({ getLastServerInfoMessage: () => info }),
  onHostSwitch: () => {},
  useDaemon: () => "online",
}));
vi.mock("../prefs", () => ({ setPref: vi.fn() }));

const {
  describeCapability,
  describePluginError,
  refreshPluginGate,
  usePluginGate,
  wantsRemoteControl,
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
