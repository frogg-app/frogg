import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { overallDevBuildTone, useDevBuildFor } from "./use-dev-builds";
import { devBuildDotTones } from "./dev-build-dot";

/** A "Dev" pill on a sidebar row whose worktree has a dev build running. */
export function DevBuildBadge({ serverId, cwd }: { serverId: string; cwd: string | null }) {
  const { t } = useTranslation();
  const build = useDevBuildFor(serverId, cwd);
  if (!build) return null;
  const tone = overallDevBuildTone(build);
  return (
    <View
      style={styles.badge}
      testID="sidebar-dev-build-badge"
      accessibilityLabel={`${t("devBar.badgeLabel")}: ${t(`devBar.tone.${tone}`)}`}
    >
      <View style={[styles.dot, devBuildDotTones[tone]]} />
      <Text style={styles.text}>{t("devBar.menu")}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexShrink: 0,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  text: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
  },
}));
