import { DevSettings } from "react-native";
import { File, Paths } from "expo-file-system";
import type { ThemeChoice } from "./themes";

/**
 * Native: the theme choice is a small file in the app's document directory, read synchronously
 * so the tokens are themed before any stylesheet is created.
 */
function file(): File {
  return new File(Paths.document, "frogg-theme.json");
}

export function readStoredTheme(): Partial<ThemeChoice> | null {
  try {
    const f = file();
    return f.exists ? (JSON.parse(f.textSync()) as Partial<ThemeChoice>) : null;
  } catch {
    return null;
  }
}

export function writeStoredTheme(choice: ThemeChoice): void {
  try {
    const f = file();
    if (!f.exists) f.create();
    f.write(JSON.stringify(choice));
  } catch {
    // Unwritable document directory: the choice lasts until the app restarts.
  }
}

/** Stylesheets read the tokens when their modules load, so a new theme needs a fresh load. */
export function reloadForTheme(): void {
  DevSettings.reload();
}

/** Colours the desktop shell paints before the bundle loads; see stored.web.ts. */
export interface ShellColors {
  bg: string;
  faint: string;
  accent: string;
  symbols: string;
}

/** Native has no desktop shell; its launch splash comes from the app config. */
export function syncShellTheme(_colors: ShellColors): void {}
