import type { LucideIcon } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";

function makeThemed(icon: LucideIcon) {
  return withUnistyles(icon);
}

export type ThemedIcon = ReturnType<typeof makeThemed>;

// One themed wrapper per icon, shared by every soft control that shows it.
const themedIcons = new Map<LucideIcon, ThemedIcon>();

/** A lucide icon wrapped so `uniProps` colour mappings receive real theme values. */
export function themedIcon(icon: LucideIcon): ThemedIcon {
  let themed = themedIcons.get(icon);
  if (!themed) {
    themed = makeThemed(icon);
    themedIcons.set(icon, themed);
  }
  return themed;
}
