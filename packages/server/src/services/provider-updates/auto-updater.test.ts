import { describe, expect, it, vi } from "vitest";
import pino from "pino";

import { ProviderAutoUpdater } from "./auto-updater.js";
import type { ProviderUpdateService, ProviderUpdateSnapshot } from "./service.js";
import type { ProviderUpdatesConfig } from "../../server/persisted-config.js";

const logger = pino({ level: "silent" });

function snapshot(statuses: Array<[string, "update-available" | "up-to-date"]>) {
  return {
    checkedAt: new Date(0).toISOString(),
    entries: statuses.map(([provider, status]) => ({
      provider,
      status,
      installedVersion: "1.0.0",
      latestVersion: "2.0.0",
      packageName: `${provider}-pkg`,
      updatable: true,
      binaryPath: `/usr/bin/${provider}`,
      manualInstallUrl: null,
      error: null,
    })),
  } satisfies ProviderUpdateSnapshot;
}

function createUpdater(
  config: ProviderUpdatesConfig | undefined,
  entries = snapshot([["claude", "update-available"]]),
) {
  const check = vi.fn(async () => entries);
  const update = vi.fn(async (provider: string) => ({
    provider,
    updated: true,
    previousVersion: "1.0.0",
    installedVersion: "2.0.0",
    error: null,
    output: "",
  }));
  const service = { check, update } as unknown as ProviderUpdateService;
  const updater = new ProviderAutoUpdater({ logger, service, getConfig: () => config });
  return { updater, check, update };
}

describe("ProviderAutoUpdater", () => {
  it("checks but does not install when auto-update is off", async () => {
    const { updater, check, update } = createUpdater(undefined);
    await updater.tick();
    updater.stop();

    expect(check).toHaveBeenCalledTimes(1);
    // Background checks skip the registry for providers not on this host.
    expect(check).toHaveBeenCalledWith({ forceRefresh: true, installedOnly: true });
    expect(update).not.toHaveBeenCalled();
  });

  it("installs available updates when auto-update is on", async () => {
    const { updater, update } = createUpdater({ autoUpdate: true });
    await updater.tick();
    updater.stop();

    expect(update).toHaveBeenCalledWith("claude");
  });

  it("skips ignored providers", async () => {
    const { updater, update } = createUpdater({ autoUpdate: true, ignoredProviders: ["claude"] });
    await updater.tick();
    updater.stop();

    expect(update).not.toHaveBeenCalled();
  });

  it("does not check at all when checking is disabled", async () => {
    const { updater, check } = createUpdater({ checkEnabled: false, autoUpdate: true });
    await updater.tick();
    updater.stop();

    expect(check).not.toHaveBeenCalled();
  });

  it("leaves up-to-date providers alone", async () => {
    const { updater, update } = createUpdater(
      { autoUpdate: true },
      snapshot([["claude", "up-to-date"]]),
    );
    await updater.tick();
    updater.stop();

    expect(update).not.toHaveBeenCalled();
  });
});
