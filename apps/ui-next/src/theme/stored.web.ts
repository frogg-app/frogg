import type { ThemeChoice } from "./themes";

/** Web and desktop: the theme choice lives in localStorage, readable before the first render. */
const KEY = "frogg.next.theme";

export function readStoredTheme(): Partial<ThemeChoice> | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<ThemeChoice>) : null;
  } catch {
    return null;
  }
}

export function writeStoredTheme(choice: ThemeChoice): void {
  globalThis.localStorage?.setItem(KEY, JSON.stringify(choice));
}

/** Stylesheets read the tokens when their modules load, so a new theme needs a fresh load. */
export function reloadForTheme(): void {
  globalThis.location?.reload();
}

/** Colours the desktop shell paints before the bundle loads: splash, window and title bar. */
export interface ShellColors {
  bg: string;
  faint: string;
  accent: string;
  symbols: string;
}

const SHELL_KEY = "frogg.next.chrome";

/**
 * Hands the active theme's shell colours to what paints before the UI does: the desktop splash
 * reads them from localStorage (an inline script in index.html), and the Electron window
 * background and title bar overlay come from the desktop bridge. Runs once per launch.
 */
export function syncShellTheme(colors: ShellColors): void {
  try {
    globalThis.localStorage?.setItem(SHELL_KEY, JSON.stringify(colors));
  } catch {
    // Storage full or blocked: the splash keeps its default colours.
  }
  const bridge = (
    globalThis as { froggNextDesktop?: { setWindowTheme?: (c: ShellColors) => Promise<void> } }
  ).froggNextDesktop;
  void bridge?.setWindowTheme?.(colors)?.catch(() => {});
}
