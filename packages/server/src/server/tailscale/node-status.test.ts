import { describe, expect, test } from "vitest";

import { createTailscaleMonitor } from "./node-status.js";

describe("Tailscale node monitor", () => {
  test("reads the node and reports changes", async () => {
    let doc = { BackendState: "Running", Self: { KeyExpiry: "2027-01-01T00:00:00Z" } };
    const seen: unknown[] = [];
    const monitor = createTailscaleMonitor(async () => JSON.stringify(doc));
    monitor.start((s) => seen.push(s));
    await monitor.refresh();
    expect(monitor.get()).toEqual({ online: true, keyExpiry: "2027-01-01T00:00:00Z" });
    doc = { BackendState: "Running", Self: { KeyExpiry: "2027-07-01T00:00:00Z" } };
    await monitor.refresh();
    monitor.stop();
    expect(seen).toHaveLength(2);
  });

  test("no tailscale is null, not an error", async () => {
    const monitor = createTailscaleMonitor(async () => {
      throw new Error("spawn tailscale ENOENT");
    });
    expect(await monitor.refresh()).toBeNull();
  });
});
