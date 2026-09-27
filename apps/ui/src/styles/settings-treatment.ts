import { Platform, type TextStyle, type ViewStyle } from "react-native";
import type { Theme } from "@/styles/theme";

/**
 * Per-direction look of the settings surface. Every field is a partial style merged over the
 * shipping style, and `current` returns empty objects, so the default design is untouched.
 *
 * - Inset: dense grouped rows in hairline cards, small radii, compact nav.
 * - Mono: a hairline-sectioned list with no card fill; section labels in uppercase mono.
 * - Paper: calm warm cards without lines, serif section and page headings.
 * - Focus: a centred narrow column; groups are borderless, rows split by faint rules only.
 * - Soft: rounded raised cards on a tinted page, like iOS grouped settings.
 */
export interface SettingsTreatment {
  page: ViewStyle;
  content: ViewStyle;
  section: ViewStyle;
  sectionHeader: ViewStyle;
  sectionHeaderTitle: TextStyle;
  groupTitle: TextStyle;
  pageTitle: TextStyle;
  card: ViewStyle;
  row: ViewStyle;
  rowBorder: ViewStyle;
  rowTitle: TextStyle;
  rowHint: TextStyle;
}

const EMPTY: SettingsTreatment = {
  page: {},
  content: {},
  section: {},
  sectionHeader: {},
  sectionHeaderTitle: {},
  groupTitle: {},
  pageTitle: {},
  card: {},
  row: {},
  rowBorder: {},
  rowTitle: {},
  rowHint: {},
};

/**
 * Font for Text tagged with `DESIGN_FONT_DATASET`. The tag opts the Text out of the web UI-font
 * rule, so `current` points back at that rule's variable to keep the user's chosen font.
 */
export function designTextFont(theme: Theme, family: string): TextStyle {
  if (theme.design.variant === "current") {
    return Platform.OS === "web" ? { fontFamily: "var(--frogg-ui-font)" } : {};
  }
  return { fontFamily: family };
}

/** Display type for page titles and group headings in the active direction. */
export function designHeading(theme: Theme): TextStyle {
  if (theme.design.variant === "current") return designTextFont(theme, "");
  return {
    ...designTextFont(theme, theme.design.headingFontFamily),
    fontWeight: theme.design.headingWeight,
    letterSpacing: theme.design.headingLetterSpacing,
  };
}

export function settingsTreatment(theme: Theme): SettingsTreatment {
  const c = theme.colors;
  const s = theme.spacing;
  const f = theme.fontSize;
  const heading = designHeading(theme);
  const dark = theme.colorScheme === "dark";
  switch (theme.design.variant) {
    case "current":
      // Tagged Texts must still resolve to the user's UI font.
      return { ...EMPTY, sectionHeaderTitle: heading, groupTitle: heading, pageTitle: heading };
    case "inset":
      return {
        ...EMPTY,
        content: { paddingTop: 20, paddingHorizontal: 20, maxWidth: 760 },
        section: { marginBottom: 20 },
        sectionHeader: { marginBottom: s[2], marginLeft: 0 },
        sectionHeaderTitle: {
          ...designTextFont(theme, theme.design.uiFontFamily),
          fontWeight: theme.fontWeight.medium,
        },
        groupTitle: { ...heading, fontSize: f.base },
        pageTitle: { ...heading, fontSize: f.base },
        card: { backgroundColor: c.surface0, borderRadius: theme.borderRadius.lg },
        row: { paddingVertical: 10, paddingHorizontal: s[3], rowGap: s[2] },
        rowTitle: { fontSize: f.base - 1 },
        rowHint: { marginTop: 2 },
      };
    case "mono":
      return {
        ...EMPTY,
        content: { paddingTop: s[6], paddingHorizontal: s[6], maxWidth: 760 },
        section: { marginBottom: s[8] },
        sectionHeader: { marginBottom: s[2], marginLeft: 0 },
        sectionHeaderTitle: {
          ...designTextFont(theme, theme.design.monoFontFamily),
          fontSize: f.sm - 1,
          textTransform: "uppercase",
          letterSpacing: 0.8,
        },
        groupTitle: { ...heading, fontSize: f.xl },
        pageTitle: { ...heading, fontSize: f.lg },
        card: {
          backgroundColor: "transparent",
          borderRadius: 0,
          borderLeftWidth: 0,
          borderRightWidth: 0,
          borderColor: c.border,
        },
        row: { paddingHorizontal: 0, paddingVertical: s[3] },
        rowTitle: { fontWeight: theme.fontWeight.medium },
      };
    case "paper":
      return {
        ...EMPTY,
        content: { paddingTop: s[8], paddingHorizontal: s[6], maxWidth: 680 },
        section: { marginBottom: s[8] },
        sectionHeader: { marginBottom: s[3], marginLeft: s[1] },
        sectionHeaderTitle: {
          ...heading,
          color: c.foreground,
          fontSize: f.lg,
        },
        groupTitle: { ...heading, fontSize: f["2xl"] },
        pageTitle: { ...heading, fontSize: f.xl },
        card: { borderWidth: 0, borderRadius: theme.borderRadius.xl },
        row: { paddingVertical: s[4], paddingHorizontal: 20 },
        rowBorder: { borderTopColor: c.surface3 },
      };
    case "focus":
      return {
        ...EMPTY,
        content: { paddingTop: s[8], paddingHorizontal: s[6], maxWidth: 560 },
        section: { marginBottom: s[8] },
        sectionHeader: { marginBottom: s[1], marginLeft: 0 },
        sectionHeaderTitle: {
          ...designTextFont(theme, theme.design.uiFontFamily),
          fontWeight: theme.fontWeight.medium,
        },
        groupTitle: { ...heading, fontSize: f.xl },
        pageTitle: { ...heading, fontSize: f.lg },
        card: {
          backgroundColor: "transparent",
          borderWidth: 0,
          borderRadius: 0,
          overflow: "visible",
        },
        row: { paddingHorizontal: 0, paddingVertical: s[4] },
        rowBorder: { borderTopColor: c.surface2 },
      };
    case "soft":
      return {
        ...EMPTY,
        page: { backgroundColor: dark ? c.surface0 : c.surface2 },
        content: { paddingTop: s[6], paddingHorizontal: 20, maxWidth: 680 },
        section: { marginBottom: s[6] },
        sectionHeader: { marginBottom: s[2], marginLeft: s[4] },
        sectionHeaderTitle: {
          ...designTextFont(theme, theme.design.uiFontFamily),
          fontWeight: theme.fontWeight.semibold,
        },
        groupTitle: { ...heading, fontSize: f["2xl"] },
        pageTitle: { ...heading, fontSize: f.lg },
        card: {
          backgroundColor: dark ? c.surface2 : c.palette.white,
          borderWidth: 0,
          borderRadius: theme.borderRadius.xl,
          ...theme.shadow.sm,
        },
        row: { paddingVertical: 14, paddingHorizontal: s[4] },
      };
  }
}
