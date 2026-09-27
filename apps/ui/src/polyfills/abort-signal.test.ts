import { describe, expect, it } from "vitest";
import { polyfillAbortSignal } from "./abort-signal";

describe("polyfillAbortSignal", () => {
  it("adds throwIfAborted to a signal class without it", () => {
    class LegacySignal {
      aborted = false;
    }
    polyfillAbortSignal({ AbortSignal: LegacySignal as never });
    const signal = new LegacySignal() as LegacySignal & { throwIfAborted(): void };
    expect(() => signal.throwIfAborted()).not.toThrow();
    signal.aborted = true;
    expect(() => signal.throwIfAborted()).toThrow(expect.objectContaining({ name: "AbortError" }));
  });

  it("leaves a native implementation alone", () => {
    const native = AbortSignal.prototype.throwIfAborted;
    polyfillAbortSignal();
    expect(AbortSignal.prototype.throwIfAborted).toBe(native);
  });
});
