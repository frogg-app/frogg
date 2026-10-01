import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { CODE_SURFACE_DATASET, DESIGN_FONT_DATASET } from "@/styles/code-surface";
import type { Theme } from "@/styles/theme";

// On web a global rule paints every text in the user's interface font unless a subtree opts
// out with a dataset. These wrappers opt out only when the active design draws that text in
// its own face, so the `current` design keeps following the user's font exactly as before.
// uniProps mappings receive real theme values (not CSS variables), so they can branch.

const ThemedView = withUnistyles(View);

const proseFontMapping = (theme: Theme) => ({
  dataSet: theme.design.contentFontFamily === null ? undefined : DESIGN_FONT_DATASET,
});

/** Scopes assistant prose to `theme.design.contentFontFamily` on web. */
export function ProseFontScope({ children }: { children: ReactNode }) {
  return <ThemedView uniProps={proseFontMapping}>{children}</ThemedView>;
}

const monoMetaMapping = (theme: Theme) => ({
  dataSet: theme.design.monoMeta ? CODE_SURFACE_DATASET : undefined,
});

/**
 * A View whose text keeps its own mono face when the design sets `monoMeta`. Every Text inside
 * must name its `fontFamily` (see `metaTextStyle`), since the UI-font rule no longer applies.
 */
export const MonoMetaView = withUnistyles(View, monoMetaMapping);

/** A Text drawn in the mono face when the design sets `monoMeta`. */
export const MonoMetaText = withUnistyles(Text, monoMetaMapping);
