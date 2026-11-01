import { describe, expect, it } from "vitest";
import { resolveTypedPath } from "./files";

describe("resolveTypedPath", () => {
  const root = "/home/dev/frogg";
  it.each([
    ["~", "~"],
    ["~/user", "~/user"],
    ["~/projects/", "~/projects"],
    ["/etc", "/etc"],
    ["/", "/"],
    ["C:/Users/Desktop", "C:/Users/Desktop"],
    ["C:\\Users\\Desktop\\", "C:\\Users\\Desktop"],
    ["C:/", "C:/"],
    ["c:", "c:/"],
    ["\\\\server\\share", "\\\\server\\share"],
    ['"/tmp/with space"', "/tmp/with space"],
  ])("keeps absolute %s", (input, out) => {
    expect(resolveTypedPath(input, root)).toBe(out);
  });

  it("resolves a relative path against the current root", () => {
    expect(resolveTypedPath("packages/server", root)).toBe("/home/dev/frogg/packages/server");
    expect(resolveTypedPath("./apps/", root)).toBe("/home/dev/frogg/apps");
  });

  it("needs a root for a relative path and something to go to", () => {
    expect(resolveTypedPath("apps", null)).toBeNull();
    expect(resolveTypedPath("   ", root)).toBeNull();
  });
});
