import type { Theme } from "@/styles/theme";
import { hexColorWithAlpha } from "@/utils/color";
import type { DiffCell, DiffPalette } from "./types";

// `theme` here comes from a `withUnistyles` mapping, which receives the concrete theme (hex colours
// and the real `design.variant`) on web too, so branching and alpha mixing are safe.

interface DiffChrome {
  headerSurface: string;
  headerActiveSurface: string;
  headerBorder: string;
  emptyBackground: string;
  additionAlpha: number;
  deletionAlpha: number;
}

/**
 * Header bands, empty split cells and change tints per design direction. The refresh surfaces sit
 * closer together than the shipping ones, so bands use `surface2`, and dark schemes get stronger
 * add/delete tints so a change stays legible on near-black grounds.
 */
function diffChrome(theme: Theme): DiffChrome {
  const colors = theme.colors;
  const variant = theme.design.variant;
  if (variant === "current") {
    return {
      headerSurface: colors.surface0,
      headerActiveSurface: colors.surface1,
      headerBorder: colors.borderAccent,
      emptyBackground: colors.surface0,
      additionAlpha: 0.15,
      deletionAlpha: 0.1,
    };
  }
  const dark = theme.colorScheme === "dark";
  const tints = dark
    ? { additionAlpha: 0.2, deletionAlpha: 0.17 }
    : { additionAlpha: 0.14, deletionAlpha: 0.11 };
  // Focus keeps its near-zero chrome: flush header bands and no separating rule.
  if (variant === "focus") {
    return {
      headerSurface: colors.surface0,
      headerActiveSurface: colors.surface1,
      headerBorder: colors.border,
      emptyBackground: colors.surface1,
      ...tints,
    };
  }
  return {
    headerSurface: colors.surface2,
    headerActiveSurface: colors.border,
    headerBorder: variant === "mono" ? colors.border : colors.borderAccent,
    emptyBackground: colors.surface1,
    ...tints,
  };
}

export function createDiffPalette(theme: Theme): DiffPalette {
  const chrome = diffChrome(theme);
  return {
    surface: theme.colors.surface0,
    headerSurface: chrome.headerSurface,
    border: theme.colors.border,
    foreground: theme.colors.foreground,
    foregroundMuted: theme.colors.foregroundMuted,
    addition: theme.colors.statusSuccess,
    deletion: theme.colors.statusDanger,
    additionBackground: hexColorWithAlpha(theme.colors.statusSuccess, chrome.additionAlpha),
    deletionBackground: hexColorWithAlpha(theme.colors.statusDanger, chrome.deletionAlpha),
    emptyBackground: chrome.emptyBackground,
    selection: theme.colors.terminal.blue,
    headerActiveSurface: chrome.headerActiveSurface,
    headerBorder: chrome.headerBorder,
    statusSuccess: theme.colors.statusSuccess,
    statusDanger: theme.colors.statusDanger,
    statusWarning: theme.colors.statusWarning,
    syntax: theme.colors.syntax,
  };
}

export function retainDiffPalette(previous: DiffPalette, next: DiffPalette): DiffPalette {
  if (
    previous.surface !== next.surface ||
    previous.headerSurface !== next.headerSurface ||
    previous.border !== next.border ||
    previous.foreground !== next.foreground ||
    previous.foregroundMuted !== next.foregroundMuted ||
    previous.addition !== next.addition ||
    previous.deletion !== next.deletion ||
    previous.additionBackground !== next.additionBackground ||
    previous.deletionBackground !== next.deletionBackground ||
    previous.emptyBackground !== next.emptyBackground ||
    previous.selection !== next.selection ||
    previous.headerActiveSurface !== next.headerActiveSurface ||
    previous.headerBorder !== next.headerBorder ||
    previous.statusSuccess !== next.statusSuccess ||
    previous.statusDanger !== next.statusDanger ||
    previous.statusWarning !== next.statusWarning ||
    !sameColorMap(previous.syntax, next.syntax)
  ) {
    return next;
  }
  return previous;
}

function sameColorMap(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key]);
}

export function codeTextColor(cell: DiffCell, palette: DiffPalette): string {
  return cell.type === "header" ? palette.foregroundMuted : palette.foreground;
}

export function codeLineNumberTone(cell: DiffCell): "addition" | "deletion" | "foregroundMuted" {
  "worklet";
  if (cell.type === "add") return "addition";
  if (cell.type === "remove") return "deletion";
  return "foregroundMuted";
}
