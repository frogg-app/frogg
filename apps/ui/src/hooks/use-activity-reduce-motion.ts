import { ReduceMotion, useReducedMotion } from "react-native-reanimated";
import { resolveActivityReduceMotion } from "@/hooks/activity-reduce-motion";
import { useSettings } from "@/hooks/use-settings";

function useAnimateActivityUnderReducedMotion(): boolean {
  return useSettings((settings) => settings.animateActivityUnderReducedMotion);
}

/** Whether an activity indicator should hold still. Only for activity indicators. */
export function useActivityReduceMotion(): boolean {
  return resolveActivityReduceMotion(useReducedMotion(), useAnimateActivityUnderReducedMotion());
}

/**
 * The `reduceMotion` config for an activity indicator's Reanimated animation. `withRepeat`
 * hands it down to child animations that leave it unset, so passing it there is enough.
 */
export function useActivityReduceMotionConfig(): ReduceMotion {
  return useAnimateActivityUnderReducedMotion() ? ReduceMotion.Never : ReduceMotion.System;
}
