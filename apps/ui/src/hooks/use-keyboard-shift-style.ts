import { createElement, useEffect, useMemo, type ReactNode } from "react";
import { Platform } from "react-native";
import type { ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useGenericKeyboardHandler,
  useReanimatedKeyboardAnimation,
} from "react-native-keyboard-controller";
import {
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import {
  DEFAULT_IOS_KEYBOARD_INSET_MIN_HEIGHT,
  isAnimatedKeyboardHide,
  KEYBOARD_SHIFT_COLLAPSE_DURATION_MS,
  KEYBOARD_SHIFT_COLLAPSE_SETTLE_MS,
  resolveKeyboardShift,
  resolveKeyboardShiftTransition,
  shouldReconcileHiddenKeyboardEnd,
} from "@/hooks/keyboard-shift-policy";
import { KeyboardShiftContext, useKeyboardShift } from "@/hooks/keyboard-shift-context";

type KeyboardShiftMode = "translate" | "padding";

export function KeyboardShiftProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { height: keyboardHeight, progress: keyboardProgress } = useReanimatedKeyboardAnimation();
  const bottomInset = useSharedValue(insets.bottom);
  const isIos = Platform.OS === "ios";
  // True only while the platform is actually animating the keyboard away, so a
  // synthetic zero-height resync cannot be mistaken for a dismissal.
  const hideInFlight = useSharedValue(false);

  useEffect(() => {
    bottomInset.value = insets.bottom;
  }, [bottomInset, insets.bottom]);

  useGenericKeyboardHandler(
    {
      onStart: (event) => {
        "worklet";
        hideInFlight.value = isAnimatedKeyboardHide(event);
      },
      onInteractive: (event) => {
        "worklet";
        hideInFlight.value = isAnimatedKeyboardHide(event);
      },
      onEnd: (event) => {
        "worklet";
        hideInFlight.value = isAnimatedKeyboardHide(event);
        if (isIos && shouldReconcileHiddenKeyboardEnd(event)) {
          keyboardHeight.value = 0;
          keyboardProgress.value = 0;
        }
      },
    },
    [hideInFlight, isIos, keyboardHeight, keyboardProgress],
  );

  const rawShift = useDerivedValue(() => {
    "worklet";
    return resolveKeyboardShift({
      rawKeyboardHeight: Math.abs(keyboardHeight.value),
      keyboardProgress: keyboardProgress.value,
      bottomInset: bottomInset.value,
      isIos,
      iosMinHeight: DEFAULT_IOS_KEYBOARD_INSET_MIN_HEIGHT,
    });
  });

  const shift = useSharedValue(0);

  useAnimatedReaction(
    () => rawShift.value,
    (next) => {
      "worklet";
      const transition = resolveKeyboardShiftTransition({
        nextShift: next,
        currentShift: shift.value,
        hideInFlight: hideInFlight.value,
      });
      if (transition === "follow") {
        // A plain assignment also cancels any pending deferred collapse.
        shift.value = next;
        return;
      }
      // Suspect collapse: keep the composer above the keyboard, and only give
      // the inset up if nothing contradicts the report.
      shift.value = withDelay(
        KEYBOARD_SHIFT_COLLAPSE_SETTLE_MS,
        withTiming(0, { duration: KEYBOARD_SHIFT_COLLAPSE_DURATION_MS }),
      );
    },
    [],
  );

  const value = useMemo(
    () => ({
      shift,
      bottomInset,
    }),
    [bottomInset, shift],
  );

  return createElement(KeyboardShiftContext.Provider, { value }, children);
}

export function useKeyboardShiftStyle(input: { mode: KeyboardShiftMode; enabled?: boolean }): {
  shift: SharedValue<number>;
  style: ReturnType<typeof useAnimatedStyle<ViewStyle>>;
} {
  const { shift, bottomInset } = useKeyboardShift();
  const mode = input.mode;
  const enabled = input.enabled ?? true;

  const style = useAnimatedStyle<ViewStyle>(() => {
    "worklet";
    if (mode === "padding") {
      if (!enabled) {
        return { paddingBottom: 0 };
      }
      // Include safe-area bottom inset so content clears the home indicator even without a keyboard.
      return { paddingBottom: bottomInset.value + shift.value };
    }

    return { transform: [{ translateY: enabled ? -shift.value : 0 }] };
  }, [enabled, mode]);

  return { shift, style };
}
