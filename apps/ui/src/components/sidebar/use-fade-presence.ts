import { useCallback, useEffect, useRef, useState } from "react";
import { Animated } from "react-native";
import { MOTION_SWAP_DURATION_MS, MOTION_SWAP_EASING } from "@/styles/motion";

/**
 * Keeps something mounted while it fades out, so a swap is a cross-fade and never a frame of
 * nothing. Something already visible on the first render starts opaque: a permanent control
 * (the kebab on touch) must not fade in on every row every time the list mounts.
 *
 * Reversible mid-flight: a re-show during a fade-out picks up from the current opacity rather
 * than restarting from zero, so a quick Alt tap or a pointer crossing back cannot blink.
 */
export function useFadePresence(visible: boolean): {
  mounted: boolean;
  /** 0 → 1. Drives opacity, and anything that should move with it (the rail's width). */
  progress: Animated.Value;
} {
  const [mounted, setMounted] = useState(visible);
  const [progress] = useState(() => new Animated.Value(visible ? 1 : 0));
  // Mount in the same render that turns it on, so the fade starts from the first frame.
  if (visible && !mounted) setMounted(true);
  const visibleRef = useRef(visible);
  // A fade-out completing re-checks, because a re-show can land in between.
  const unmountIfHidden = useCallback(() => {
    if (!visibleRef.current) setMounted(false);
  }, []);

  useEffect(() => {
    visibleRef.current = visible;
    // JS-driven: the rail's width follows the same value, and width cannot run on the native
    // driver. Only desktop pointers ever animate this — touch has no hover and no Alt.
    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: MOTION_SWAP_DURATION_MS,
      easing: MOTION_SWAP_EASING,
      useNativeDriver: false,
    });
    animation.start(({ finished }) => {
      if (finished && !visible) unmountIfHidden();
    });
    return () => animation.stop();
  }, [visible, progress, unmountIfHidden]);

  return { mounted: mounted || visible, progress };
}
