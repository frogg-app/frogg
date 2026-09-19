import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  detectServiceManager,
  reconcileDaemonOwnership,
  retireLegacyServices,
  type LegacyServiceDeps,
  serviceFileTargetsInstall,
  type OwnershipDeps,
} from "./service.js";

const dirs: string[] = [];
function makeDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "frogg-self-update-service-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("service detection", () => {
  test("only claims a unit that launches this install dir", () => {
    const dir = makeDir();
    const unit = path.join(dir, "frogg-daemon.service");
    writeFileSync(
      unit,
      "[Service]\nExecStart=/home/me/.local/share/frogg/current/bin/frogg daemon start --foreground\n",
    );
    expect(serviceFileTargetsInstall(unit, "/home/me/.local/share/frogg")).toBe(true);
    expect(serviceFileTargetsInstall(unit, "/tmp/scratch/install")).toBe(false);
    expect(
      serviceFileTargetsInstall(path.join(dir, "missing"), "/home/me/.local/share/frogg"),
    ).toBe(false);
    writeFileSync(unit, "[Service]\nEnvironment=FROGG_INSTALL_DIR=/opt/frogg\n");
    expect(serviceFileTargetsInstall(unit, "/opt/frogg")).toBe(true);
  });

  test("a scratch install on a host with a real service falls back to unmanaged", () => {
    const manager = detectServiceManager({
      installDir: makeDir(),
      home: undefined,
      listen: "0.0.0.0:9993",
      platform: "linux",
    });
    expect(manager.kind).toBe("unmanaged");
  });
});

describe("daemon ownership reconciliation", () => {
  function deps(overrides: Partial<OwnershipDeps>): {
    deps: OwnershipDeps;
    stops: number;
    logs: string[];
  } {
    const state = { stops: 0, logs: [] as string[] };
    const base: OwnershipDeps = {
      isUnitActive: async () => false,
      isDaemonRunning: () => false,
      stopDaemon: async () => {
        state.stops += 1;
      },
      log: (line) => state.logs.push(line),
      ...overrides,
    };
    return {
      deps: base,
      get stops() {
        return state.stops;
      },
      get logs() {
        return state.logs;
      },
    };
  }

  test("leaves an active unit alone", async () => {
    const harness = deps({
      isUnitActive: async () => true,
      isDaemonRunning: () => true,
    });
    expect(await reconcileDaemonOwnership(harness.deps)).toBe("unit_active");
    expect(harness.stops).toBe(0);
  });

  test("does nothing when no daemon is running at all", async () => {
    const harness = deps({});
    expect(await reconcileDaemonOwnership(harness.deps)).toBe("no_daemon");
    expect(harness.stops).toBe(0);
  });

  test("stops a hand-started daemon so an inactive unit can take over", async () => {
    const harness = deps({ isDaemonRunning: () => true });
    expect(await reconcileDaemonOwnership(harness.deps)).toBe("stopped_unowned_daemon");
    expect(harness.stops).toBe(1);
    expect(harness.logs.join("\n")).toContain("inactive");
  });
});

describe("legacy FDE service retirement", () => {
  const unitFile = "/cfg/systemd/user/fde-daemon.service";
  function deps(files: Record<string, string>, active: boolean, listen: string | null) {
    const commands: string[] = [];
    const value: LegacyServiceDeps = {
      platform: "linux",
      listen,
      readFile: (file) => files[file] ?? null,
      run: (command, args) => {
        commands.push([command, ...args].join(" "));
        if (args.includes("is-active") || args.includes("is-enabled")) {
          return { status: active ? 0 : 3, stderr: "" };
        }
        return { status: 0, stderr: "" };
      },
      homeDir: "/home/me",
      configHome: "/cfg",
      uid: 1000,
      log: () => {},
    };
    return { value, commands };
  }
  const fdeUnit =
    '[Service]\nExecStart="/home/me/.local/share/fde/current/bin/fde" daemon start --foreground\nEnvironment=FDE_LISTEN=0.0.0.0:9999\n';

  test("disables an FDE unit registered on the same port", async () => {
    const { value, commands } = deps({ [unitFile]: fdeUnit }, true, "0.0.0.0:9999");
    await expect(retireLegacyServices(value)).resolves.toEqual(["fde-daemon.service"]);
    expect(commands).toContain("systemctl --user disable --now fde-daemon.service");
  });

  test("leaves an FDE unit on another port alone unless the port was seen taken", async () => {
    const { value, commands } = deps({ [unitFile]: fdeUnit }, true, "127.0.0.1:6767");
    await expect(retireLegacyServices(value)).resolves.toEqual([]);
    expect(commands.some((line) => line.includes("disable"))).toBe(false);
    await expect(retireLegacyServices(value, { force: true })).resolves.toEqual([
      "fde-daemon.service",
    ]);
  });

  test("does nothing when the legacy unit is absent or already inactive and disabled", async () => {
    await expect(retireLegacyServices(deps({}, true, "0.0.0.0:9999").value)).resolves.toEqual([]);
    const inactive = deps({ [unitFile]: fdeUnit }, false, "0.0.0.0:9999");
    await expect(retireLegacyServices(inactive.value)).resolves.toEqual([]);
    expect(inactive.commands.some((line) => line.includes("disable"))).toBe(false);
  });
});
