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
