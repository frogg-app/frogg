import type { RefObject } from "react";
import type { TextInput } from "react-native";
import type { Picked } from "./upload";

/**
 * Native TextInput has no paste event, so a picture on the clipboard comes in through the +
 * button's "Paste image" instead (see `clipboardImage.ts`).
 */
export function usePastePictures(
  _input: RefObject<TextInput | null>,
  _onPicked: (picked: Picked[]) => void,
  _enabled: boolean,
): void {}
