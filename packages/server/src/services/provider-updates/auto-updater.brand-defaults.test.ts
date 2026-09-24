import pino from "pino";
import { expect, test, vi } from "vitest";

import type { ProviderUpdateService } from "./service.js";

// A managed brand that turns background provider update checks off
// (brand.json `daemon.providerUpdateChecks: false`).
vi.mock("@frogg/branding", async () => {
  const { resolveBrandManifest } = await import("@frogg/branding/schema");
  return {
    brand: resolveBrandManifest({
      schemaVersion: 1,
      id: "acme",
      name: "Acme Studio",
      applicationId: "com.acme.studio",
      daemonPort: 10099,
      assets: { icon: "icon.png" },
      daemon: { providerUpdateChecks: false },
    }),
  };
});

const { ProviderAutoUpdater } = await import("./auto-updater.js");
const { resolveProviderUpdatePreferences } = await import("./preferences.js");

function createUpdater(config: { checkEnabled?: boolean } | undefined) {
  const check = vi.fn(async () => ({ checkedAt: new Date(0).toISOString(), entries: [] }));
  const service = { check, update: vi.fn() } as unknown as ProviderUpdateService;
  const updater = new ProviderAutoUpdater({
    logger: pino({ level: "silent" }),
    service,
    getConfig: () => config,
  });
  return { updater, check };
}

test("the brand default turns background checks off", async () => {
  expect(resolveProviderUpdatePreferences(undefined).checkEnabled).toBe(false);
  const { updater, check } = createUpdater(undefined);
  await updater.tick();
  updater.stop();
  expect(check).not.toHaveBeenCalled();
});

test("config.json providerUpdates.checkEnabled wins over the brand", async () => {
  expect(resolveProviderUpdatePreferences({ checkEnabled: true }).checkEnabled).toBe(true);
  const { updater, check } = createUpdater({ checkEnabled: true });
  await updater.tick();
  updater.stop();
  expect(check).toHaveBeenCalledTimes(1);
});
