import { describe, expect, it } from "vitest";
import { resolveActivityReduceMotion } from "@/hooks/activity-reduce-motion";

describe("resolveActivityReduceMotion", () => {
  it.each([
    { os: false, animateAnyway: false, expected: false },
    { os: false, animateAnyway: true, expected: false },
    { os: true, animateAnyway: false, expected: true },
    { os: true, animateAnyway: true, expected: false },
  ])(
    "OS reduced motion $os, preference $animateAnyway -> $expected",
    ({ os, animateAnyway, expected }) => {
      expect(resolveActivityReduceMotion(os, animateAnyway)).toBe(expected);
    },
  );
});
