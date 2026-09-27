import { themeOf } from "@/styles/design-theme";
import type { TextFragment, ViewFragment } from "@/styles/style-fragment";
import type { Theme } from "@/styles/theme";

/**
 * The sidebar's secondary rows under each design direction: the compact nav and footer entries
 * (Home, Search, Add project, Hosts, Settings), the icon-only brand-row buttons, and the agent
 * rows that hang below a workspace. `current` reproduces the shipping metrics exactly.
 *
 * Only numbers live here, read from the registered theme for `themeName` (pass `rt.themeName`
 * inside an object-literal style value so the style recomputes on a design switch).
 */
export interface ShellRows {
  /** A compact nav or footer entry. */
  navRow: Pick<ViewFragment, "minHeight" | "paddingVertical" | "borderRadius">;
  navText: Pick<TextFragment, "fontSize" | "fontWeight">;
  /** An icon-only brand-row button. */
  iconButtonRadius: number;
  /** An agent row below its workspace. */
  childRow: Pick<ViewFragment, "minHeight" | "borderRadius">;
  childText: Pick<TextFragment, "fontSize" | "fontWeight">;
}

export function resolveShellRows(themeName: string | undefined): ShellRows {
  const { design, borderRadius, spacing, fontSize } = themeOf(themeName);
  const base: ShellRows = {
    navRow: { minHeight: 32, paddingVertical: spacing[1.5], borderRadius: borderRadius.lg },
    navText: { fontSize: fontSize.base, fontWeight: "400" },
    iconButtonRadius: borderRadius.lg,
    childRow: { minHeight: 28, borderRadius: borderRadius.md },
    childText: { fontSize: fontSize.sm, fontWeight: "400" },
  };
  switch (design.variant) {
    case "current":
      return base;
    case "inset":
      return {
        navRow: { minHeight: 28, paddingVertical: 4, borderRadius: borderRadius.md },
        navText: { fontSize: 13, fontWeight: "400" },
        iconButtonRadius: borderRadius.md,
        childRow: { minHeight: 26, borderRadius: borderRadius.md },
        childText: { fontSize: 12.5, fontWeight: "400" },
      };
    case "mono":
      return {
        navRow: { minHeight: 30, paddingVertical: 5, borderRadius: borderRadius.md },
        navText: { fontSize: 13, fontWeight: "400" },
        iconButtonRadius: borderRadius.md,
        childRow: { minHeight: 28, borderRadius: borderRadius.md },
        childText: { fontSize: 12.5, fontWeight: "400" },
      };
    case "paper":
      return {
        navRow: { minHeight: 34, paddingVertical: 7, borderRadius: borderRadius.lg },
        navText: { fontSize: 14, fontWeight: "400" },
        iconButtonRadius: borderRadius.lg,
        childRow: { minHeight: 30, borderRadius: borderRadius.lg },
        childText: { fontSize: 13, fontWeight: "400" },
      };
    case "focus":
      return {
        navRow: { minHeight: 32, paddingVertical: 6, borderRadius: borderRadius.lg },
        navText: { fontSize: 14, fontWeight: "400" },
        iconButtonRadius: borderRadius.lg,
        childRow: { minHeight: 30, borderRadius: borderRadius.lg },
        childText: { fontSize: 13, fontWeight: "400" },
      };
    case "soft":
      return {
        navRow: { minHeight: 40, paddingVertical: 9, borderRadius: borderRadius.lg },
        navText: { fontSize: 15, fontWeight: "500" },
        iconButtonRadius: borderRadius.full,
        childRow: { minHeight: 34, borderRadius: borderRadius.lg },
        childText: { fontSize: 14, fontWeight: "500" },
      };
  }
}

const CURRENT_PILL_SHADOW =
  "0 0 0 1px rgba(255, 255, 255, 0.05) inset, 0 1px 2px rgba(0, 0, 0, 0.3)";

/**
 * The sliding capsule behind the selected Projects | Chats tab, and the tabs' own radius.
 * Colours come from the stylesheet `theme` (CSS variables on web, so appearance overrides
 * apply); the direction and radii from the registered theme for `themeName`.
 */
export function sidebarSectionPill(
  theme: Theme,
  themeName: string | undefined,
): { surface: ViewFragment; tabRadius: number } {
  const { design, borderRadius, colorScheme } = themeOf(themeName);
  const { colors } = theme;
  const lift =
    colorScheme === "dark" ? "0 1px 2px rgba(0, 0, 0, 0.4)" : "0 1px 2px rgba(0, 0, 0, 0.08)";
  switch (design.variant) {
    case "current":
      return {
        surface: {
          borderRadius: borderRadius.md,
          backgroundColor: colors.surface2,
          boxShadow: CURRENT_PILL_SHADOW,
        },
        tabRadius: borderRadius.md,
      };
    case "inset":
      return {
        surface: {
          borderRadius: borderRadius.md,
          backgroundColor: colors.surface0,
          boxShadow: `0 0 0 1px ${colors.border}, ${lift}`,
        },
        tabRadius: borderRadius.md,
      };
    case "mono":
      // A hairline box, no lift.
      return {
        surface: {
          borderRadius: borderRadius.md,
          backgroundColor: colors.surface0,
          boxShadow: `0 0 0 1px ${colors.border}`,
        },
        tabRadius: borderRadius.md,
      };
    case "paper":
      return {
        surface: {
          borderRadius: borderRadius.lg,
          backgroundColor: colors.surface0,
          boxShadow: lift,
        },
        tabRadius: borderRadius.lg,
      };
    case "focus":
      // Tint only.
      return {
        surface: {
          borderRadius: borderRadius.lg,
          backgroundColor: colors.surfaceSidebarSelected,
          boxShadow: "none",
        },
        tabRadius: borderRadius.lg,
      };
    case "soft": {
      const ambient = colorScheme === "dark" ? 0.3 : 0.06;
      return {
        surface: {
          borderRadius: borderRadius.full,
          backgroundColor: colors.surface0,
          boxShadow: `${lift}, 0 2px 8px rgba(0, 0, 0, ${ambient})`,
        },
        tabRadius: borderRadius.full,
      };
    }
  }
}
