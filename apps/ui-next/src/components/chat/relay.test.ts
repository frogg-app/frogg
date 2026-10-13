import { describe, expect, it } from "vitest";
import { parseRelay, resolveSender } from "./relay";

describe("parseRelay", () => {
  it("reads the short form", () => {
    expect(parseRelay("From Google Suite agent (cf989ce): Calendar sync landed.")).toEqual({
      name: "Google Suite",
      id: "cf989ce",
      where: null,
      body: "Calendar sync landed.",
    });
  });

  it("reads a quoted name with a worktree", () => {
    const r = parseRelay(
      'From the "Frogg Plugin: Google Suite" agent (cf989ce, worktree ~/.frogg/worktrees/1j7d90so/frogg-plugin-google-suite):\nThe picker is ready.',
    );
    expect(r).toEqual({
      name: "Frogg Plugin: Google Suite",
      id: "cf989ce",
      where: "worktree ~/.frogg/worktrees/1j7d90so/frogg-plugin-google-suite",
      body: "The picker is ready.",
    });
  });

  it("ignores ordinary messages", () => {
    expect(parseRelay("From now on, use tabs.")).toBeNull();
    expect(parseRelay("Please read the message from the agent (abc).")).toBeNull();
  });
});

describe("resolveSender", () => {
  it("matches a unique id prefix", () => {
    expect(resolveSender("cf989ce", ["cf989ce1-aaaa", "d00d"])).toBe("cf989ce1-aaaa");
    expect(resolveSender("cf98", ["cf989ce1", "cf98ffff"])).toBeNull();
    expect(resolveSender("beef", ["cf989ce1"])).toBeNull();
  });
});
