import type { TextFragment, ViewFragment } from "@/styles/style-fragment";
import { designHeading } from "@/styles/settings-treatment";
import type { Theme } from "@/styles/theme";

/**
 * Per-direction look of the entry surfaces: home, welcome, pairing, new chat and new workspace.
 * Every helper takes the REAL theme (`themeOf(rt.themeName)` inside a stylesheet) and returns a
 * partial style merged over the shipping one; `current` returns empty fragments, so the default
 * design is untouched. Page titles pair with `DESIGN_FONT_DATASET` on web.
 */

interface TitleSpec {
  size: number;
  lineHeight: number;
}

const PAGE_TITLE: Record<Exclude<Theme["design"]["variant"], "current">, TitleSpec> = {
  inset: { size: 17, lineHeight: 24 },
  mono: { size: 26, lineHeight: 32 },
  paper: { size: 30, lineHeight: 38 },
  focus: { size: 30, lineHeight: 38 },
  soft: { size: 28, lineHeight: 36 },
};

/** A page title (greeting, "New workspace", onboarding headline) in the direction's display face. */
export function entryPageTitle(theme: Theme): TextFragment {
  const variant = theme.design.variant;
  if (variant === "current") return designHeading(theme);
  const spec = PAGE_TITLE[variant];
  return {
    ...designHeading(theme),
    fontSize: spec.size,
    lineHeight: spec.lineHeight,
    letterSpacing: variant === "mono" ? -0.8 : theme.design.headingLetterSpacing,
  };
}

/** Focus and Paper centre the title over the composer; the rest keep it on the leading edge. */
export function entryTitleCentred(theme: Theme): boolean {
  return theme.design.variant === "focus" || theme.design.variant === "paper";
}

export function entryTitleBlock(theme: Theme): ViewFragment {
  if (!entryTitleCentred(theme)) return {};
  return { alignItems: "center", paddingLeft: 0, paddingRight: 0 };
}

const COLUMN_WIDTH = { inset: 520, mono: 600, paper: 560, focus: 560, soft: 560 } as const;

/** Column width for the form-like entry screens (pairing, host add, welcome actions). */
export function entryColumn(theme: Theme): ViewFragment {
  const variant = theme.design.variant;
  if (variant === "current") return {};
  return { width: "100%", maxWidth: COLUMN_WIDTH[variant], alignSelf: "center" };
}

/**
 * A full-width entry action button (welcome "Scan QR", "Direct connection"…).
 * Inset: compact, small radius. Mono: square, stark primary. Paper: calm tinted, no line.
 * Focus: quiet outlined, primary in the accent. Soft: tall pills with a soft shadow.
 */
export function entryActionButton(theme: Theme): ViewFragment {
  const c = theme.colors;
  switch (theme.design.variant) {
    case "inset":
      return { paddingVertical: theme.spacing[2], borderRadius: theme.borderRadius.md };
    case "mono":
      return { paddingVertical: theme.spacing[3], borderRadius: theme.borderRadius.md };
    case "paper":
      return {
        paddingVertical: theme.spacing[4],
        borderRadius: theme.borderRadius.xl,
        backgroundColor: c.surface1,
        borderColor: c.surface1,
      };
    case "focus":
      return {
        paddingVertical: theme.spacing[3],
        borderRadius: theme.borderRadius.lg,
        backgroundColor: c.surface0,
      };
    case "soft":
      return {
        paddingVertical: theme.spacing[4],
        borderRadius: theme.borderRadius.full,
        backgroundColor: c.surface1,
        borderColor: c.surface1,
        ...theme.shadow.sm,
      };
    default:
      return {};
  }
}

/** The primary entry action: Mono goes solid black/white, the rest keep their accent fill. */
export function entryActionPrimary(theme: Theme): ViewFragment {
  if (theme.design.variant !== "mono") return {};
  return { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary };
}

export function entryActionPrimaryText(theme: Theme): TextFragment {
  if (theme.design.variant !== "mono") return {};
  return { color: theme.colors.primaryForeground };
}

/** A choice card on the entry screens (welcome local/remote cards). */
export function entryCard(theme: Theme): ViewFragment {
  const c = theme.colors;
  switch (theme.design.variant) {
    case "inset":
      return { padding: theme.spacing[3], borderRadius: theme.borderRadius.lg };
    case "mono":
      return { borderRadius: theme.borderRadius.md, backgroundColor: c.surface0 };
    case "paper":
      return {
        padding: theme.spacing[6] - theme.spacing[1],
        borderRadius: theme.borderRadius.xl,
        backgroundColor: c.surface1,
        borderColor: c.surface1,
      };
    case "focus":
      return { borderRadius: theme.borderRadius.xl, backgroundColor: c.surface0 };
    case "soft":
      return {
        padding: theme.spacing[6] - theme.spacing[1],
        borderRadius: theme.borderRadius["2xl"],
        backgroundColor: c.surface1,
        borderColor: c.surface1,
        ...theme.shadow.sm,
      };
    default:
      return {};
  }
}

/** A compact solid call-to-action (camera permission, retry): accent fill, Mono's black/white. */
export function entrySolidButton(theme: Theme): ViewFragment {
  if (theme.design.variant === "current") return {};
  const mono = theme.design.variant === "mono";
  return {
    backgroundColor: mono ? theme.colors.primary : theme.colors.accent,
    borderRadius: Math.min(theme.design.controlRadius, theme.borderRadius.full),
  };
}

export function entrySolidButtonText(theme: Theme): TextFragment {
  if (theme.design.variant === "current") return {};
  const mono = theme.design.variant === "mono";
  return { color: mono ? theme.colors.primaryForeground : theme.colors.accentForeground };
}

/** A card or section heading on the entry screens, a step below the page title. */
export function entrySectionTitle(theme: Theme): TextFragment {
  if (theme.design.variant === "current") return designHeading(theme);
  const size = theme.design.variant === "inset" ? theme.fontSize.base : theme.fontSize.lg;
  return { ...designHeading(theme), fontSize: size };
}

/** The project/host/branch chips above the new-workspace composer: Soft tints them as pills. */
export function entryMetaChip(theme: Theme): ViewFragment {
  if (theme.design.variant !== "soft") return {};
  return {
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[3],
  };
}
