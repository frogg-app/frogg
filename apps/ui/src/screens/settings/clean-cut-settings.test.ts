import { describe, expect, it } from "vitest";
import {
  inheritedThresholdMinutes,
  listOverrideProviders,
  parseThresholdDraft,
} from "./clean-cut-settings";

describe("clean cut settings", () => {
  it("parses a threshold draft: empty clears, whole minutes within bounds", () => {
    expect(parseThresholdDraft("")).toEqual({ minutes: null });
    expect(parseThresholdDraft(" 90 ")).toEqual({ minutes: 90 });
    expect(parseThresholdDraft("0")).toEqual({ invalid: true });
    expect(parseThresholdDraft("1.5")).toEqual({ invalid: true });
    expect(parseThresholdDraft("999999")).toEqual({ invalid: true });
  });

  it("shows what a provider inherits without its own threshold", () => {
    expect(inheritedThresholdMinutes("claude", null)).toBe(60);
    expect(inheritedThresholdMinutes("claude", { idleThresholdMinutes: 20 })).toBe(20);
    expect(inheritedThresholdMinutes("copilot", { idleThresholdMinutes: 20 })).toBeNull();
  });

  it("keeps an override for a provider that is no longer offered, so it can be cleared", () => {
    expect(
      listOverrideProviders([{ id: "claude", label: "Claude" }], {
        providers: { claude: {}, gone: { idleThresholdMinutes: 5 } },
      }),
    ).toEqual([
      { id: "claude", label: "Claude" },
      { id: "gone", label: "gone" },
    ]);
  });
});
