import { expect, test, vi } from "vitest";

// A Frogg Next daemon build: the stock brand resolved with `--daemon next`.
vi.mock("@frogg/branding", async () => {
  const { resolveBrandManifest } = await import("@frogg/branding/schema");
  return {
    brand: resolveBrandManifest(
      {
        schemaVersion: 1,
        id: "frogg",
        name: "frogg",
        fullName: "frogg",
        applicationId: "app.frogg.frogg",
        daemonPort: 9999,
        assets: { icon: "icon.png" },
        next: { name: "Frogg Next", daemonPort: 9969 },
      },
      { daemon: "next" },
    ),
  };
});

import { resolveServicePlan } from "./plan.js";

test("Frogg Next systemd unit carries the Frogg Next brand", () => {
  const plan = resolveServicePlan({
    platform: "linux",
    homeDir: "/scratch/home/dev",
    env: { PATH: "/usr/bin:/bin" },
    command: { program: "/opt/frogg-next/bin/frogg-next", args: ["daemon", "start"] },
    listen: "127.0.0.1:9969",
  });
  expect(plan.file?.path).toContain("frogg-next-daemon.service");
  expect(plan.file?.contents).toContain("Description=Frogg Next daemon (Frogg Next)\n");
});
