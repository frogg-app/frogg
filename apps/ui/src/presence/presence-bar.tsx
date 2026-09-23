/**
 * COMPAT(sessionPresence): added in v1.6.0.
 *
 * "Who else is here" for an agent chat or a terminal. One compact row of
 * device names with what each of them is doing, folded into a "+N" past a few.
 * It renders nothing at all when nobody else is there, when the daemon does
 * not advertise `features.sessionPresence`, or when the presence request
 * failed — presence is chrome and must never make a chat look broken.
 */
import React, { memo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { Theme } from "@/styles/theme";
import { usePresence } from "@/presence/use-presence";
import { presenceActivityLabelKey } from "@/presence/labels";
import type { PresenceOther } from "@/presence/snapshot";
import type { PresenceTargetKind } from "@/presence/target";

interface PresenceBarProps {
  serverId: string;
  targetKind: PresenceTargetKind;
  targetId: string | null | undefined;
}

export const PresenceBar = memo(function PresenceBar({
  serverId,
  targetKind,
  targetId,
}: PresenceBarProps): React.ReactElement | null {
  const { t } = useTranslation();
  const { view } = usePresence({ serverId, targetKind, targetId });

  if (view.kind === "hidden") {
    return null;
  }
  if (view.kind === "loading") {
    return (
      <View style={styles.row} testID="presence-bar-loading" pointerEvents="none">
        <Text style={styles.muted} numberOfLines={1}>
          {t("presence.loading")}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={styles.row}
      testID="presence-bar"
      accessibilityLabel={t("presence.accessibilityLabel")}
    >
      <Text style={styles.label} numberOfLines={1}>
        {t("presence.label")}
      </Text>
      {view.visible.map((other) => (
        <PresenceChip key={other.participantId} other={other} isStale={view.isStale} />
      ))}
      {view.overflowCount > 0 ? (
        <Text style={styles.muted} numberOfLines={1} testID="presence-bar-overflow">
          {t("presence.overflow", { count: view.overflowCount })}
        </Text>
      ) : null}
      {view.isStale ? (
        <Text style={styles.stale} numberOfLines={1} testID="presence-bar-stale">
          {t("presence.stale")}
        </Text>
      ) : null}
    </View>
  );
});

const PresenceChip = memo(function PresenceChip({
  other,
  isStale,
}: {
  other: PresenceOther;
  isStale: boolean;
}) {
  const { t } = useTranslation();
  // `deviceName` is written by the remote device, so it arrives already
  // sanitized and truncated from `selectOtherParticipants`. An empty string
  // means nothing printable survived.
  const name = other.deviceName || t("presence.unknownDevice");
  const chipStyle = isStale || other.isExpired ? styles.chipStale : styles.chip;
  return (
    <View style={chipStyle}>
      <Text style={styles.chipText} numberOfLines={1} testID="presence-participant">
        {t(presenceActivityLabelKey(other.activity), { name })}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create((theme: Theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "nowrap",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[1],
    paddingBottom: theme.spacing[1],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  stale: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
  },
  chip: {
    flexShrink: 1,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
  },
  chipStale: {
    flexShrink: 1,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    opacity: 0.6,
  },
  chipText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
