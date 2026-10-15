import { describe, expect, it } from "vitest";
import {
  accountChoices,
  accountIdFor,
  flagsText,
  parseFlags,
  PRIMARY_ACCOUNT,
  tokenize,
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
