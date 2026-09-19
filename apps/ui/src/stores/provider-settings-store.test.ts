import { afterEach, describe, expect, it } from "vitest";
import { useProviderSettingsStore } from "./provider-settings-store";

describe("provider settings store", () => {
  afterEach(() => {
    useProviderSettingsStore.setState({
      serverId: null,
      provider: null,
      overlayParentLayer: 0,
      surface: "diagnostics",
      visible: false,
    });
  });

  it("carries the opener layer without leaking it into later base-level opens", () => {
    useProviderSettingsStore.getState().open({
      serverId: "server-1",
      provider: "codex",
      overlayParentLayer: 30,
    });
    expect(useProviderSettingsStore.getState().overlayParentLayer).toBe(30);

    useProviderSettingsStore.getState().open({
      serverId: "server-1",
      provider: "claude",
    });
    expect(useProviderSettingsStore.getState().overlayParentLayer).toBe(0);
  });

  it("opens the full provider settings when asked, and diagnostics by default", () => {
    useProviderSettingsStore
      .getState()
      .open({ serverId: "server-1", provider: "claude", surface: "settings" });
    expect(useProviderSettingsStore.getState().surface).toBe("settings");

    useProviderSettingsStore.getState().open({ serverId: "server-1", provider: "claude" });
    expect(useProviderSettingsStore.getState().surface).toBe("diagnostics");
  });
});
