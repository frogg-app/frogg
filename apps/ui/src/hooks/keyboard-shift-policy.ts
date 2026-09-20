export const DEFAULT_IOS_KEYBOARD_INSET_MIN_HEIGHT = 120;

export function shouldUseCompactExplorerKeyboardPadding(input: {
  isGit: boolean;
  explorerTab: "changes" | "files" | "pr" | "ci";
}): boolean {
  return !input.isGit || input.explorerTab !== "changes";
}

export function resolveKeyboardShift(input: {
  rawKeyboardHeight: number;
  keyboardProgress: number;
  bottomInset: number;
  isIos: boolean;
  iosMinHeight: number;
}): number {
  "worklet";

  if (!(input.keyboardProgress > 0) || !(input.rawKeyboardHeight > 0)) {
    return 0;
  }

  // iOS can report a small accessory/prediction bar height during touch focus.
  // Treat that as non-keyboard so layouts don't "bounce" while interacting.
  if (input.isIos && input.rawKeyboardHeight < input.iosMinHeight) {
    return 0;
  }

  return Math.max(0, input.rawKeyboardHeight - input.bottomInset);
}

export function shouldReconcileHiddenKeyboardEnd(input: {
  height: number;
  progress: number;
}): boolean {
  "worklet";
  return !(input.height > 0) || !(input.progress > 0);
}

/**
 * How long a zero-height keyboard report that arrived without an animation is
 * held before we believe it.
 *
 * `react-native-keyboard-controller` resynchronises its Android state by
 * dispatching an instantaneous start/move/end trio (`duration: 0`) whenever
 * `onApplyWindowInsets` sees a height it did not expect — which happens while
 * the IME is still on screen and changes size (suggestion strip, screenshot
 * toolbar, layout switch). Believing that report immediately drops the composer
 * behind the keyboard until the next report puts it back: the "falls down and
 * pops back up" bounce.
 */
export const KEYBOARD_SHIFT_COLLAPSE_SETTLE_MS = 350;

/** Fade-out used when a deferred collapse is finally believed. */
export const KEYBOARD_SHIFT_COLLAPSE_DURATION_MS = 180;

/**
 * A dismissal the platform is actually animating. Real hides carry an animation
 * duration (`> 0`), and an interactive drag-dismiss reports `-1`; only the
 * synthetic resync trio reports exactly `0`.
 */
export function isAnimatedKeyboardHide(event: { height: number; duration: number }): boolean {
  "worklet";
  return !(event.height > 0) && event.duration !== 0;
}

export type KeyboardShiftTransition = "follow" | "deferred-collapse";

/**
 * Decide whether a new inset can be applied straight away, or whether it is a
 * suspect collapse that should be held until it is confirmed.
 */
export function resolveKeyboardShiftTransition(input: {
  nextShift: number;
  currentShift: number;
  hideInFlight: boolean;
}): KeyboardShiftTransition {
  "worklet";
  if (input.nextShift > 0) return "follow";
  if (!(input.currentShift > 0)) return "follow";
  if (input.hideInFlight) return "follow";
  return "deferred-collapse";
}
