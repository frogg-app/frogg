/**
 * COMPAT(sessionPresence): added in v1.6.0.
 *
 * The one-line amber note inside the composer naming whoever else is writing
 * to this agent. It takes the shape the stale-context warning established: in
 * the composer's own flow rather than floating over it, memoised so a keystroke
 * does not re-measure the composer through it, and nothing at all in the
 * ordinary case where there is nobody else.
 *
 * It is a warning, never a block. The composer stays fully usable underneath.
 */
import React, { memo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { Theme } from "@/styles/theme";
import type { PresenceWarning } from "@/presence/snapshot";

export const PresenceComposerNotice = memo(function PresenceComposerNotice({
  warning,
}: {
  warning: PresenceWarning | null;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (warning === null) {
    return null;
  }
  const name = warning.deviceName || t("presence.unknownDevice");
  return (
    <View style={styles.notice} pointerEvents="none">
      <Text style={styles.text} numberOfLines={1} testID="composer-presence-warning">
        {warning.additionalCount > 0
          ? t("presence.composer.warningMany", { name, count: warning.additionalCount })
          : t("presence.composer.warningOne", { name })}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create((theme: Theme) => ({
  notice: {
    alignSelf: "stretch",
  },
  text: {
    color: theme.colors.palette.amber[500],
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
}));
