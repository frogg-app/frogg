import { describe, expect, it } from "vitest";
import {
  accountChoices,
  accountIdFor,
  flagsText,
  parseFlags,
  plainFlags,
  PRIMARY_ACCOUNT,
  tokenize,
  accountLaunchArgs,
  mergeFlags,
  withoutAccountFlags,
} from "./launch";

describe("launch flags", () => {
  it("reads switches and valued flags", () => {
    expect(parseFlags("--chrome")).toEqual({ args: { chrome: null } });
    expect(parseFlags(" --chrome --add-dir /srv/data --x=1 ")).toEqual({
      args: { chrome: null, "add-dir": "/srv/data", x: "1" },
    });
    expect(parseFlags("")).toEqual({ args: {} });
  });
  it("refuses stray values and short flags", () => {
    expect(parseFlags("chrome")).toHaveProperty("error");
    expect(parseFlags("-c")).toHaveProperty("error");
    expect(parseFlags("--Bad_Name")).toHaveProperty("error");
  });
  it("round-trips quoted values", () => {
    expect(tokenize(`--add-dir "C:\\My Files" --chrome`)).toEqual([
      "--add-dir",
      "C:\\My Files",
      "--chrome",
    ]);
    expect(flagsText(["--add-dir", "C:\\My Files"])).toBe(`--add-dir "C:\\My Files"`);
  });
});

describe("account choices", () => {
  const a = (id: string, name: string, authenticated = true) => ({ id, name, authenticated });
  it("has nothing to pick with no accounts", () => {
    expect(accountChoices({ accounts: [], defaultAccountId: null })).toBeNull();
    expect(accountChoices(undefined)).toBeNull();
  });
  it("adds the primary sign-in when the daemon does not list it and starts on the active one", () => {
    const c = accountChoices({ accounts: [a("work", "work")], defaultAccountId: "work" });
    expect(c?.options.map((o) => o.value)).toEqual([PRIMARY_ACCOUNT, "work"]);
    expect(c?.initial).toBe("work");
    expect(accountIdFor(c?.primary ?? null, c?.primary ?? "")).toBeNull();
    expect(accountIdFor("work", c?.primary ?? "")).toBe("work");
  });
  it("uses the listed default and falls back to it when the active one is gone", () => {
    const c = accountChoices({
      accounts: [a("default:claude", "default"), a("home", "home", false)],
      defaultAccountId: "deleted",
    });
    expect(c?.options).toEqual([
      { value: "default:claude", label: "Default", hint: undefined },
      { value: "home", label: "home", hint: "signed out" },
    ]);
    expect(c?.initial).toBe("default:claude");
  });
  it("hides the picker for a lone listed account", () => {
    expect(
      accountChoices({ accounts: [a("default:claude", "default")], defaultAccountId: null }),
    ).toBeNull();
  });
});

describe("account launch flags", () => {
  it("starts from the account's flags and lets the project override a shared one", () => {
    expect(
      mergeFlags(["--chrome", "--remote-control", "mac"], ["--remote-control", "work"]),
    ).toEqual(["--chrome", "--remote-control", "work"]);
    expect(mergeFlags([], ["--add-dir", "/x"])).toEqual(["--add-dir", "/x"]);
  });

  it("keeps an account's flags out of the project's saved defaults", () => {
    expect(withoutAccountFlags("--chrome --add-dir /x", ["--chrome"])).toEqual(["--add-dir", "/x"]);
    // Same flag, different value: the project means it.
    expect(withoutAccountFlags("--remote-control work", ["--remote-control", "mac"])).toEqual([
      "--remote-control",
      "work",
    ]);
  });

  it("reads the picked account's flags from the snapshot", () => {
    const entry = {
      accounts: [
        { id: "a", name: "mac", authenticated: true, preferences: { launchArgs: ["--chrome"] } },
        { id: "b", name: "win", authenticated: true },
      ],
    };
    expect(accountLaunchArgs(entry, "a")).toEqual(["--chrome"]);
    expect(accountLaunchArgs(entry, "b")).toEqual([]);
    expect(accountLaunchArgs(entry, null)).toEqual([]);
  });
});

describe("plainFlags", () => {
  it("turns smart dashes and quotes back into what was typed", () => {
    expect(plainFlags("\u2014chrome")).toBe("--chrome");
    expect(plainFlags("\u2013add-dir \u201c/a b\u201d")).toBe('--add-dir "/a b"');
    expect(plainFlags("--chrome")).toBe("--chrome");
  });
});
