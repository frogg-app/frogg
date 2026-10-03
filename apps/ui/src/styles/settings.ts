import { StyleSheet } from "react-native-unistyles";

/**
 * The narrowest a settings row's label column may get before the row's controls wrap beneath it.
 * Roughly thirty characters of hint text: enough for a line of prose to read as a line, and
 * comfortably inside the detail pane's own minimum width, so the wrap only happens when the
 * controls really are too wide to share the row.
 */
export const SETTINGS_ROW_LABEL_MIN_WIDTH = 220;

export const settingsStyles = StyleSheet.create((theme) => ({
  section: {
    marginBottom: theme.spacing[6],
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: theme.spacing[3],
    marginLeft: theme.spacing[1],
  },
  sectionHeaderTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  sectionHeaderLink: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing[1],
  },
  sectionHeaderLinkText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  card: {
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  // A settings row is a label and its controls side by side, and it wraps rather than squeezing:
  // the controls keep their intrinsic width, so without a wrap a narrow panel takes the width out
  // of the label instead, which is where a sentence ends up one character wide and metres tall.
  // `rowContent` carries the minimum width a sentence needs before that trade stops being worth
  // making; below it the controls drop to their own line, right-aligned under the label.
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    rowGap: theme.spacing[3],
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  rowContent: {
    flex: 1,
    minWidth: SETTINGS_ROW_LABEL_MIN_WIDTH,
    marginRight: theme.spacing[3],
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  rowHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
  rowError: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
}));
