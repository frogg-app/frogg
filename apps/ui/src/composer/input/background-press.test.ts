import { describe, expect, it } from "vitest";
import { isComposerBackgroundPress } from "./background-press";

function target(match: string | null) {
  return {
    closest: (selector: string) => (match !== null && selector.includes(match) ? {} : null),
  };
}

describe("isComposerBackgroundPress", () => {
  it("treats a press on non-interactive chrome as background", () => {
    expect(isComposerBackgroundPress(target(null))).toBe(true);
  });

  it("ignores presses that land on a control", () => {
    expect(isComposerBackgroundPress(target("button"))).toBe(false);
    expect(isComposerBackgroundPress(target("textarea"))).toBe(false);
    expect(isComposerBackgroundPress(target("[role='switch']"))).toBe(false);
  });

  it("ignores targets that are not elements", () => {
    expect(isComposerBackgroundPress(null)).toBe(false);
    expect(isComposerBackgroundPress({})).toBe(false);
  });
});
