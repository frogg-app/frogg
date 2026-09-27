import type { ReactNode } from "react";
import { View } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { DESIGN_FONT_DATASET } from "@/styles/code-surface";
import type { Theme } from "@/styles/theme";

const ThemedView = withUnistyles(View);

// Only designs with their own prose face opt out of the web UI-font rule; otherwise assistant
// text keeps following the user's interface font exactly as before.
const proseFontMapping = (theme: Theme) => ({
  dataSet: theme.design.contentFontFamily === null ? undefined : DESIGN_FONT_DATASET,
});

/** Scopes assistant prose to `theme.design.contentFontFamily` on web. */
export function ProseFontScope({ children }: { children: ReactNode }) {
  return <ThemedView uniProps={proseFontMapping}>{children}</ThemedView>;
}
