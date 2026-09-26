import os from "node:os";
import { describe, expect, it } from "vitest";
import { cpuUsagePercent, HostMetricsSampler } from "./host-metrics.js";

describe("cpuUsagePercent", () => {
  it("computes busy share of the delta window", () => {
    expect(cpuUsagePercent({ idle: 100, total: 200 }, { idle: 150, total: 400 })).toBe(75);
  });

  it("returns null for an empty window", () => {
    expect(cpuUsagePercent({ idle: 1, total: 2 }, { idle: 1, total: 2 })).toBeNull();
  });
});

describe("HostMetricsSampler", () => {
  it("samples host, daemon and disk figures", async () => {
    const sampler = new HostMetricsSampler({ diskPath: os.tmpdir(), sleep: async () => {} });
    const metrics = await sampler.sample();
    expect(metrics.cpu.cores).toBeGreaterThan(0);
    expect(metrics.memory.totalBytes).toBeGreaterThan(metrics.memory.freeBytes);
    expect(metrics.daemon.pid).toBe(process.pid);
    expect(metrics.disk?.totalBytes).toBeGreaterThan(0);
  });
});
