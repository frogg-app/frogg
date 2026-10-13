import type { RefObject } from "react";
import type { View } from "react-native";
import type { Rect } from "../tools/Menu";

/** Right-click has no native equivalent; rows open their menu on long-press instead. */
export function useContextMenu(_ref: RefObject<View | null>, _open: (r: Rect) => void): void {}
