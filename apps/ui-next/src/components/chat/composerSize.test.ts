import { describe, expect, it } from "vitest";
import { bounds, targetHeight } from "./composerSize";

const b = bounds(48, 900);

describe("composer height", () => {
  it("follows the text between the minimum and the auto cap", () => {
    expect(targetHeight("auto", 20, b)).toBe(48);
    expect(targetHeight("auto", 100, b)).toBe(100);
    expect(targetHeight("auto", 5000, b)).toBe(b.auto);
  });

  it("expands to half the window and clamps a dragged height", () => {
    expect(targetHeight("expanded", 20, b)).toBe(450);
    expect(targetHeight(10, 20, b)).toBe(48);
    expect(targetHeight(9999, 20, b)).toBe(b.max);
    expect(b.max).toBe(630);
  });

  it("keeps the auto cap at or under the expanded height on short windows", () => {
    const small = bounds(40, 300);
    expect(small.auto).toBeLessThanOrEqual(small.expanded);
    expect(small.expanded).toBeLessThanOrEqual(small.max);
  });
});
