import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useDesignPreviewStore } from "@/design/design-preview-store";
import { DESIGN_FONT_DATASET } from "@/styles/code-surface";
import { themeOf } from "@/styles/design-theme";
import { entryPageTitle } from "./entry-design";

/**
 * Whether a list screen leads with a large in-page title (Paper's serif, Focus and Mono display
 * type, Soft's bold heading). `current` and the dense Inset keep today's header title only.
 */
export function useShowsEntryPageTitle(): boolean {
  return useDesignPreviewStore((state) => state.variant !== "current" && state.variant !== "inset");
}

/** The large in-page title of a list screen (History), aligned with the list column below. */
export function EntryPageTitle({ title, testID }: { title: string; testID?: string }) {
  return (
    <View style={styles.wrap}>
      <Text
        style={styles.title}
        dataSet={DESIGN_FONT_DATASET}
        accessibilityRole="header"
        numberOfLines={1}
        testID={testID}
      >
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme, rt) => ({
  wrap: {
    width: "100%",
    maxWidth: themeOf(rt.themeName).design.contentMaxWidth ?? undefined,
    alignSelf: "center",
    paddingHorizontal: {
      xs: theme.spacing[3] + theme.spacing[3],
      md: theme.spacing[6] + theme.spacing[3],
    },
    paddingTop: { xs: theme.spacing[4], md: theme.spacing[8] },
  },
  title: {
    color: theme.colors.foreground,
    ...entryPageTitle(themeOf(rt.themeName)),
  },
}));
