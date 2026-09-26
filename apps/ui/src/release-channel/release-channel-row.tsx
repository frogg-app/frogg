import { brand } from "@frogg/branding";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { settingsStyles } from "@/styles/settings";

/**
 * Which channel this build is, shown where the old stable/beta switch was. The channel is not a
 * setting: the beta build is a separate app with its own name, data and daemon, installed beside
 * the stable one, so switching would mean installing the other app.
 */
export function ReleaseChannelRow() {
  const { t } = useTranslation();
  const beta = brand.channel === "beta";
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]} testID="release-channel-row">
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("settings.about.releaseChannel.label")}</Text>
        <Text style={settingsStyles.rowHint}>
          {beta
            ? t("settings.about.releaseChannel.betaHint", { stable: brand.channels.stable.name })
            : t("settings.about.releaseChannel.stableHint", { beta: brand.channels.beta.name })}
        </Text>
      </View>
      <View style={[styles.pill, beta ? styles.pillBeta : null]}>
        <Text style={[styles.pillText, beta ? styles.pillTextBeta : null]}>
          {beta ? t("settings.about.releaseChannel.beta") : t("settings.about.releaseChannel.stable")}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  pill: {
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
  },
  pillBeta: {
    backgroundColor: theme.colors.palette.amber[500],
    borderColor: theme.colors.palette.amber[500],
  },
  pillText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  pillTextBeta: {
    color: theme.colors.palette.zinc[900],
  },
}));
