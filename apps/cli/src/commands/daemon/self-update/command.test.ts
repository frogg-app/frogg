import { describe, expect, test } from "vitest";
import { parseChannel } from "./command.js";

describe("self-update --channel", () => {
  test("defaults to the channel of the running version", () => {
    expect(parseChannel(undefined, "1.6.14")).toBe("stable");
    expect(parseChannel(undefined, "1.6.14-acme.2")).toBe("stable");
    expect(parseChannel(undefined, "1.6.14-beta.2")).toBe("beta");
  });

  test("either channel updates the same install", () => {
    expect(parseChannel("beta", "1.6.14")).toBe("beta");
    expect(parseChannel("stable", "1.6.14-beta.2")).toBe("stable");
    expect(() => parseChannel("nightly", "1.6.14")).toThrow(/expected stable or beta/);
  });
});
