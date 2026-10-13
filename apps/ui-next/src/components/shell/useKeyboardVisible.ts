import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/** Whether the software keyboard is up (always false on web). */
export function useKeyboardVisible(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const show = Keyboard.addListener("keyboardDidShow", () => setShown(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return shown;
}
