import type { ViewFragment, TextFragment } from "@/styles/style-fragment";
import type { Theme } from "@/styles/theme";

/**
 * The settings nav column (desktop) and root list (mobile), per design direction. Partial styles
 * merged over the shipping ones; `current` is empty so the default design is untouched.
 */
export interface SettingsNavTreatment {
  desktopContainer: ViewFragment;
  list: ViewFragment;
  mobileList: ViewFragment;
  item: ViewFragment;
  itemSelected: ViewFragment;
  label: TextFragment;
  labelSelected: TextFragment;
}

const EMPTY_NAV: SettingsNavTreatment = {
  desktopContainer: {},
  list: {},
  mobileList: {},
  item: {},
  itemSelected: {},
  label: {},
  labelSelected: {},
};

export function settingsNavTreatment(theme: Theme): SettingsNavTreatment {
  const c = theme.colors;
  const dark = theme.colorScheme === "dark";
  const medium = { fontWeight: theme.fontWeight.medium };
  switch (theme.design.variant) {
    case "current":
      return EMPTY_NAV;
    case "inset":
      // Dense, keyboard-first rows on the tinted frame.
      return {
        ...EMPTY_NAV,
        list: { gap: 1 },
        item: { minHeight: 28, paddingVertical: 4, borderRadius: theme.borderRadius.md },
        label: { fontSize: theme.fontSize.base - 1 },
        labelSelected: medium,
      };
    case "mono":
      // No tint: the nav is page-coloured, split from the detail by a hairline.
      return {
        ...EMPTY_NAV,
        desktopContainer: { backgroundColor: c.surface0 },
        item: { minHeight: 32, borderRadius: theme.borderRadius.md },
        itemSelected: { backgroundColor: c.surface2 },
        labelSelected: medium,
      };
    case "paper":
      return {
        ...EMPTY_NAV,
        desktopContainer: { borderRightWidth: 0 },
        item: { borderRadius: theme.borderRadius.lg },
        itemSelected: { backgroundColor: c.surface2 },
        labelSelected: medium,
      };
    case "focus":
      return {
        ...EMPTY_NAV,
        desktopContainer: { backgroundColor: c.surface0, borderRightWidth: 0 },
        list: { paddingHorizontal: theme.spacing[3], paddingTop: theme.spacing[4] },
        itemSelected: { backgroundColor: c.surface1 },
        labelSelected: medium,
      };
    case "soft": {
      const raised = dark ? c.surface3 : c.palette.white;
      return {
        ...EMPTY_NAV,
        desktopContainer: { borderRightWidth: 0 },
        list: { paddingHorizontal: theme.spacing[3], paddingTop: theme.spacing[3] },
        mobileList: {
          backgroundColor: raised,
          borderRadius: theme.borderRadius.xl,
          marginHorizontal: theme.spacing[2],
          marginTop: theme.spacing[2],
          ...theme.shadow.sm,
        },
        item: { minHeight: 40, paddingHorizontal: theme.spacing[3], borderRadius: 999 },
        itemSelected: { backgroundColor: raised, ...theme.shadow.sm },
        labelSelected: { fontWeight: theme.fontWeight.semibold },
      };
    }
  }
}
