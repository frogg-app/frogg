import type { StyleProp, ViewStyle } from "react-native";

/**
 * Narrowest a menu frame is allowed to open to.
 *
 * The frame is absolutely positioned and its body scrolls, so the rows inside
 * cannot push it wider — it takes the floor it is given. Anchoring that floor
 * to the trigger alone collapses the menu to the width of a short label ("Local
 * ⌄"), which truncates every row to a few characters. The trigger still raises
 * the floor when it is the wider of the two.
 */
const MIN_FRAME_WIDTH = 200;

export interface DesktopFrameStyleInput {
  desktopMinWidth: number | undefined;
  desktopLockWidth: boolean;
  referenceWidth: number | null;
  desktopFixedHeight: number | undefined;
  desktopPositionStyle: StyleProp<ViewStyle>;
  shouldHideDesktopContent: boolean;
  availableHeight: number | undefined;
}

export function buildDesktopFrameStyle(input: DesktopFrameStyleInput): StyleProp<ViewStyle> {
  const {
    desktopMinWidth,
    desktopLockWidth,
    referenceWidth,
    desktopFixedHeight,
    desktopPositionStyle,
    shouldHideDesktopContent,
    availableHeight,
  } = input;
  const fixedHeightStyle =
    desktopFixedHeight != null
      ? { minHeight: desktopFixedHeight, maxHeight: desktopFixedHeight }
      : null;
  const hiddenStyle = shouldHideDesktopContent ? { opacity: 0 } : null;
  const availableHeightStyle =
    typeof availableHeight === "number"
      ? { maxHeight: Math.min(availableHeight, desktopFixedHeight ?? 400) }
      : null;
  // A locked frame is pinned to what the caller asked for; only an unlocked one
  // is free to take the readable minimum.
  const lockedFloor = Math.max(desktopMinWidth ?? 0, referenceWidth ?? MIN_FRAME_WIDTH);
  const floor = desktopLockWidth ? lockedFloor : Math.max(lockedFloor, MIN_FRAME_WIDTH);
  const widthStyle = desktopLockWidth
    ? { width: floor, minWidth: floor, maxWidth: floor }
    : { minWidth: floor, maxWidth: Math.max(400, floor) };
  return [
    {
      position: "absolute" as const,
      ...widthStyle,
    },
    fixedHeightStyle,
    desktopPositionStyle,
    hiddenStyle,
    availableHeightStyle,
  ];
}
