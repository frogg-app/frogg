import { describe, expect, it, vi } from "vitest";
import pino from "pino";

import { ProviderUpdateSession } from "./provider-update-session.js";
import type { SessionOutboundMessage } from "../../messages.js";
import type { ProviderUpdateService } from "../../../services/provider-updates/service.js";
import type { ProviderUpdatePreferencesStore } from "../../../services/provider-updates/preferences.js";

const logger = pino({ level: "silent" });

const PREFERENCES = {
  checkEnabled: true,
  autoUpdate: false,
  checkIntervalMinutes: 720,
  ignoredProviders: [],
};

const SNAPSHOT = {
  checkedAt: "2026-01-01T00:00:00.000Z",
  entries: [
    {
      provider: "claude",
      status: "update-available" as const,
      installedVersion: "1.0.0",
      latestVersion: "2.0.0",
      packageName: "@anthropic-ai/claude-code",
      updatable: true,
      binaryPath: "/usr/bin/claude",
      manualInstallUrl: null,
      error: null,
    },
  ],
};

function createSession(
  overrides: {
    check?: ProviderUpdateService["check"];
    update?: ProviderUpdateService["update"];
    write?: ProviderUpdatePreferencesStore["write"];
  } = {},
) {
  const emitted: SessionOutboundMessage[] = [];
  const service = {
    check: overrides.check ?? vi.fn(async () => SNAPSHOT),
    update:
      overrides.update ??
      vi.fn(async (provider: string) => ({
        provider,
        updated: true,
        previousVersion: "1.0.0",
        installedVersion: "2.0.0",
        error: null,
        output: "added 1 package",
      })),
  } as unknown as ProviderUpdateService;
  const preferences = {
    resolved: () => PREFERENCES,
    read: () => ({}),
    write: overrides.write ?? vi.fn(() => PREFERENCES),
  } as unknown as ProviderUpdatePreferencesStore;

  const session = new ProviderUpdateSession(
    { emit: (msg) => emitted.push(msg) },
    logger,
    service,
    preferences,
  );
  return { session, emitted, service, preferences };
}

describe("ProviderUpdateSession", () => {
  it("answers a check with the snapshot and the current preferences", async () => {
    const { session, emitted } = createSession();

    await session.handleProviderUpdateCheckRequest({
      type: "provider.update.check.request",
      requestId: "r1",
    });

    expect(emitted).toEqual([
      {
        type: "provider.update.check.response",
        payload: {
          requestId: "r1",
          checkedAt: SNAPSHOT.checkedAt,
          entries: SNAPSHOT.entries,
          preferences: PREFERENCES,
          error: null,
        },
      },
    ]);
  });

  it("passes forceRefresh through to the service", async () => {
    const check = vi.fn(async () => SNAPSHOT);
    const { session } = createSession({
      check: check as unknown as ProviderUpdateService["check"],
    });

    await session.handleProviderUpdateCheckRequest({
      type: "provider.update.check.request",
      forceRefresh: true,
      requestId: "r1",
    });

    expect(check).toHaveBeenCalledWith({ forceRefresh: true });
  });

  it("reports an install result", async () => {
    const { session, emitted } = createSession();

    await session.handleProviderUpdateInstallRequest({
      type: "provider.update.install.request",
      provider: "claude",
      requestId: "r2",
    });

    expect(emitted[0]).toMatchObject({
      type: "provider.update.install.response",
      payload: { provider: "claude", updated: true, installedVersion: "2.0.0", error: null },
    });
  });

  it("emits an rpc_error when the check fails", async () => {
    const check = vi.fn(async () => {
      throw new Error("registry unreachable");
    });
    const { session, emitted } = createSession({
      check: check as unknown as ProviderUpdateService["check"],
    });

    await session.handleProviderUpdateCheckRequest({
      type: "provider.update.check.request",
      requestId: "r3",
    });

    expect(emitted[0]).toMatchObject({
      type: "rpc_error",
      payload: { requestId: "r3", code: "provider_update_check_failed" },
    });
  });

  it("writes only the preference keys the client sent", async () => {
    const write = vi.fn(() => PREFERENCES);
    const { session, emitted } = createSession({
      write: write as unknown as ProviderUpdatePreferencesStore["write"],
    });

    await session.handleProviderUpdateSetPreferencesRequest({
      type: "provider.update.set_preferences.request",
      autoUpdate: true,
      requestId: "r4",
    });

    expect(write).toHaveBeenCalledWith({ autoUpdate: true });
    expect(emitted[0]).toMatchObject({ type: "provider.update.set_preferences.response" });
  });
});
