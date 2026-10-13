import { useEffect } from "react";
import { BackHandler } from "react-native";

/**
 * Android hardware back. The handler returns true when it consumed the press. Handlers run
 * newest-first, so an open sheet registered later closes before the shell pops a push.
 * No-op on web and iOS.
 */
export function useHardwareBack(handler: () => boolean, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", handler);
    return () => sub.remove();
  }, [handler, enabled]);
}
