import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  LAUNCHD_LABEL,
  resolveServicePlan,
  SERVICE_NAME,
  LEGACY_WINDOWS_TASK_NAME,
  WINDOWS_RUN_VALUE,
  type ServicePlanInput,
} from "./plan.js";

const HOME_DIR = path.join("/scratch", "home", "dev");

function planInput(overrides: Partial<ServicePlanInput> = {}): ServicePlanInput {
  return {
    platform: "linux",
    homeDir: HOME_DIR,
    env: { PATH: "/usr/bin:/bin" },
    command: {
      program: "/opt/frogg/bin/frogg",
      args: ["daemon", "start", "--foreground"],
    },
    listen: "127.0.0.1:9991",
    froggHome: path.join(HOME_DIR, ".frogg"),
    pathPrepend: "/opt/frogg/bin",
    ...overrides,
  };
}

describe("systemd user unit", () => {
  test("preserves execution descendants only when explicitly opted in", () => {
    const legacy = resolveServicePlan(planInput());
    expect(legacy.file?.contents).toContain("KillMode=mixed");
    expect(legacy.file?.contents).not.toContain("FROGG_EXECUTION_SERVICE");
    const independent = resolveServicePlan(planInput({ env: { FROGG_EXECUTION_SERVICE: "1" } }));
    expect(independent.file?.contents).toContain("KillMode=process");
    expect(independent.file?.contents).toContain(
      'ExecStop="/opt/frogg/bin/frogg" "daemon" "stop" "--force"',
    );
    expect(independent.file?.contents).toContain("Environment=FROGG_EXECUTION_SERVICE=1");
  });

  test("is written under XDG_CONFIG_HOME and starts the daemon in the foreground", () => {
    const plan = resolveServicePlan(
      planInput({
        env: { PATH: "/usr/bin:/bin", XDG_CONFIG_HOME: "/scratch/config" },
      }),
    );

    expect(plan.file?.path).toBe(`/scratch/config/systemd/user/${SERVICE_NAME}.service`);
    expect(plan.file?.contents).toContain(
      'ExecStart="/opt/frogg/bin/frogg" "daemon" "start" "--foreground"',
    );
    expect(plan.file?.contents).toContain("Environment=FROGG_LISTEN=127.0.0.1:9991");
    expect(plan.file?.contents).toContain(`Environment="FROGG_HOME=${HOME_DIR}/.frogg"`);
    expect(plan.file?.contents).toContain('Environment="PATH=/opt/frogg/bin:/usr/bin:/bin"');
    expect(plan.file?.contents).toContain("WantedBy=default.target");
    expect(plan.install).toContainEqual({
      program: "systemctl",
      args: ["--user", "enable", SERVICE_NAME],
    });
    expect(plan.hints.join(" ")).toContain("loginctl enable-linger");
  });

  test("falls back to ~/.config and omits FROGG_HOME when the home is not pinned", () => {
    const plan = resolveServicePlan(planInput({ froggHome: undefined }));
    expect(plan.file?.path).toBe(`${HOME_DIR}/.config/systemd/user/${SERVICE_NAME}.service`);
    expect(plan.file?.contents).not.toContain("FROGG_HOME");
  });

  test("uninstall disables the unit", () => {
    expect(resolveServicePlan(planInput()).uninstall).toContainEqual({
      program: "systemctl",
      args: ["--user", "disable", "--now", SERVICE_NAME],
    });
  });
});

describe("launchd agent", () => {
  test("writes a RunAtLoad plist into ~/Library/LaunchAgents", () => {
    const plan = resolveServicePlan(
      planInput({ platform: "darwin", env: { PATH: "/usr/bin", UID: "501" } }),
    );

    expect(plan.label).toBe(LAUNCHD_LABEL);
    expect(plan.file?.path).toBe(`${HOME_DIR}/Library/LaunchAgents/${LAUNCHD_LABEL}.plist`);
    const contents = plan.file?.contents ?? "";
    expect(contents).toContain(`<key>Label</key><string>${LAUNCHD_LABEL}</string>`);
    expect(contents).toContain("<string>/opt/frogg/bin/frogg</string>");
    expect(contents).toContain("<string>--foreground</string>");
    expect(contents).toContain("<key>FROGG_LISTEN</key><string>127.0.0.1:9991</string>");
    expect(contents).toContain(`<key>FROGG_HOME</key><string>${HOME_DIR}/.frogg</string>`);
    expect(contents).toContain("<key>RunAtLoad</key><true/>");
    expect(contents).toContain(
      "<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>",
    );
    expect(plan.install.at(-1)).toEqual({
      program: "launchctl",
      args: ["bootstrap", "gui/501", plan.file?.path ?? ""],
    });
  });
});

/**
 * Node (libuv) builds a Windows command line by quoting each argument; the
 * child splits it again with the MSVCRT rules. Round-tripping through both
 * shows exactly what `reg.exe` receives, which is how the old `/TR` value
 * ended up with literal backslashes in it.
 */
function libuvQuote(arg: string): string {
  if (arg === "") return '""';
  if (!/[ \t"]/.test(arg)) return arg;
  if (!/["\\]/.test(arg)) return `"${arg}"`;
  let out = '"';
  let quoteHit = true;
  for (let i = arg.length - 1; i >= 0; i--) {
    const char = arg[i]!;
    out += char;
    if (quoteHit && char === "\\") out += "\\";
    else if (char === '"') {
      quoteHit = true;
      out += "\\";
    } else quoteHit = false;
  }
  out += '"';
  return [...out].toReversed().join("");
}

function msvcrtSplit(line: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuotes = false;
  let started = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (char === "\\") {
      let count = 0;
      while (line[i] === "\\") {
        count++;
        i++;
      }
      if (line[i] === '"') {
        current += "\\".repeat(Math.floor(count / 2));
        if (count % 2 === 1) current += '"';
        else inQuotes = !inQuotes;
      } else {
        current += "\\".repeat(count);
        i--;
      }
      started = true;
    } else if (char === '"') {
      inQuotes = !inQuotes;
      started = true;
    } else if ((char === " " || char === "\t") && !inQuotes) {
      if (started) args.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) args.push(current);
  return args;
}

function receivedArgs(args: string[]): string[] {
  return msvcrtSplit(args.map(libuvQuote).join(" "));
}

describe("Windows login launcher", () => {
  const froggHome = "C:\\Users\\Jo Smith\\.frogg";
  const launcher = path.join(froggHome, "service", `${WINDOWS_RUN_VALUE}.cmd`);
  const plan = resolveServicePlan(
    planInput({
      platform: "win32",
      env: { PATH: "C:\\Windows" },
      froggHome,
      command: {
        program: "C:\\Program Files\\nodejs\\node.exe",
        args: [
          "C:\\Users\\Jo Smith\\AppData\\Roaming\\npm\\node_modules\\@frogg\\cli\\dist\\index.js",
          "daemon",
          "start",
          "--listen",
          "127.0.0.1:9999",
          "--home",
          froggHome,
        ],
      },
    }),
  );

  test("names the registration with a space-free brand slug", () => {
    expect(plan.label).toBe(WINDOWS_RUN_VALUE);
    expect(WINDOWS_RUN_VALUE).not.toMatch(/\s/);
  });

  test("writes a launcher that quotes every argument and escapes %", () => {
    expect(plan.file?.path).toBe(launcher);
    const lines = plan.file!.contents.split("\r\n");
    expect(lines[0]).toBe("@echo off");
    expect(lines[2]).toBe(
      'call "C:\\Program Files\\nodejs\\node.exe" ' +
        '"C:\\Users\\Jo Smith\\AppData\\Roaming\\npm\\node_modules\\@frogg\\cli\\dist\\index.js" ' +
        '"daemon" "start" "--listen" "127.0.0.1:9999" "--home" "C:\\Users\\Jo Smith\\.frogg"',
    );
    const percent = resolveServicePlan(
      planInput({
        platform: "win32",
        froggHome,
        command: { program: "C:\\100%\\frogg.exe", args: ["daemon", "start"] },
      }),
    );
    expect(percent.file?.contents).toContain('call "C:\\100%%\\frogg.exe" "daemon" "start"');
  });

  test("refuses a path a batch line cannot quote", () => {
    expect(() =>
      resolveServicePlan(
        planInput({ platform: "win32", command: { program: 'C:\\a"b\\frogg.exe', args: [] } }),
      ),
    ).toThrow(/quotes/);
  });

  test("registers the launcher under the per-user Run key", () => {
    const register = plan.install.find((command) => command.program === "reg")!;
    expect(register.optional).toBeUndefined();
    expect(receivedArgs(register.args)).toEqual([
      "add",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
      "/v",
      WINDOWS_RUN_VALUE,
      "/t",
      "REG_SZ",
      "/d",
      `"${launcher}"`,
      "/f",
    ]);
  });

  test("starts the launcher now through cmd with verbatim quoting", () => {
    const start = plan.install.at(-1)!;
    expect(start).toEqual({
      program: "cmd.exe",
      args: ["/d", "/s", "/c", `""${launcher}""`],
      verbatim: true,
    });
    // cmd /s drops the first and last quote of what follows /c.
    const line = start.args.join(" ");
    const afterC = line.slice(line.indexOf("/c ") + 3);
    expect(afterC.slice(1, -1)).toBe(`"${launcher}"`);
  });

  test("never creates a scheduled task, and removes the legacy one", () => {
    expect(
      plan.install.some(
        (command) => command.program === "schtasks" && command.args[0] === "/Create",
      ),
    ).toBe(false);
    const legacy = {
      program: "schtasks",
      args: ["/Delete", "/TN", LEGACY_WINDOWS_TASK_NAME, "/F"],
      optional: true,
    };
    expect(plan.install[0]).toEqual(legacy);
    expect(receivedArgs(legacy.args)).toEqual(["/Delete", "/TN", LEGACY_WINDOWS_TASK_NAME, "/F"]);
    expect(plan.uninstall).toEqual([
      {
        program: "reg",
        args: [
          "delete",
          "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
          "/v",
          WINDOWS_RUN_VALUE,
          "/f",
        ],
        optional: true,
      },
      legacy,
    ]);
  });
});
