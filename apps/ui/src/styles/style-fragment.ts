import type { TextStyle, ViewStyle } from "react-native";

// Reusable style fragments spread into `StyleSheet.create` (design treatments, panel chrome).
// React Native's `ViewStyle`/`TextStyle` type these keys more loosely than Unistyles accepts, so
// a fragment typed with them fails the whole stylesheet. Fragments redeclare them narrowly.
type LooseKeys =
  | "boxSizing"
  | "cursor"
  | "overflow"
  | "position"
  | "transform"
  | "outlineColor"
  | "userSelect"
  | "boxShadow"
  | "filter";

interface NarrowKeys {
  overflow?: "visible" | "hidden";
  position?: "absolute" | "relative";
  cursor?: "auto" | "pointer";
  outlineColor?: string;
  userSelect?: "auto" | "none" | "text";
  boxShadow?: string;
}

export type ViewFragment = Omit<ViewStyle, LooseKeys> & NarrowKeys;
export type TextFragment = Omit<TextStyle, LooseKeys> & NarrowKeys;
