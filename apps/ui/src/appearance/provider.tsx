import { type ReactNode, useEffect } from "react";
import { useColorScheme } from "react-native";
import { UnistylesRuntime } from "react-native-unistyles";
import { useAppSettings, type AppSettings } from "@/hooks/use-settings";
import { THEME_TO_UNISTYLES, type DesignVariantId } from "@/styles/theme";
import { designThemeKey } from "@/styles/design-variants";
import { useDesignPreviewStore, type DesignSchemePreference } from "@/design/design-preview-store";
import { loadDesignWebFonts } from "@/design/load-web-fonts";
import { applyAppearance } from "./apply";

function applyTheme(preference: AppSettings["theme"]): void {
  if (preference === "auto") {
    UnistylesRuntime.setAdaptiveThemes(true);
    return;
  }

  UnistylesRuntime.setAdaptiveThemes(false);
  UnistylesRuntime.setTheme(THEME_TO_UNISTYLES[preference]);
}

function applyDesignVariant(
  variant: Exclude<DesignVariantId, "current">,
  scheme: DesignSchemePreference,
  systemScheme: "light" | "dark",
): void {
  UnistylesRuntime.setAdaptiveThemes(false);
  UnistylesRuntime.setTheme(designThemeKey(variant, scheme === "auto" ? systemScheme : scheme));
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { settings, isLoading } = useAppSettings();
  const designVariant = useDesignPreviewStore((state) => state.variant);
  const designScheme = useDesignPreviewStore((state) => state.scheme);
  const systemScheme = useColorScheme() === "light" ? "light" : "dark";

  useEffect(() => {
    if (isLoading) return;
    if (designVariant === "current") {
      applyTheme(settings.theme);
    } else {
      loadDesignWebFonts(designVariant);
      applyDesignVariant(designVariant, designScheme, systemScheme);
    }
    applyAppearance({
      uiFontFamily: settings.uiFontFamily,
      monoFontFamily: settings.monoFontFamily,
      uiBaseFontSize: settings.uiBaseFontSize,
      contentFontSize: settings.contentFontSize,
      codeFontSize: settings.codeFontSize,
      syntaxTheme: settings.syntaxTheme,
    });
  }, [
    isLoading,
    designVariant,
    designScheme,
    systemScheme,
    settings.theme,
    settings.uiFontFamily,
    settings.monoFontFamily,
    settings.uiBaseFontSize,
    settings.contentFontSize,
    settings.codeFontSize,
    settings.syntaxTheme,
  ]);

  return children;
}
