import type { RefObject } from "react";
import type { View } from "react-native";
import type { Picked } from "./upload";

/** Native has no drag and drop from the OS; nothing is ever over the target. */
export function useDropFiles(
  _target: RefObject<View | null>,
  _onDrop: (picked: Picked[]) => void,
  _opts: { enabled: boolean; inlineImages?: boolean },
): boolean {
  return false;
}
