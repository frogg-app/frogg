import { useUnistyles } from "react-native-unistyles";
import { isNative, isWeb } from "@/constants/platform";

export const FOOTER_HEIGHT = 75;

// Shared header inner height (excluding safe area insets and border)
// Used by both agent header (ScreenHeader) and explorer sidebar header
// This ensures both headers have the same visual height
export const HEADER_INNER_HEIGHT = 36;
export const HEADER_INNER_HEIGHT_MOBILE = 56;
export const WORKSPACE_SECONDARY_HEADER_HEIGHT = 36;
export const HEADER_TOP_PADDING_MOBILE = 8;

// Max width for chat content (stream view, input area, new agent form)
export const MAX_CONTENT_WIDTH = 820;
export const COMPACT_FORM_FACTOR_WIDTH = 500;

// Settings uses the canonical desktop list + detail layout. Its sidebar and
// detail target must fit together before it can share width with app navigation.
export const SETTINGS_DESKTOP_SIDEBAR_WIDTH = 320;
export const SETTINGS_DESKTOP_DETAIL_MIN_WIDTH = 400;
export const SETTINGS_DESKTOP_SPLIT_MIN_WIDTH =
  SETTINGS_DESKTOP_SIDEBAR_WIDTH + SETTINGS_DESKTOP_DETAIL_MIN_WIDTH;

// Desktop app constants for macOS traffic light buttons
// These buttons (close/minimize/maximize) overlay the top-left corner
export const DESKTOP_TRAFFIC_LIGHT_WIDTH = 78;
export const DESKTOP_TRAFFIC_LIGHT_HEIGHT = 45;

// Custom desktop window controls (minimize/maximize/close) — top-right
export const DESKTOP_WINDOW_CONTROLS_HEIGHT = HEADER_INNER_HEIGHT;

export {
  getIsElectron as getIsElectronRuntime,
  getIsElectronMac as getIsElectronRuntimeMac,
} from "./platform";

/**
 * Reactive hook — re-renders the component when the breakpoint changes.
 * Always use this instead of reading UnistylesRuntime.breakpoint directly.
 */
export function useIsCompactFormFactor(): boolean {
  const { rt } = useUnistyles();
  return rt.breakpoint === "xs" || rt.breakpoint === "sm";
}

/**
 * Reactive hook — true when the surface is driven by a thumb rather than a pointer.
 *
 * Distinct from {@link useIsCompactFormFactor}, which answers a question about
 * width and governs layout. This answers a question about the input device and
 * governs presentation: an Android tablet is wide enough for the desktop shell
 * but is still touched, so its menus want sheets and thumb-sized rows rather
 * than anchored popovers sized for a mouse. The popover path is already
 * web-gated in several places (`resolveIsDesktopAboveSearch`,
 * `shouldUseMeasuredTopStart`), so routing native there at all was the
 * inconsistency this closes.
 */
export function useIsCompactInteraction(): boolean {
  return useIsCompactFormFactor() || isNative;
}

// SplitContainer relies on dnd-kit and DOM-backed accessibility helpers.
// Keep that capability distinct from desktop-width layout so touch tablets
// can use the desktop shell without entering web-only code paths.
export function supportsDesktopPaneSplits(): boolean {
  return isWeb;
}
