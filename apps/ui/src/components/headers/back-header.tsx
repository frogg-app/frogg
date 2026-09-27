import { useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import { router } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ArrowLeft } from "lucide-react-native";
import { ScreenHeader } from "./screen-header";
import { ScreenTitle } from "./screen-title";
import { designOf } from "@/styles/design-theme";
import type { DesignTokens } from "@/styles/theme";

interface BackHeaderProps {
  title?: string;
  titleAccessory?: ReactNode;
  rightContent?: ReactNode;
  onBack?: () => void;
}

function goBack(): void {
  router.back();
}

export function BackHeader({ title, titleAccessory, rightContent, onBack }: BackHeaderProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const handleBack = useCallback(() => {
    if (onBack) {
      onBack();
      return;
    }
    goBack();
  }, [onBack]);

  return (
    <ScreenHeader
      left={
        <>
          <Pressable
            onPress={handleBack}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel={t("common.actions.back")}
          >
            <ArrowLeft size={theme.iconSize.lg} color={theme.colors.foregroundMuted} />
          </Pressable>
          {title && <ScreenTitle style={styles.pageTitle}>{title}</ScreenTitle>}
          {titleAccessory}
        </>
      }
      right={rightContent}
      leftStyle={styles.left}
    />
  );
}

const styles = StyleSheet.create((theme, rt) => ({
  left: {
    gap: theme.spacing[2],
  },
  backButton: {
    padding: {
      xs: theme.spacing[3],
      md: theme.spacing[2],
    },
    borderRadius: theme.borderRadius.lg,
  },
  // A back header titles a page (settings on mobile), so it takes the direction's heading face,
  // matching the desktop settings page title. `ScreenTitle` tags the Text for the web font rule.
  pageTitle: { ...pageTitleDesign(designOf(rt.themeName)) },
}));

function pageTitleDesign(design: DesignTokens) {
  if (design.variant === "current") return {};
  return {
    fontFamily: design.headingFontFamily,
    fontWeight: design.headingWeight,
    letterSpacing: design.headingLetterSpacing,
  };
}
