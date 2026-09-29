import { ReduceMotion, ReducedMotionConfig } from "react-native-reanimated";
import { useSettings } from "@/hooks/use-settings";

/**
 * Frogg animates by default and ignores the OS reduced-motion request: on Windows that follows
 * "Animation effects", which froze loaders and made working agents look stuck. People who want
 * less motion turn on Settings → Appearance → Motion → Reduce motion. Use this instead of
 * Reanimated's `useReducedMotion()`, which reads the OS.
 */
export function useReduceMotion(): boolean {
  return useSettings((settings) => settings.reduceMotion);
}

/** Points Reanimated's default (`ReduceMotion.System`) animations at the app setting. */
export function ReduceMotionSync() {
  const reduceMotion = useReduceMotion();
  return <ReducedMotionConfig mode={reduceMotion ? ReduceMotion.Always : ReduceMotion.Never} />;
}
