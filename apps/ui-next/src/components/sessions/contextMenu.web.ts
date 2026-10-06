import { useEffect, useRef, type RefObject } from "react";
import type { View } from "react-native";
import type { Rect } from "../tools/Menu";

/** Right-click on a row opens its menu at the pointer (react-native-web refs are DOM nodes). */
export function useContextMenu(ref: RefObject<View | null>, open: (r: Rect) => void): void {
  const cb = useRef(open);
  cb.current = open;
  useEffect(() => {
    const node = ref.current as unknown as HTMLElement | null;
    if (!node) return;
    const on = (e: MouseEvent) => {
      e.preventDefault();
      cb.current({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
    };
    node.addEventListener("contextmenu", on);
    return () => node.removeEventListener("contextmenu", on);
  }, [ref]);
}
