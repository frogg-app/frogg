import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPersistedConfig } from "@frogg/server";
import { afterEach, describe, expect, test } from "vitest";

import {
  type ClaimModeApplied,
  parseClaimModeMode,
  readClaimModeFromConfig,
  setClaimModeInConfig,
} from "./claim-mode.js";

const homes: string[] = [];

function createHome(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), "frogg-cli-claim-mode-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("daemon claim-mode", () => {
  test("parses on/off spellings and rejects anything else", () => {
    expect(parseClaimModeMode("on")).toBe("on");
    expect(parseClaimModeMode("YES")).toBe("on");
    expect(parseClaimModeMode("off")).toBe("off");
    expect(parseClaimModeMode("0")).toBe("off");
    expect(() => parseClaimModeMode("maybe")).toThrow(
      expect.objectContaining({ code: "CLAIM_MODE_INVALID" }),
    );
  });

  test("writes daemon.auth.claimMode and reports a restart when nothing runs", async () => {
    const home = createHome();

    const on = await setClaimModeInConfig("on", { home });
    expect(on).toMatchObject({
      action: "claim_mode_set",
      claimMode: true,
      configPath: path.join(home, "config.json"),
      applied: { status: "restart_required" },
    });
    expect(on.message).toContain("daemon.auth.claimMode=true");
    expect(loadPersistedConfig(home).daemon?.auth?.claimMode).toBe(true);

    // The lock-out recovery path: turning it back off needs no credential.
    const off = await setClaimModeInConfig("off", { home });
    expect(off.claimMode).toBe(false);
    expect(loadPersistedConfig(home).daemon?.auth?.claimMode).toBe(false);
  });

  test("keeps an existing password and trustLan setting", async () => {
    const home = createHome();
    writeFileSync(
      path.join(home, "config.json"),
      JSON.stringify({
        version: 1,
        daemon: {
          auth: {
            password: "$2b$12$OLxyuuP9uLK30Uzc4wQX0O6liuU/Q1t5P2b0Ebf36mULvpVK3DRZW",
            trustLan: true,
          },
        },
      }),
    );
    await setClaimModeInConfig("on", { home });
    expect(loadPersistedConfig(home).daemon?.auth).toMatchObject({
      claimMode: true,
      trustLan: true,
    });
    expect(loadPersistedConfig(home).daemon?.auth?.password).toBeDefined();
  });

  test("reads the mode that applies and where it came from", () => {
    const home = createHome();

    const fromBrand = readClaimModeFromConfig({ home, env: {} });
    expect(fromBrand).toMatchObject({ action: "claim_mode_read", source: "brand" });
    expect(fromBrand.message).toContain("Claim mode off");

    writeFileSync(
      path.join(home, "config.json"),
      JSON.stringify({ version: 1, daemon: { auth: { claimMode: true } } }),
    );
    expect(readClaimModeFromConfig({ home, env: {} })).toMatchObject({
      claimMode: true,
      source: "config",
    });

    // The daemon's environment override wins, and says so rather than
    // pretending an edit to config.json would take effect.
    const overridden = readClaimModeFromConfig({ home, env: { FROGG_CLAIM_MODE: "off" } });
    expect(overridden).toMatchObject({ claimMode: false, source: "env" });
    expect(overridden.message).toContain("FROGG_CLAIM_MODE");
  });

  test("applies live through the running daemon's config reload", async () => {
    const home = createHome();
    // This test process stands in for the daemon: the pid file makes the CLI treat it as running.
    writeFileSync(
      path.join(home, "frogg.pid"),
      JSON.stringify({ pid: process.pid, listen: "127.0.0.1:65002" }),
    );
    const reloads: string[] = [];
    const outcomes: ClaimModeApplied[] = [
      { status: "live" },
      { status: "env_override" },
      { status: "restart_required", reason: "config reload failed (boom)" },
    ];
    async function reloadLive(listen: string): Promise<ClaimModeApplied> {
      reloads.push(listen);
      return outcomes.shift() ?? { status: "live" };
    }

    const live = await setClaimModeInConfig("on", { home, reloadLive });
    expect(live.applied).toEqual({ status: "live" });
    expect(live.message).toContain("Applied to the running daemon.");
    expect(reloads).toEqual(["127.0.0.1:65002"]);

    const overridden = await setClaimModeInConfig("off", { home, reloadLive });
    expect(overridden.applied).toEqual({ status: "env_override" });
    expect(overridden.message).toContain("FROGG_CLAIM_MODE");

    const failed = await setClaimModeInConfig("off", { home, reloadLive });
    expect(failed.applied).toEqual({
      status: "restart_required",
      reason: "config reload failed (boom)",
    });
    expect(failed.message).toContain("frogg daemon restart");
  });
});
