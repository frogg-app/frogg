import { mkdirSync, writeFileSync, mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { installLoginService, uninstallLoginService } from "./install.js";
import { LAUNCHD_LABEL, WINDOWS_RUN_VALUE, type ServiceCommand } from "./plan.js";

/**
 * Uses the launchd plan with a scratch home. Commands are stubbed: `ok` makes
 * every step succeed so the file writing is what is under test.
 */
const ok = () => null;
function scratchHome(): string {
  return mkdtempSync(path.join(tmpdir(), "frogg-service-home-"));
}

describe("login service files", () => {
  test("a new service uses wildcard defaults without pinning the listener", () => {
    const homeDir = scratchHome();
    try {
      const installed = installLoginService({
        platform: "darwin",
        homeDir,
        env: { PATH: "/usr/bin" },
        run: ok,
      });
      expect(installed.listen).toBe("0.0.0.0:9999");
      const configPath = path.join(homeDir, ".frogg", "config.json");
      // Nothing pinned the listener, so config.json keeps no address at all and
      // the brand's bind default stays in charge.
      expect(JSON.parse(readFileSync(configPath, "utf8")).daemon).not.toHaveProperty("listen");
      expect(readFileSync(installed.file!, "utf8")).not.toContain("<key>FROGG_LISTEN</key>");
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test.each([
    [undefined, undefined, "127.0.0.1:8123", false],
    [undefined, "   ", "127.0.0.1:8123", false],
    [undefined, "[::1]:8124", "[::1]:8124", true],
    ["127.0.0.1:8125", "[::1]:8124", "127.0.0.1:8125", true],
  ])(
    "respects config, environment and flag precedence (%s, %s)",
    (listen, envListen, expected, pinned) => {
      const homeDir = scratchHome();
      const home = path.join(homeDir, ".frogg");
      mkdirSync(home);
      writeFileSync(
        path.join(home, "config.json"),
        JSON.stringify({ daemon: { listen: "127.0.0.1:8123" } }),
      );
      try {
        const installed = installLoginService({
          platform: "darwin",
          homeDir,
          env: { PATH: "/usr/bin", FROGG_HOME: home, FROGG_LISTEN: envListen },
          listen,
          run: ok,
        });
        expect(installed.listen).toBe(expected);
        expect(installed.home).toBe(home);
        const plist = readFileSync(installed.file!, "utf8");
        expect(plist.includes("<key>FROGG_LISTEN</key>")).toBe(pinned);
        expect(plist.includes(`<string>${expected}</string>`)).toBe(pinned);
      } finally {
        rmSync(homeDir, { recursive: true, force: true });
      }
    },
  );

  test("install writes the agent, uninstall removes it", () => {
    const homeDir = scratchHome();
    try {
      const installed = installLoginService({
        platform: "darwin",
        homeDir,
        env: { PATH: "/usr/bin" },
        listen: "127.0.0.1:9991",
        home: path.join(homeDir, ".frogg"),
        run: ok,
      });

      const plistPath = path.join(homeDir, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
      expect(installed.action).toBe("installed");
      expect(installed.file).toBe(plistPath);
      expect(installed.listen).toBe("127.0.0.1:9991");
      expect(readFileSync(plistPath, "utf8")).toContain("<key>RunAtLoad</key><true/>");

      const removed = uninstallLoginService({
        platform: "darwin",
        homeDir,
        env: { PATH: "/usr/bin" },
        run: ok,
      });
      expect(removed.action).toBe("uninstalled");
      expect(existsSync(plistPath)).toBe(false);

      expect(
        uninstallLoginService({ platform: "darwin", homeDir, env: { PATH: "/usr/bin" } }).action,
      ).toBe("not_installed");
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("a failed required step reports failure instead of success", () => {
    const homeDir = scratchHome();
    try {
      const installed = installLoginService({
        platform: "darwin",
        homeDir,
        env: { PATH: "/usr/bin" },
        run: (command) =>
          command.args[0] === "bootout" || command.args[0] === "bootstrap"
            ? `launchctl ${command.args[0]} exited with 5`
            : null,
      });
      expect(installed.action).toBe("failed");
      expect(installed.message).toContain("launchctl bootstrap exited with 5");
      expect(installed.message).not.toContain("will start when you log in");
      expect(installed.hints).toEqual([]);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});

describe("Windows login service", () => {
  function windowsInstall(homeDir: string, run: (command: ServiceCommand) => string | null) {
    return installLoginService({
      platform: "win32",
      homeDir,
      env: { PATH: "C:\\Windows" },
      listen: "127.0.0.1:9999",
      run,
    });
  }

  test("writes the launcher, registers it and starts the daemon", () => {
    const homeDir = scratchHome();
    const ran: ServiceCommand[] = [];
    try {
      const installed = windowsInstall(homeDir, (command) => {
        ran.push(command);
        // No legacy task on a clean machine.
        return command.program === "schtasks" ? "schtasks exited with 1" : null;
      });
      const launcher = path.join(homeDir, ".frogg", "service", `${WINDOWS_RUN_VALUE}.cmd`);
      expect(installed.action).toBe("installed");
      expect(installed.label).toBe(WINDOWS_RUN_VALUE);
      expect(installed.file).toBe(launcher);
      const script = readFileSync(launcher, "utf8");
      expect(script).toContain('"daemon" "start" "--listen" "127.0.0.1:9999" "--home"');
      expect(script).not.toContain("--foreground");
      expect(ran.map((command) => command.program)).toEqual(["schtasks", "reg", "cmd.exe"]);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("a refused registry write fails the install and skips the start", () => {
    const homeDir = scratchHome();
    const ran: string[] = [];
    try {
      const installed = windowsInstall(homeDir, (command) => {
        ran.push(command.program);
        return command.program === "reg" ? "reg add exited with 1" : null;
      });
      expect(installed.action).toBe("failed");
      expect(installed.message).toContain("reg add exited with 1");
      expect(ran).toEqual(["schtasks", "reg"]);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("uninstall removes the Run value and launcher", () => {
    const homeDir = scratchHome();
    try {
      const installed = windowsInstall(homeDir, ok);
      const removed = uninstallLoginService({
        platform: "win32",
        homeDir,
        env: { PATH: "C:\\Windows" },
        run: ok,
      });
      expect(removed.action).toBe("uninstalled");
      expect(existsSync(installed.file!)).toBe(false);
      expect(
        uninstallLoginService({
          platform: "win32",
          homeDir,
          env: { PATH: "C:\\Windows" },
          run: () => "not found",
        }).action,
      ).toBe("not_installed");
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
