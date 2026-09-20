import { brand } from "@frogg/branding";
import { describe, expect, test } from "vitest";
import {
  defaultRestartServiceDeps,
  defaultServiceStateDeps,
  describeOwnershipRemedy,
  describeServiceRegistration,
  detectServiceRegistration,
  resolveServiceOwnership,
  restartService,
  startService,
  type ServiceRegistration,
} from "./state.js";

const UNIT = `${brand.serviceName}.service`;

function stateDeps(overrides: {
  unitExists?: boolean;
  enabled?: boolean;
  active?: boolean;
  platform?: NodeJS.Platform;
}) {
  return defaultServiceStateDeps({
    platform: overrides.platform ?? "linux",
    configHome: "/config",
    fileExists: () => overrides.unitExists !== false,
    run: (_command, args) => {
      if (args.includes("is-enabled")) return { status: overrides.enabled === false ? 1 : 0 };
      if (args.includes("is-active")) return { status: overrides.active ? 0 : 1 };
      return { status: 1 };
    },
  });
}

describe("detectServiceRegistration", () => {
  test("reports the installed unit and its state", () => {
    expect(detectServiceRegistration(stateDeps({ enabled: true, active: true }))).toEqual({
      kind: "systemd",
      name: UNIT,
      path: `/config/systemd/user/${UNIT}`,
      enabled: true,
      active: true,
    });
  });

  test("is null when no unit file is installed", () => {
    expect(detectServiceRegistration(stateDeps({ unitExists: false }))).toBeNull();
  });

  test("is null on a platform with no user service manager", () => {
    expect(detectServiceRegistration(stateDeps({ platform: "win32" }))).toBeNull();
  });
});

describe("resolveServiceOwnership", () => {
  const registration: ServiceRegistration = {
    kind: "systemd",
    name: UNIT,
    path: `/config/systemd/user/${UNIT}`,
    enabled: true,
    active: false,
  };

  test("an active unit owns the daemon", () => {
    expect(
      resolveServiceOwnership({
        registration: { ...registration, active: true },
        daemonRunning: true,
      }),
    ).toBe("service");
  });

  test("a daemon running beside an inactive unit is detached", () => {
    expect(resolveServiceOwnership({ registration, daemonRunning: true })).toBe("detached");
  });

  test("an inactive unit with no daemon is simply stopped", () => {
    expect(resolveServiceOwnership({ registration, daemonRunning: false })).toBe("service_stopped");
  });

  test("no unit at all is a manual daemon", () => {
    expect(resolveServiceOwnership({ registration: null, daemonRunning: true })).toBe("manual");
    expect(resolveServiceOwnership({ registration: null, daemonRunning: false })).toBe("none");
  });
});

describe("remedies", () => {
  const registration: ServiceRegistration = {
    kind: "systemd",
    name: UNIT,
    path: `/config/systemd/user/${UNIT}`,
    enabled: true,
    active: false,
  };

  test("a detached daemon is named with the command that hands it back", () => {
    const remedy = describeOwnershipRemedy({ ownership: "detached", registration });
    expect(remedy).toContain(UNIT);
    expect(remedy).toContain(`${brand.cliName} daemon restart`);
  });

  test("a healthy host has nothing to say", () => {
    expect(describeOwnershipRemedy({ ownership: "service", registration })).toBeNull();
    expect(describeOwnershipRemedy({ ownership: "manual", registration: null })).toBeNull();
  });

  test("the description carries both flags", () => {
    expect(describeServiceRegistration(registration)).toBe(`systemd ${UNIT} (enabled, inactive)`);
    expect(describeServiceRegistration(null)).toContain("none");
  });
});

function restartDeps(overrides: {
  inside?: boolean;
  systemdRunStatus?: number;
  restartStatus?: number;
}) {
  const calls: string[][] = [];
  const deps = defaultRestartServiceDeps({
    platform: "linux",
    insideUnit: () => overrides.inside === true,
    now: () => 1234,
    run: (command, args) => {
      calls.push([command, ...args]);
      if (command === "systemd-run") return { status: overrides.systemdRunStatus ?? 0 };
      return { status: overrides.restartStatus ?? 0, stderr: "boom" };
    },
  });
  return { deps, calls };
}

const systemdRegistration: ServiceRegistration = {
  kind: "systemd",
  name: UNIT,
  path: `/config/systemd/user/${UNIT}`,
  enabled: true,
  active: true,
};

describe("restartService", () => {
  test("restarts the unit directly from outside its cgroup", () => {
    const { deps, calls } = restartDeps({ inside: false });
    expect(restartService(systemdRegistration, deps)).toBe("direct");
    expect(calls).toEqual([["systemctl", "--user", "restart", UNIT]]);
  });

  test("hands the restart to a transient unit when called from inside the daemon cgroup", () => {
    const { deps, calls } = restartDeps({ inside: true });
    expect(restartService(systemdRegistration, deps)).toBe("systemd-run");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("systemd-run");
    expect(calls[0]).toContain(`--unit=${brand.id}-restart-1234`);
    expect(calls[0]?.slice(-4)).toEqual(["systemctl", "--user", "restart", UNIT]);
  });

  test("falls back to a direct restart when systemd-run is unavailable", () => {
    const { deps, calls } = restartDeps({ inside: true, systemdRunStatus: 1 });
    expect(restartService(systemdRegistration, deps)).toBe("direct");
    expect(calls.map((call) => call[0])).toEqual(["systemd-run", "systemctl"]);
  });

  test("a failing restart is reported with its stderr", () => {
    const { deps } = restartDeps({ inside: false, restartStatus: 1 });
    expect(() => restartService(systemdRegistration, deps)).toThrow(/boom/);
  });
});

describe("startService", () => {
  test("starts the unit", () => {
    const { deps, calls } = restartDeps({});
    startService(systemdRegistration, deps);
    expect(calls).toEqual([["systemctl", "--user", "start", UNIT]]);
  });

  test("a failing start is reported", () => {
    const { deps } = restartDeps({ restartStatus: 1 });
    expect(() => startService(systemdRegistration, deps)).toThrow(/boom/);
  });
});
