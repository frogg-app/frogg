import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useHostRuntimeConnectionStatus, useHosts } from "@/runtime/host-runtime";
import { PaperRecentRow, PaperSectionLabel } from "./paper-sidebar-rows";
import { usePaperRecents, type PaperRecent } from "./use-paper-recents";

type HoverState = PressableStateCallbackType & { hovered?: boolean };

/** Starred (pinned) sessions, then every other session as one flat Recents list. */
export function PaperRecentsList({
  activeKey,
  large = false,
  onOpen,
}: {
  activeKey: string | null;
  large?: boolean;
  onOpen: (item: PaperRecent) => void;
}) {
  const { t } = useTranslation();
  const recents = usePaperRecents();
  const { starred, rest } = useMemo(
    () => ({
      starred: recents.filter((item) => item.pinned),
      rest: recents.filter((item) => !item.pinned),
    }),
    [recents],
  );
  const renderRow = (item: PaperRecent) => {
    const key = `${item.serverId}:${item.workspaceId}`;
    return (
      <PaperRecentRow
        key={key}
        item={item}
        isActive={key === activeKey}
        large={large}
        onOpen={onOpen}
      />
    );
  };
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      {starred.length > 0 ? (
        <View>
          <PaperSectionLabel label={t("sidebar.pinned.title")} />
          {starred.map(renderRow)}
        </View>
      ) : null}
      <PaperSectionLabel label="Recents" /* preview copy */ />
      {rest.length > 0 ? (
        rest.map(renderRow)
      ) : (
        <Text style={styles.empty}>{t("sidebar.chats.empty")}</Text>
      )}
    </ScrollView>
  );
}

function initialOf(label: string): string {
  return (label.trim()[0] ?? "?").toUpperCase();
}

/**
 * Claude's account footer, carried by the host you run on: an initial avatar, the host's name
 * and its connection state (or how many hosts you have). Opens Settings.
 */
export function PaperAccountFooter({
  collapsed = false,
  onPress,
}: {
  collapsed?: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const primary = hosts[0] ?? null;
  const status = useHostRuntimeConnectionStatus(primary?.serverId ?? "");
  const label = primary?.label?.trim() || primary?.serverId || t("sidebar.actions.settings");
  const subline =
    hosts.length > 1
      ? `${hosts.length} hosts` /* preview copy */
      : t(`common.connectionStatus.${status}`);
  const rowStyle = ({ hovered }: HoverState) => [
    collapsed ? styles.footerRail : styles.footer,
    Boolean(hovered) && styles.footerHovered,
  ];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${t("sidebar.actions.settings")}`}
      testID="paper-sidebar-account"
      style={rowStyle}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initialOf(label)}</Text>
        <View style={status === "online" ? styles.presenceOnline : styles.presenceOffline} />
      </View>
      {collapsed ? null : (
        <View style={styles.footerText}>
          <Text numberOfLines={1} style={styles.footerName}>
            {label}
          </Text>
          <Text numberOfLines={1} style={styles.footerSub}>
            {subline}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    paddingHorizontal: 8,
    paddingBottom: 16,
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: 13,
    paddingHorizontal: 8,
    paddingTop: 4,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 8,
    marginVertical: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 10,
  },
  footerRail: {
    alignSelf: "center",
    marginVertical: 10,
    padding: 4,
    borderRadius: 18,
  },
  footerHovered: {
    backgroundColor: theme.colors.surface2,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.foreground,
  },
  avatarText: {
    color: theme.colors.surface0,
    fontSize: 13,
    fontWeight: "600",
  },
  presenceOnline: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: theme.colors.surfaceSidebar,
    backgroundColor: theme.colors.statusSuccess,
  },
  presenceOffline: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: theme.colors.surfaceSidebar,
    backgroundColor: theme.colors.foregroundExtraMuted,
  },
  footerText: {
    flex: 1,
    minWidth: 0,
  },
  footerName: {
    color: theme.colors.foreground,
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: "500",
  },
  footerSub: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    lineHeight: 16,
  },
}));
