import type { ViewFragment, TextFragment } from "@/styles/style-fragment";
import { themeOf } from "@/styles/design-theme";
import type { Theme } from "@/styles/theme";
import { hexColorWithAlpha, parseHexColor } from "@/utils/color";

// Design-direction chrome for the workspace tool panels (explorer, changes, terminal, CI, PR).
// Every helper returns the shipping values for the `current` design, so a panel that spreads
// them renders exactly as before unless a UI-refresh direction is selected.
//
// Live switches on web: Unistyles never deletes a CSS property when a style recomputes; it only
// overwrites the ones the new value names. So every branch of a helper emits the same keys, with
// neutral values where a direction doesn't use one, unless the caller's base style already sets
// that key (it then comes back from the base).

type Variant = Theme["design"]["variant"];

function variantOf(theme: Theme): Variant {
  return theme.design.variant;
}

/**
 * The concrete theme for a Unistyles theme name. On web, Unistyles hands stylesheets a theme whose
 * string leaves are CSS variables, so `theme.design.variant` and colour maths never see real
 * values there. Call this with `rt.themeName` written inside each style's value: that registers a
 * theme-name dependency (the style recomputes on a design switch) and yields real tokens.
 */
export function panelTheme(theme: Theme, themeName: string | undefined): Theme {
  const registered: Theme = themeOf(themeName);
  // The shipping design keeps the CSS-variable colours so it renders exactly as before (they track
  // runtime appearance updates); only its design tokens, frozen at first compute on web, come from
  // the registered theme. Colour maths must therefore go through `panelAlpha`, never assume hex.
  return registered.design.variant === "current"
    ? { ...theme, design: registered.design }
    : registered;
}

/**
 * `color` at `alpha` opacity. Hex colours mix directly; a web CSS variable (the shipping design's
 * colours) mixes in CSS, so no caller can crash on a `var(--…)` value.
 */
export function panelAlpha(color: string, alpha: number): string {
  if (parseHexColor(color)) return hexColorWithAlpha(color, alpha);
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}

/** Soft accent wash used for a selected row or pill in the Inset and Soft directions. */
export function panelAccentWash(theme: Theme, alpha = 0.12): string {
  return panelAlpha(theme.colors.accent, alpha);
}

/** Bottom edge of a panel toolbar or tab track: hairline, or nothing in borderless directions. */
export function panelHeaderEdge(theme: Theme): ViewFragment {
  if (!theme.design.borderless) {
    return { borderBottomWidth: 1, borderBottomColor: theme.colors.border };
  }
  // Paper keeps a whisper of an edge in tint; Focus and Soft rely on spacing alone.
  if (variantOf(theme) === "paper") {
    return { borderBottomWidth: 1, borderBottomColor: theme.colors.borderAccent };
  }
  return { borderBottomWidth: 0, borderBottomColor: "transparent" };
}

/** Metadata text (paths, counts, ids, timestamps): mono in the Mono direction. */
export function panelMetaText(theme: Theme): TextFragment {
  // fontFamily needs no neutral: outside Mono the text drops the dataSet and the web UI-font rule
  // wins again.
  return theme.design.monoMeta
    ? { fontFamily: theme.fontFamily.mono, letterSpacing: -0.2 }
    : { letterSpacing: 0 };
}

/**
 * Section title inside a panel (PR sections, CI groups). Paper sets it in its serif display face,
 * Soft makes it bolder; pair with `usePanelHeadingDataSet` on web.
 */
export function panelSectionTitle(theme: Theme): TextFragment {
  const design = theme.design;
  const face =
    design.headingFontFamily !== design.uiFontFamily
      ? { fontFamily: design.headingFontFamily, letterSpacing: 0 }
      : { letterSpacing: 0 };
  switch (design.variant) {
    case "paper":
      return {
        ...face,
        fontSize: theme.fontSize.base,
        fontWeight: design.headingWeight,
        color: theme.colors.foreground,
        letterSpacing: design.headingLetterSpacing,
      };
    case "soft":
      return { ...face, fontWeight: theme.fontWeight.semibold, color: theme.colors.foreground };
    case "mono":
      return { ...face, color: theme.colors.foreground, letterSpacing: -0.1 };
    default:
      return face;
  }
}

interface TabChrome {
  tab: ViewFragment;
  hovered: ViewFragment;
  active: ViewFragment;
  activeUnfocused: ViewFragment;
  label: TextFragment;
  labelActive: TextFragment;
}

/**
 * Tab chip treatment per direction. `base` is the shipping chip (radius, hover, active fill)
 * so the current design passes through untouched.
 */
export function panelTabChrome(
  theme: Theme,
  base: { radius: number; hovered: string; active: string; activeUnfocused: string },
): TabChrome {
  const chrome = tabChromeFor(theme, base);
  const noRule = { borderBottomColor: "transparent" };
  return {
    tab: {
      borderBottomWidth: 0,
      borderBottomColor: "transparent",
      borderTopWidth: 0,
      borderTopColor: "transparent",
      ...chrome.tab,
    },
    hovered: { ...noRule, ...chrome.hovered },
    active: { ...noRule, ...chrome.active },
    activeUnfocused: { ...noRule, ...chrome.activeUnfocused },
    label: { letterSpacing: 0, ...chrome.label },
    labelActive: chrome.labelActive,
  };
}

function tabChromeFor(
  theme: Theme,
  base: { radius: number; hovered: string; active: string; activeUnfocused: string },
): TabChrome {
  const shipping: TabChrome = {
    tab: { borderRadius: base.radius },
    hovered: { backgroundColor: base.hovered },
    active: { backgroundColor: base.active },
    activeUnfocused: { backgroundColor: base.activeUnfocused },
    label: {},
    labelActive: { color: theme.colors.foreground },
  };
  switch (variantOf(theme)) {
    case "mono":
      // Vercel-style underline tabs: no fill, a solid rule under the active tab.
      return {
        tab: {
          borderRadius: 0,
          borderBottomWidth: 2,
          borderBottomColor: "transparent",
          borderTopWidth: 2,
          borderTopColor: "transparent",
        },
        hovered: { backgroundColor: "transparent" },
        active: { backgroundColor: "transparent", borderBottomColor: theme.colors.foreground },
        activeUnfocused: {
          backgroundColor: "transparent",
          borderBottomColor: theme.colors.foregroundExtraMuted,
        },
        label: { letterSpacing: -0.1 },
        labelActive: { color: theme.colors.foreground, fontWeight: theme.fontWeight.medium },
      };
    case "inset":
      return {
        ...shipping,
        tab: { borderRadius: theme.borderRadius.base },
        active: { backgroundColor: theme.colors.surface2 },
        activeUnfocused: { backgroundColor: theme.colors.surface1 },
      };
    case "paper":
      return {
        ...shipping,
        tab: { borderRadius: theme.borderRadius.lg },
        active: { backgroundColor: theme.colors.surface2 },
        labelActive: { color: theme.colors.foreground, fontWeight: theme.fontWeight.medium },
      };
    case "focus":
      // Near-zero chrome: the active tab is carried by text weight and colour alone.
      return {
        ...shipping,
        tab: { borderRadius: theme.borderRadius.base },
        hovered: { backgroundColor: theme.colors.surface1 },
        active: { backgroundColor: "transparent" },
        activeUnfocused: { backgroundColor: "transparent" },
        labelActive: { color: theme.colors.foreground, fontWeight: theme.fontWeight.medium },
      };
    case "soft":
      return {
        tab: { borderRadius: theme.borderRadius.full },
        hovered: { backgroundColor: theme.colors.surface2 },
        active: { backgroundColor: panelAccentWash(theme, 0.14) },
        activeUnfocused: { backgroundColor: theme.colors.surface2 },
        label: {},
        labelActive: { color: theme.colors.accent, fontWeight: theme.fontWeight.semibold },
      };
    default:
      return shipping;
  }
}

interface TreeRowChrome {
  row: ViewFragment;
  active: ViewFragment;
}

/** Row rhythm and selection for the Files and Changes trees. */
export function panelTreeRowChrome(
  theme: Theme,
  base: { paddingVertical: number; active: string },
): TreeRowChrome {
  const chrome = treeRowChromeFor(theme, base);
  return {
    row: {
      marginHorizontal: 0,
      borderRadius: 0,
      borderLeftWidth: 0,
      borderLeftColor: "transparent",
      ...chrome.row,
    },
    active: { borderLeftColor: "transparent", ...chrome.active },
  };
}

function treeRowChromeFor(
  theme: Theme,
  base: { paddingVertical: number; active: string },
): TreeRowChrome {
  const inset = (margin: number, radius: number, paddingVertical: number): TreeRowChrome => ({
    row: { marginHorizontal: margin, borderRadius: radius, paddingVertical },
    active: { backgroundColor: base.active },
  });
  switch (variantOf(theme)) {
    case "inset":
      return {
        row: { marginHorizontal: 4, borderRadius: theme.borderRadius.base, paddingVertical: 4 },
        active: { backgroundColor: panelAccentWash(theme, 0.1) },
      };
    case "mono":
      return {
        row: {
          paddingVertical: base.paddingVertical - 1,
          borderLeftWidth: 2,
          borderLeftColor: "transparent",
        },
        active: {
          backgroundColor: theme.colors.surface2,
          borderLeftColor: theme.colors.foreground,
        },
      };
    case "paper":
      return inset(6, theme.borderRadius.md, base.paddingVertical + 1);
    case "focus":
      return {
        row: { marginHorizontal: 6, borderRadius: theme.borderRadius.base },
        active: { backgroundColor: theme.colors.surface1 },
      };
    case "soft":
      return {
        row: { marginHorizontal: 8, borderRadius: theme.borderRadius.lg, paddingVertical: 8 },
        active: { backgroundColor: panelAccentWash(theme, 0.12) },
      };
    default:
      return { row: {}, active: { backgroundColor: base.active } };
  }
}

/** Terminal output well: flush by default, an inset rounded card in Paper and Soft. */
export function panelTerminalFrame(theme: Theme): ViewFragment {
  const neutral: ViewFragment = {
    margin: 0,
    paddingTop: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    paddingRight: 0,
    borderRadius: 0,
    borderWidth: 0,
    borderColor: "transparent",
    overflow: "visible",
    ...NO_SHADOW,
  };
  return { ...neutral, ...terminalFrameFor(theme) };
}

function terminalInset(horizontal: number, vertical: number): ViewFragment {
  return {
    paddingTop: vertical,
    paddingBottom: vertical,
    paddingLeft: horizontal,
    paddingRight: horizontal,
  };
}

// The refresh directions give the output a gutter so glyphs never sit on the pane edge (or under a
// rounded corner); the well takes the emulator's own background so the gutter reads as terminal.
function terminalFrameFor(theme: Theme): ViewFragment {
  const well = { backgroundColor: theme.colors.terminal.background };
  switch (variantOf(theme)) {
    case "inset":
    case "mono":
      return { ...well, ...terminalInset(8, 6) };
    case "focus":
      return { ...well, ...terminalInset(14, 10) };
    case "paper":
      return {
        ...well,
        ...terminalInset(10, 8),
        margin: 8,
        borderRadius: theme.borderRadius.lg,
        borderWidth: 1,
        borderColor: theme.colors.borderAccent,
        overflow: "hidden",
      };
    case "soft":
      return {
        ...well,
        ...terminalInset(12, 10),
        margin: 8,
        borderRadius: theme.borderRadius.xl,
        overflow: "hidden",
        ...theme.shadow.sm,
      };
    default:
      return {};
  }
}

/**
 * A repeated list item in a panel (CI run, check, stream): a hairline-divided row in the lined
 * directions, a soft card in Paper and Soft, and plain spacing in Focus.
 */
export function panelListItemChrome(theme: Theme): ViewFragment {
  const neutral: ViewFragment = {
    marginHorizontal: 0,
    marginTop: 0,
    borderRadius: 0,
    backgroundColor: "transparent",
  };
  return { ...neutral, ...listItemChromeFor(theme) };
}

function listItemChromeFor(theme: Theme): ViewFragment {
  switch (variantOf(theme)) {
    case "paper":
      return {
        borderBottomWidth: 0,
        marginHorizontal: theme.spacing[2],
        marginTop: theme.spacing[2],
        borderRadius: theme.borderRadius.lg,
        backgroundColor: theme.colors.surface1,
      };
    case "soft":
      return {
        borderBottomWidth: 0,
        marginHorizontal: theme.spacing[2],
        marginTop: theme.spacing[2],
        borderRadius: theme.borderRadius.xl,
        backgroundColor: theme.colors.surface1,
      };
    case "focus":
      return { borderBottomWidth: 0, marginTop: theme.spacing[1] };
    default:
      return {};
  }
}

const NO_SHADOW: ViewFragment = {
  shadowColor: "transparent",
  shadowOffset: { width: 0, height: 0 },
  shadowRadius: 0,
  elevation: 0,
};

/**
 * A bordered summary card inside a panel (release stream cards, setup callouts). Radius and border
 * colour always come from the caller's base style, so only the shadow needs a neutral.
 */
export function panelCardChrome(theme: Theme): ViewFragment {
  return { ...NO_SHADOW, ...cardChromeFor(theme) };
}

function cardChromeFor(theme: Theme): ViewFragment {
  switch (variantOf(theme)) {
    case "mono":
      return { borderRadius: theme.borderRadius.md, borderColor: theme.colors.border };
    case "inset":
      return { borderRadius: theme.borderRadius.md };
    case "paper":
      return { borderRadius: theme.borderRadius.xl, borderColor: "transparent" };
    case "focus":
      return { borderRadius: theme.borderRadius.lg, borderColor: "transparent" };
    case "soft":
      return {
        borderRadius: theme.borderRadius["2xl"],
        borderColor: "transparent",
        ...theme.shadow.sm,
      };
    default:
      return {};
  }
}

type StatusDotTone = "statusDotSuccess" | "statusDotWarning" | "statusDotDanger";

/**
 * A status dot of `size` px in a status tone. Mono makes it prominent: larger, with a soft halo
 * ring in the same hue (Vercel deployment dots). The colour is read from `theme` (a `panelTheme`)
 * so the halo's alpha mixing sees a real hex value on web, not a CSS variable.
 */
export function panelStatusDot(theme: Theme, tone: StatusDotTone, size: number): ViewFragment {
  const color = theme.colors[tone];
  if (variantOf(theme) !== "mono") {
    return {
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: color,
      boxShadow: "0 0 0 0px transparent",
    };
  }
  const prominent = size + 2;
  return {
    width: prominent,
    height: prominent,
    borderRadius: prominent / 2,
    backgroundColor: color,
    boxShadow: `0 0 0 3px ${panelAlpha(color, 0.22)}`,
  };
}

/** A key or small control on a panel surface (terminal key row, retry buttons). */
export function panelKeyChrome(theme: Theme, baseRadius: number): ViewFragment {
  if (variantOf(theme) === "current") return {};
  return theme.design.borderless
    ? { borderRadius: theme.design.controlRadius, borderColor: "transparent" }
    : { borderRadius: Math.min(theme.design.controlRadius, baseRadius) };
}
