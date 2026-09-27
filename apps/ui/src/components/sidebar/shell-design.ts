import type { ViewFragment, TextFragment } from "@/styles/style-fragment";
import { themeOf } from "@/styles/design-theme";
import type { Theme } from "@/styles/theme";

/**
 * How the app shell (sidebar, headers, frame) reads under each design direction.
 *
 * Every value for `current` reproduces the shipping shell exactly, so a stylesheet can spread
 * these unconditionally. The other directions reshape rows, labels and chrome: Inset is dense,
 * Mono is hairline-and-mono, Paper is serif and airy, Focus has near-zero chrome and Soft is
 * large, rounded and raised.
 */
export interface ShellDesign {
  /** Sidebar row box (project, workspace, nav and footer rows). */
  row: Pick<ViewFragment, "minHeight" | "paddingVertical" | "borderRadius">;
  /** Horizontal inset of a row's content inside its highlight. */
  rowPaddingHorizontal: number;
  /** Primary row label. */
  rowText: Pick<TextFragment, "fontSize" | "fontWeight" | "letterSpacing">;
  rowTextLineHeight: number;
  /**
   * A selected row. The fill is always the `surfaceSidebarSelected` token (badge knockouts and
   * trailing-action scrims match it by name); directions differ by edge and elevation.
   */
  selected: ViewFragment;
  /** Rows carry a 1px edge (transparent unless selected) when the direction outlines selection. */
  rowBorderWidth: number;
  /** Project (group header) rows. */
  projectText: Pick<TextFragment, "fontSize" | "fontWeight" | "letterSpacing" | "color"> & {
    fontFamily?: string;
    textTransform?: TextFragment["textTransform"];
  };
  /** Small section labels ("Pinned", status groups, "Projects"). */
  sectionLabel: Pick<TextFragment, "fontSize" | "fontWeight" | "letterSpacing" | "color"> & {
    fontFamily?: string;
    textTransform?: TextFragment["textTransform"];
  };
  /** Metadata under a row (branch, diff counts, ids). */
  metaFontFamily: string | undefined;
  /** Hairlines between the sidebar's brand row, list and footer. */
  sidebarDividers: boolean;
  /** The sidebar's right edge on a flat frame. */
  sidebarEdge: boolean;
  /** Content header bar under the window's top edge. */
  headerBorder: boolean;
  headerTitle: Pick<TextFragment, "fontSize" | "letterSpacing"> & {
    fontWeight: TextFragment["fontWeight"];
    fontFamily?: string;
  };
}

type RealTheme = ReturnType<typeof themeOf>;

function monoSelected(theme: Theme): ViewFragment {
  return { backgroundColor: theme.colors.surfaceSidebarSelected, borderColor: theme.colors.border };
}

function softSelected(theme: Theme, real: RealTheme): ViewFragment {
  // A raised card inside the sidebar card: the tactile "pressed pill" of the iOS references.
  return { backgroundColor: theme.colors.surfaceSidebarSelected, ...real.shadow.sm };
}

/**
 * Labels that may carry a display or mono face are tagged `DESIGN_FONT_DATASET` on web, which
 * opts them out of the global UI-font rule; the ones left on the UI face name it explicitly so a
 * user-chosen interface font still applies.
 *
 * `theme` is the stylesheet's theme: its colours and fonts are CSS variables on web, which track
 * a live theme switch. The direction, its radii and its shadows come from the registered theme
 * for `themeName` (pass `rt.themeName`, referenced inside the style value so the style
 * recomputes on a switch), because string leaves of `theme` cannot be compared on web.
 */
export function resolveShellDesign(theme: Theme, themeName: string | undefined): ShellDesign {
  const shell = resolveShellDesignBase(theme, themeOf(themeName));
  const ui = theme.fontFamily.ui;
  return {
    ...shell,
    projectText: { ...shell.projectText, fontFamily: shell.projectText.fontFamily ?? ui },
    sectionLabel: { ...shell.sectionLabel, fontFamily: shell.sectionLabel.fontFamily ?? ui },
    headerTitle: { ...shell.headerTitle, fontFamily: shell.headerTitle.fontFamily ?? ui },
  };
}

function resolveShellDesignBase(theme: Theme, real: RealTheme): ShellDesign {
  const { colors, fontSize, spacing } = theme;
  const { design, borderRadius } = real;
  const base: ShellDesign = {
    row: { minHeight: 36, paddingVertical: spacing[2], borderRadius: theme.borderRadius.lg },
    rowPaddingHorizontal: spacing[2],
    rowText: { fontSize: fontSize.base, fontWeight: "400" },
    rowTextLineHeight: 20,
    selected: { backgroundColor: colors.surfaceSidebarSelected },
    rowBorderWidth: 0,
    projectText: { fontSize: fontSize.base, fontWeight: "400", color: colors.foregroundMuted },
    sectionLabel: { fontSize: fontSize.sm, fontWeight: "400", color: colors.foregroundMuted },
    metaFontFamily: undefined,
    sidebarDividers: true,
    sidebarEdge: true,
    headerBorder: true,
    headerTitle: { fontSize: fontSize.base, fontWeight: undefined },
  };
  switch (design.variant) {
    case "current":
      return base;
    case "inset":
      return {
        ...base,
        row: { minHeight: 28, paddingVertical: 4, borderRadius: borderRadius.md },
        rowText: { fontSize: 13, fontWeight: "400" },
        rowTextLineHeight: 18,
        projectText: { fontSize: 13, fontWeight: "500", color: colors.foregroundMuted },
        sectionLabel: { fontSize: 12, fontWeight: "500", color: colors.foregroundMuted },
        sidebarDividers: false,
        headerTitle: { fontSize: 13, fontWeight: "500" },
      };
    case "mono":
      return {
        ...base,
        row: { minHeight: 32, paddingVertical: 5, borderRadius: borderRadius.md },
        rowText: { fontSize: 13, fontWeight: "400" },
        rowTextLineHeight: 20,
        selected: monoSelected(theme),
        rowBorderWidth: 1,
        projectText: {
          fontSize: 11,
          fontWeight: "500",
          letterSpacing: 0.6,
          color: colors.foregroundMuted,
          fontFamily: design.monoFontFamily,
          textTransform: "uppercase",
        },
        sectionLabel: {
          fontSize: 11,
          fontWeight: "500",
          letterSpacing: 0.6,
          color: colors.foregroundMuted,
          fontFamily: design.monoFontFamily,
          textTransform: "uppercase",
        },
        metaFontFamily: design.monoFontFamily,
        headerTitle: { fontSize: 14, fontWeight: "600", letterSpacing: -0.2 },
      };
    case "paper":
      return {
        ...base,
        row: { minHeight: 36, paddingVertical: spacing[2], borderRadius: borderRadius.lg },
        rowPaddingHorizontal: spacing[3],
        rowText: { fontSize: 14, fontWeight: "400" },
        projectText: {
          fontSize: 16,
          fontWeight: "500",
          letterSpacing: -0.2,
          color: colors.foreground,
          fontFamily: design.headingFontFamily,
        },
        sectionLabel: {
          fontSize: 12,
          fontWeight: "500",
          color: colors.foregroundExtraMuted,
        },
        sidebarDividers: false,
        sidebarEdge: false,
        headerBorder: false,
        headerTitle: {
          fontSize: 16,
          fontWeight: "500",
          letterSpacing: -0.2,
          fontFamily: design.headingFontFamily,
        },
      };
    case "focus":
      return {
        ...base,
        row: { minHeight: 34, paddingVertical: 7, borderRadius: borderRadius.lg },
        rowText: { fontSize: 14, fontWeight: "400" },
        projectText: { fontSize: 13, fontWeight: "500", color: colors.foregroundExtraMuted },
        sectionLabel: { fontSize: 12, fontWeight: "500", color: colors.foregroundExtraMuted },
        sidebarDividers: false,
        sidebarEdge: false,
        headerBorder: false,
        headerTitle: { fontSize: 14, fontWeight: "500", letterSpacing: -0.2 },
      };
    case "soft":
      return {
        ...base,
        row: { minHeight: 42, paddingVertical: 10, borderRadius: borderRadius.lg },
        rowPaddingHorizontal: spacing[3],
        rowText: { fontSize: 15, fontWeight: "500" },
        rowTextLineHeight: 22,
        selected: softSelected(theme, real),
        projectText: { fontSize: 15, fontWeight: "700", color: colors.foreground },
        sectionLabel: { fontSize: 13, fontWeight: "700", color: colors.foregroundMuted },
        sidebarDividers: false,
        sidebarEdge: false,
        headerBorder: false,
        headerTitle: { fontSize: 16, fontWeight: "700", letterSpacing: -0.3 },
      };
  }
}

/**
 * A sidebar row's box: height, padding, radius, and the transparent edge a direction that
 * outlines selection needs on every row. Spread after a row's own geometry.
 */
export function sidebarRowBox(theme: Theme, themeName: string | undefined): ViewFragment {
  const shell = resolveShellDesign(theme, themeName);
  return {
    ...shell.row,
    paddingLeft: shell.rowPaddingHorizontal,
    paddingRight: shell.rowPaddingHorizontal,
    ...(shell.rowBorderWidth > 0
      ? { borderWidth: shell.rowBorderWidth, borderColor: "transparent" }
      : null),
  };
}

/** A row's primary label. */
export function sidebarRowText(theme: Theme, themeName: string | undefined): TextFragment {
  const shell = resolveShellDesign(theme, themeName);
  return { ...shell.rowText, lineHeight: shell.rowTextLineHeight };
}

/** Hairlines between the sidebar's brand row, list and footer, or transparent without them. */
export function sidebarDividerColor(theme: Theme, themeName: string | undefined): string {
  return resolveShellDesign(theme, themeName).sidebarDividers ? theme.colors.border : "transparent";
}

/**
 * The desktop sidebar's own surface for the frame: an edge on a flat frame, nothing on an inset
 * frame (it sits on the frame itself), and a raised rounded card on a floating frame.
 */
export function desktopSidebarSurface(theme: Theme, themeName: string | undefined): ViewFragment {
  const real = themeOf(themeName);
  const surface = { backgroundColor: theme.colors.surfaceSidebar };
  if (real.design.frame === "floating") {
    return {
      ...surface,
      overflow: "hidden",
      borderRadius: real.borderRadius["2xl"],
      ...real.shadow.sm,
    };
  }
  const edge = real.design.frame === "flat" && resolveShellDesign(theme, themeName).sidebarEdge;
  return {
    ...surface,
    borderRightWidth: edge ? 1 : 0,
    borderRightColor: theme.colors.border,
  };
}
