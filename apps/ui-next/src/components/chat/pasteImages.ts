import type { RefObject } from "react";
import type { TextInput } from "react-native";
import type { Attachment } from "./actions";

/**
 * Native TextInput exposes no paste event and this build has no clipboard module, so pasted
 * images are a web/desktop feature for now.
 */
export function usePasteImages(
  _input: RefObject<TextInput | null>,
  _onAdd: (a: Attachment[]) => void,
  _enabled: boolean,
): void {}
