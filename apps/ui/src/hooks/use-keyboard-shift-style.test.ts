import { describe, expect, it } from "vitest";
import {
  isAnimatedKeyboardHide,
  resolveKeyboardShiftTransition,
  shouldReconcileHiddenKeyboardEnd,
  resolveKeyboardShift,
  shouldUseCompactExplorerKeyboardPadding,
} from "./keyboard-shift-policy";

describe("resolveKeyboardShift", () => {
  it("keeps the existing open-keyboard offset behavior", () => {
    expect(
      resolveKeyboardShift({
        rawKeyboardHeight: 320,
        keyboardProgress: 1,
        bottomInset: 24,
        isIos: false,
        iosMinHeight: 120,
      }),
    ).toBe(296);
  });

  it("treats progress zero as closed even when Android reports a stale height", () => {
    expect(
      resolveKeyboardShift({
        rawKeyboardHeight: 320,
        keyboardProgress: 0,
        bottomInset: 24,
        isIos: false,
        iosMinHeight: 120,
      }),
    ).toBe(0);
  });

  it("still ignores small iOS accessory bar reports", () => {
    expect(
      resolveKeyboardShift({
        rawKeyboardHeight: 80,
        keyboardProgress: 1,
        bottomInset: 0,
        isIos: true,
        iosMinHeight: 120,
      }),
    ).toBe(0);
  });
});

describe("shouldReconcileHiddenKeyboardEnd", () => {
  it("closes stale iOS keyboard state without letting a late visible end resurrect it", () => {
    expect(
      shouldReconcileHiddenKeyboardEnd({
        height: 0,
        progress: 0,
      }),
    ).toBe(true);
    expect(
      shouldReconcileHiddenKeyboardEnd({
        height: 320,
        progress: 1,
      }),
    ).toBe(false);
  });
});

describe("shouldUseCompactExplorerKeyboardPadding", () => {
  it("keeps the changes viewport stable while preserving padding for other tabs", () => {
    expect(shouldUseCompactExplorerKeyboardPadding({ isGit: true, explorerTab: "changes" })).toBe(
      false,
    );
    expect(shouldUseCompactExplorerKeyboardPadding({ isGit: true, explorerTab: "files" })).toBe(
      true,
    );
    expect(shouldUseCompactExplorerKeyboardPadding({ isGit: false, explorerTab: "changes" })).toBe(
      true,
    );
  });
});

/**
 * Reproduction of the Android "composer drops behind the keyboard and pops back
 * up" bounce.
 *
 * `KeyboardAnimationCallback` on Android dispatches an instantaneous
 * start/move/end trio (`duration: 0`) whenever it detects a desynchronised
 * inset state — which it does while the IME is on screen and changes size, e.g.
 * when the suggestion strip appears after the first typed characters. That trio
 * can carry `height: 0`, and the keyboard is then re-reported at its real height
 * a moment later.
 *
 * `replayKeyboardEvents` composes the two policy calls the provider makes, in
 * the order the provider makes them, over such a trace.
 */
interface KeyboardTraceEvent {
  height: number;
  progress: number;
  duration: number;
  animatedHideTracking: boolean;
}

function replayKeyboardEvents(
  events: KeyboardTraceEvent[],
  options: { holdSuspectCollapses: boolean },
): number[] {
  let shift = 0;
  let hideInFlight = false;

  return events.map((event) => {
    if (event.animatedHideTracking) {
      hideInFlight = isAnimatedKeyboardHide(event);
    }
    const next = resolveKeyboardShift({
      rawKeyboardHeight: Math.abs(event.height),
      keyboardProgress: event.progress,
      bottomInset: 24,
      isIos: false,
      iosMinHeight: 120,
    });
    if (!options.holdSuspectCollapses) {
      shift = next;
      return shift;
    }
    const transition = resolveKeyboardShiftTransition({
      nextShift: next,
      currentShift: shift,
      hideInFlight,
    });
    // A deferred collapse keeps the current inset; the settle timer is what
    // would eventually lower it, and any later report cancels that timer.
    shift = transition === "follow" ? next : shift;
    return shift;
  });
}

/** Keyboard open, then the resync trio, then the IME reported back at height. */
const ANDROID_IME_RESIZE_DESYNC_TRACE: KeyboardTraceEvent[] = [
  { height: 320, progress: 1, duration: 250, animatedHideTracking: true },
  // desynchronised-state resync: start/move/end, no animation
  { height: 0, progress: 0, duration: 0, animatedHideTracking: true },
  { height: 0, progress: 0, duration: 0, animatedHideTracking: false },
  { height: 0, progress: 0, duration: 0, animatedHideTracking: true },
  // real IME height reported again once the insets settle
  { height: 352, progress: 1, duration: 0, animatedHideTracking: true },
];

/** A genuine dismissal: an animated hide stepping down to zero. */
const ANDROID_ANIMATED_HIDE_TRACE: KeyboardTraceEvent[] = [
  { height: 320, progress: 1, duration: 250, animatedHideTracking: true },
  { height: 0, progress: 0, duration: 250, animatedHideTracking: true },
  { height: 160, progress: 0.5, duration: 250, animatedHideTracking: false },
  { height: 0, progress: 0, duration: 250, animatedHideTracking: false },
];

describe("android keyboard inset bounce", () => {
  it("reproduces the bounce when every zero-height report is believed", () => {
    const shifts = replayKeyboardEvents(ANDROID_IME_RESIZE_DESYNC_TRACE, {
      holdSuspectCollapses: false,
    });

    // The composer falls to zero mid-sequence — behind the keyboard — and then
    // pops back up.
    expect(shifts).toEqual([296, 0, 0, 0, 328]);
  });

  it("holds the inset through the resync so the composer never drops", () => {
    const shifts = replayKeyboardEvents(ANDROID_IME_RESIZE_DESYNC_TRACE, {
      holdSuspectCollapses: true,
    });

    expect(shifts).toEqual([296, 296, 296, 296, 328]);
    expect(shifts.slice(1).some((shift) => shift === 0)).toBe(false);
  });

  it("still lowers the composer for a genuine animated dismissal", () => {
    const shifts = replayKeyboardEvents(ANDROID_ANIMATED_HIDE_TRACE, {
      holdSuspectCollapses: true,
    });

    expect(shifts).toEqual([296, 0, 136, 0]);
  });
});

describe("isAnimatedKeyboardHide", () => {
  it("separates real dismissals from the synthetic resync trio", () => {
    expect(isAnimatedKeyboardHide({ height: 0, duration: 250 })).toBe(true);
    // interactive drag-dismiss reports -1
    expect(isAnimatedKeyboardHide({ height: 0, duration: -1 })).toBe(true);
    expect(isAnimatedKeyboardHide({ height: 0, duration: 0 })).toBe(false);
    expect(isAnimatedKeyboardHide({ height: 320, duration: 250 })).toBe(false);
  });
});

describe("resolveKeyboardShiftTransition", () => {
  it("follows growth, holds a suspect collapse, follows a real hide", () => {
    expect(
      resolveKeyboardShiftTransition({ nextShift: 320, currentShift: 0, hideInFlight: false }),
    ).toBe("follow");
    expect(
      resolveKeyboardShiftTransition({ nextShift: 0, currentShift: 296, hideInFlight: false }),
    ).toBe("deferred-collapse");
    expect(
      resolveKeyboardShiftTransition({ nextShift: 0, currentShift: 296, hideInFlight: true }),
    ).toBe("follow");
    expect(
      resolveKeyboardShiftTransition({ nextShift: 0, currentShift: 0, hideInFlight: false }),
    ).toBe("follow");
  });
});
