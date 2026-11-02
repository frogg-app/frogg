import { describe, expect, test } from "vitest";

import { WINDOWS_RUN_KEY, WINDOWS_RUN_VALUE, windowsRunCommand } from "./plan.js";
import {
  legacyLauncherPath,
  parseRegQueryValue,
  upgradeWindowsRunKey,
  type RunKeyDeps,
} from "./windows-run-key.js";

const LAUNCHER = String.raw`C:\Users\dev\.frogg\service\frogg-daemon.cmd`;

function regQuery(data: string, type = "REG_SZ"): string {
  return `\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\r\n    ${WINDOWS_RUN_VALUE}    ${type}    ${data}\r\n\r\n`;
}

function fakeReg(query: { status: number | null; stdout: string }, addStatus = 0) {
  const calls: string[][] = [];
  const deps: RunKeyDeps = {
    run: (command, args) => {
      calls.push([command, ...args]);
      return args[0] === "query" ? query : { status: addStatus, stdout: "" };
    },
  };
  return { calls, deps };
}

describe("parsing reg query output", () => {
  test("reads the value's data, spaces included", () => {
    expect(parseRegQueryValue(regQuery(windowsRunCommand(LAUNCHER)), WINDOWS_RUN_VALUE)).toBe(
      windowsRunCommand(LAUNCHER),
    );
  });

  test("accepts REG_EXPAND_SZ and matches the name case-insensitively", () => {
    const output = regQuery(`"${LAUNCHER}"`, "REG_EXPAND_SZ").replace(
      WINDOWS_RUN_VALUE,
      WINDOWS_RUN_VALUE.toUpperCase(),
    );
    expect(parseRegQueryValue(output, WINDOWS_RUN_VALUE)).toBe(`"${LAUNCHER}"`);
  });

  test("is null when the value is not listed", () => {
    expect(parseRegQueryValue("\r\nHKEY_CURRENT_USER\\...\\Run\r\n", WINDOWS_RUN_VALUE)).toBeNull();
  });
});

describe("recognising the pre-headless value", () => {
  test.each([`"${LAUNCHER}"`, LAUNCHER])("%s is a bare launcher path", (data) => {
    expect(legacyLauncherPath(data)).toBe(LAUNCHER);
  });

  test("the headless command and other commands are not", () => {
    expect(legacyLauncherPath(windowsRunCommand(LAUNCHER))).toBeNull();
    expect(legacyLauncherPath(String.raw`"C:\tools\frogg.exe" daemon start`)).toBeNull();
  });
});

describe("upgrading the Run key", () => {
  test("rewrites a bare launcher path to the headless command", () => {
    const { calls, deps } = fakeReg({ status: 0, stdout: regQuery(`"${LAUNCHER}"`) });
    expect(upgradeWindowsRunKey("win32", deps)).toBe("upgraded");
    expect(calls).toEqual([
      ["reg", "query", WINDOWS_RUN_KEY, "/v", WINDOWS_RUN_VALUE],
      [
        "reg",
        "add",
        WINDOWS_RUN_KEY,
        "/v",
        WINDOWS_RUN_VALUE,
        "/t",
        "REG_SZ",
        "/d",
        windowsRunCommand(LAUNCHER),
        "/f",
      ],
    ]);
  });

  test("leaves a current value alone", () => {
    const { calls, deps } = fakeReg({ status: 0, stdout: regQuery(windowsRunCommand(LAUNCHER)) });
    expect(upgradeWindowsRunKey("win32", deps)).toBe("current");
    expect(calls).toHaveLength(1);
  });

  test("leaves a value the user edited alone", () => {
    const { calls, deps } = fakeReg({
      status: 0,
      stdout: regQuery(String.raw`"C:\tools\start-frogg.bat" --quiet`),
    });
    expect(upgradeWindowsRunKey("win32", deps)).toBe("custom");
    expect(calls).toHaveLength(1);
  });

  test("does nothing when no service is installed", () => {
    const { calls, deps } = fakeReg({ status: 1, stdout: "" });
    expect(upgradeWindowsRunKey("win32", deps)).toBe("absent");
    expect(calls).toHaveLength(1);
  });

  test("reports a failed rewrite without throwing", () => {
    const { deps } = fakeReg({ status: 0, stdout: regQuery(`"${LAUNCHER}"`) }, 1);
    expect(upgradeWindowsRunKey("win32", deps)).toBe("failed");
    const throwing: RunKeyDeps = {
      run: () => {
        throw new Error("spawn reg ENOENT");
      },
    };
    expect(upgradeWindowsRunKey("win32", throwing)).toBe("failed");
  });

  test("never touches the registry off Windows", () => {
    const { calls, deps } = fakeReg({ status: 0, stdout: regQuery(`"${LAUNCHER}"`) });
    expect(upgradeWindowsRunKey("linux", deps)).toBe("absent");
    expect(calls).toEqual([]);
  });
});
