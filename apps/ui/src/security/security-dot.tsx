import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { SecuritySeverity } from "./posture";

/**
 * The "this host needs securing" notification dot. Renders nothing when there
 * are no findings, so callers can place it unconditionally.
 */
export function SecurityDot({
  severity,
  testID,
}: {
  severity: SecuritySeverity | null;
  testID?: string;
}) {
  const { t } = useTranslation();
  if (!severity) return null;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={t("settings.host.security.dotLabel")}
      style={[styles.dot, severity === "critical" ? styles.critical : styles.warning]}
      testID={testID ?? `security-dot-${severity}`}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  dot: {
    width: 7,
    height: 7,
    borderRadius: theme.borderRadius.full,
  },
  critical: { backgroundColor: theme.colors.statusDotDanger },
  warning: { backgroundColor: theme.colors.statusDotWarning },
}));
