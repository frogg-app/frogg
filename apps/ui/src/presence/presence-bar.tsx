/**
 * COMPAT(sessionPresence): added in v1.6.0.
 *
 * "Who else is here" for an agent chat or a terminal: a small stack of
 * identity avatars and one sentence about them, sitting on the same column as
 * the composer. The sentence leads with whoever is actively writing, because
 * that is the one thing worth interrupting for; everyone else folds into it.
 *
 * It renders nothing at all when nobody else is there, when the daemon does
 * not advertise `features.sessionPresence`, or when the presence request
 * failed — presence is chrome and must never make a chat look broken.
 */
import React, { memo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { MAX_CONTENT_WIDTH } from "@/constants/layout";
import type { Theme } from "@/styles/theme";
import { usePresence } from "@/presence/use-presence";
import { presenceActivityLabelKey } from "@/presence/labels";
import { isActivePresenceActivity, type PresenceOther } from "@/presence/snapshot";
import type { PresenceTargetKind } from "@/presence/target";
import { resolveParticipantName, usePresenceIdentityStore } from "@/presence/identity-store";
import { presenceAvatarColor, presenceInitials } from "@/presence/avatar";

interface PresenceBarProps {
  serverId: string;
  targetKind: PresenceTargetKind;
  targetId: string | null | undefined;
}

export interface NamedPresenceOther extends PresenceOther {
  /** Nickname, else the remote name, else the translated placeholder. */
  name: string;
}

/** The sentence beside the avatars. Exported for the tests. */
export function describePresence(
  others: readonly NamedPresenceOther[],
  t: TFunction,
): { lead: string; rest: string | null } {
  const active = others.find(
    (other) => !other.isExpired && isActivePresenceActivity(other.activity),
  );
  if (active) {
    const restCount = others.length - 1;
    return {
      lead: t(presenceActivityLabelKey(active.activity), { name: active.name }),
      rest: restCount > 0 ? t("presence.summary.moreHere", { count: restCount }) : null,
    };
  }
  const [first, second] = others;
  if (!first) return { lead: "", rest: null };
  if (!second) return { lead: t("presence.summary.one", { name: first.name }), rest: null };
  if (others.length === 2) {
    return {
      lead: t("presence.summary.two", { name: first.name, other: second.name }),
      rest: null,
    };
  }
  return {
    lead: t("presence.summary.many", { name: first.name, count: others.length - 1 }),
    rest: null,
  };
}

export const PresenceBar = memo(function PresenceBar({
  serverId,
  targetKind,
  targetId,
}: PresenceBarProps): React.ReactElement | null {
  const { t } = useTranslation();
  const { view } = usePresence({ serverId, targetKind, targetId });
  const nicknames = usePresenceIdentityStore((state) => state.nicknames);

  if (view.kind !== "list") {
    // Loading draws nothing too: a "checking…" line that usually resolves to
    // nobody would make every chat twitch on open.
    return null;
  }

  const named: NamedPresenceOther[] = view.others.map((other) => ({
    ...other,
    name: resolveParticipantName(other, nicknames) || t("presence.unknownDevice"),
  }));
  const { lead, rest } = describePresence(named, t);
  const stacked = named.slice(0, view.visible.length);
  const hasActive = named.some(
    (other) => !other.isExpired && isActivePresenceActivity(other.activity),
  );

  return (
    <View style={styles.rail} pointerEvents="box-none">
      <View
        style={[styles.row, view.isStale && styles.rowStale]}
        testID="presence-bar"
        accessibilityRole="text"
        accessibilityLabel={`${t("presence.accessibilityLabel")}: ${named
          .map((other) => other.name)
          .join(", ")}`}
      >
        <View style={styles.stack}>
          {stacked.map((other, index) => (
            <PresenceAvatar
              key={other.participantId}
              name={other.name}
              identity={other.clientKey ?? other.participantId}
              isFirst={index === 0}
              isExpired={other.isExpired}
            />
          ))}
          {view.overflowCount > 0 ? (
            <View style={[styles.avatar, styles.avatarOverflow]} testID="presence-bar-overflow">
              <Text style={styles.overflowText}>{`+${view.overflowCount}`}</Text>
            </View>
          ) : null}
        </View>
        {hasActive ? <View style={styles.liveDot} testID="presence-bar-live" /> : null}
        <Text style={styles.lead} numberOfLines={1} testID="presence-participant">
          {lead}
        </Text>
        {rest ? (
          <Text style={styles.rest} numberOfLines={1}>
            {rest}
          </Text>
        ) : null}
        {view.isStale ? (
          <Text style={styles.stale} numberOfLines={1} testID="presence-bar-stale">
            {t("presence.stale")}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

export const PresenceAvatar = memo(function PresenceAvatar({
  name,
  identity,
  isFirst = true,
  isExpired = false,
  size = "sm",
}: {
  name: string;
  identity: string;
  isFirst?: boolean;
  isExpired?: boolean;
  size?: "sm" | "md";
}) {
  const color = presenceAvatarColor(identity);
  return (
    <View
      style={[
        styles.avatar,
        size === "md" && styles.avatarMd,
        !isFirst && styles.avatarStacked,
        isExpired && styles.avatarExpired,
        { backgroundColor: color },
      ]}
      testID="presence-avatar"
    >
      <Text style={[styles.initials, size === "md" && styles.initialsMd]}>
        {presenceInitials(name)}
      </Text>
    </View>
  );
});

const AVATAR_SIZE = 20;

const styles = StyleSheet.create((theme: Theme) => ({
  rail: {
    width: "100%",
    alignItems: "center",
    paddingHorizontal: theme.spacing[4],
  },
  row: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    minWidth: 0,
  },
  rowStale: {
    opacity: 0.6,
  },
  stack: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: theme.colors.surface0,
  },
  avatarMd: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  avatarStacked: {
    marginLeft: -6,
  },
  avatarExpired: {
    opacity: 0.5,
  },
  avatarOverflow: {
    marginLeft: -6,
    width: "auto",
    minWidth: AVATAR_SIZE,
    paddingHorizontal: 4,
    backgroundColor: theme.colors.surface2,
  },
  initials: {
    color: "#ffffff",
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  initialsMd: {
    fontSize: 11,
  },
  overflowText: {
    color: theme.colors.foregroundMuted,
    fontSize: 9,
    fontWeight: "600",
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.accentBright,
    flexShrink: 0,
  },
  lead: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  rest: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  stale: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontStyle: "italic",
  },
}));
