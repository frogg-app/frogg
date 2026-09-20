import { describe, expect, test } from "vitest";
import { mixColor } from "./color-mix";

describe("mixColor", () => {
  test("returns the endpoints at the ends", () => {
    expect(mixColor("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixColor("#000000", "#ffffff", 1)).toBe("#ffffff");
  });

  test("blends in the middle", () => {
    expect(mixColor("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  test("understands short hex and rgb()", () => {
    expect(mixColor("#000", "#fff", 1)).toBe("#fff");
    expect(mixColor("rgb(0, 0, 0)", "#ffffff", 0.5)).toBe("#808080");
  });

  test("snaps to the target when a colour cannot be parsed", () => {
    expect(mixColor("var(--whatever)", "#c44a4a", 0.5)).toBe("#c44a4a");
  });
});
