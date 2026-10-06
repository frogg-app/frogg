import { Share } from "react-native";

/** Native has no clipboard module in this build; hand the text to the share sheet instead. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await Share.share({ message: text });
    return true;
  } catch {
    return false;
  }
}
