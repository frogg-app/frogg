/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { Animated } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MOTION_SWAP_DURATION_MS, MOTION_SWAP_EASING } from "@/styles/motion";
import { useFadePresence } from "./use-fade-presence";

/**
 * Animated finishes instantly under test, so the timing is driven by hand here: each
 * `Animated.timing` call is recorded and finishes only when the test says so.
 */
interface Pending {
  toValue: number;
  duration: number | undefined;
  easing: unknown;
  finish: (finished: boolean) => void;
}

function recordTimings(): Pending[] {
  const pending: Pending[] = [];
  vi.spyOn(Animated, "timing").mockImplementation((_value, config) => {
    let callback: Animated.EndCallback | undefined;
    const entry: Pending = {
      toValue: config.toValue as number,
      duration: config.duration,
      easing: config.easing,
      finish: (finished) => callback?.({ finished }),
    };
    pending.push(entry);
    return {
      start: (cb?: Animated.EndCallback) => {
        callback = cb;
      },
      stop: () => {},
      reset: () => {},
    } as Animated.CompositeAnimation;
  });
  return pending;
}

afterEach(() => vi.restoreAllMocks());

describe("useFadePresence", () => {
  it("fades with the swap motion tokens", () => {
    const timings = recordTimings();
    const { rerender } = renderHook(({ visible }) => useFadePresence(visible), {
      initialProps: { visible: false },
    });
    rerender({ visible: true });
    const last = timings.at(-1)!;
    expect(last).toMatchObject({ toValue: 1, duration: MOTION_SWAP_DURATION_MS });
    expect(last.easing).toBe(MOTION_SWAP_EASING);
    expect(MOTION_SWAP_DURATION_MS).toBeGreaterThanOrEqual(120);
    expect(MOTION_SWAP_DURATION_MS).toBeLessThanOrEqual(180);
  });

  it("mounts in the render that shows it, and stays mounted until the fade-out ends", () => {
    const timings = recordTimings();
    const { result, rerender } = renderHook(({ visible }) => useFadePresence(visible), {
      initialProps: { visible: false },
    });
    expect(result.current.mounted).toBe(false);
    rerender({ visible: true });
    expect(result.current.mounted).toBe(true);
    rerender({ visible: false });
    // Fading out: still mounted, so the swap is a cross-fade and never an empty frame.
    expect(result.current.mounted).toBe(true);
    act(() => timings.at(-1)!.finish(true));
    expect(result.current.mounted).toBe(false);
  });

  it("does not unmount when shown again before a fade-out completes", () => {
    const timings = recordTimings();
    const { result, rerender } = renderHook(({ visible }) => useFadePresence(visible), {
      initialProps: { visible: true },
    });
    rerender({ visible: false });
    const fadeOut = timings.at(-1)!;
    rerender({ visible: true });
    // The interrupted fade-out reports unfinished; a late "finished" must not win either.
    act(() => fadeOut.finish(false));
    act(() => fadeOut.finish(true));
    expect(result.current.mounted).toBe(true);
  });

  it("starts opaque when visible from the first render", () => {
    recordTimings();
    const { result } = renderHook(() => useFadePresence(true));
    // A permanent control (the touch kebab) must not fade in on every row on mount.
    expect((result.current.progress as unknown as { __getValue: () => number }).__getValue()).toBe(
      1,
    );
  });
});
