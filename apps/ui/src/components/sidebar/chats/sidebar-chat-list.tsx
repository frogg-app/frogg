import { router } from "expo-router";
import { MessageSquarePlus, Trash2 } from "lucide-react-native";
import { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { SearchField } from "@/components/ui/search-field";
import { useToast } from "@/contexts/toast-context";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import {
  navigateToWorkspace,
  useActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import type { Theme } from "@/styles/theme";
import { buildNewChatRoute } from "@/utils/host-routes";
import { toErrorMessage } from "@/utils/error-messages";
import { archiveWorkspaceOptimistically } from "@/workspace/workspace-archive";
import { SidebarSectionTabs } from "./section-tabs";
import { groupSidebarChats, toSidebarChatItem, type SidebarChatItem } from "./chat-list-model";

type HoverState = PressableStateCallbackType & { hovered?: boolean };

const ThemedNewChatIcon = withUnistyles(MessageSquarePlus);
const ThemedTrash = withUnistyles(Trash2);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function sameChatItems(left: SidebarChatItem[], right: SidebarChatItem[]): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const other = right[index]!;
      return (
        item.serverId === other.serverId &&
        item.workspaceId === other.workspaceId &&
        item.title === other.title &&
        item.status === other.status &&
        item.sortTime === other.sortTime
      );
    })
  );
}

function useSidebarChatItems(): SidebarChatItem[] {
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      const items: SidebarChatItem[] = [];
      for (const [serverId, session] of Object.entries(state.sessions)) {
        for (const workspace of session?.workspaces.values() ?? []) {
          if (workspace.chat && !workspace.archivingAt) {
            items.push(toSidebarChatItem(serverId, workspace));
          }
        }
      }
      return items;
    },
    sameChatItems,
  );
}

/** The host a new chat goes to: the one in view when it can run chats, else the first that can. */
function useNewChatServerId(): string | null {
  const selection = useActiveWorkspaceSelection();
  return useSessionStore((state) => {
    const canRunChats = (serverId: string) =>
      state.sessions[serverId]?.serverInfo?.features?.chats === true;
    if (selection && canRunChats(selection.serverId)) return selection.serverId;
    return Object.keys(state.sessions).find(canRunChats) ?? null;
  });
}

function newChatButtonStyle({ hovered }: HoverState) {
  return [styles.newChat, Boolean(hovered) && styles.rowHovered];
}

export function SidebarChatList({ onBeforeNavigate }: { onBeforeNavigate?: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const items = useSidebarChatItems();
  const selection = useActiveWorkspaceSelection();
  const newChatServerId = useNewChatServerId();
  const groups = useMemo(
    () => groupSidebarChats({ items, query, now: new Date() }),
    [items, query],
  );
  const activeKey = selection ? `${selection.serverId}:${selection.workspaceId}` : null;

  const handleNewChat = useCallback(() => {
    if (!newChatServerId) return;
    onBeforeNavigate?.();
    router.push(buildNewChatRoute(newChatServerId));
  }, [newChatServerId, onBeforeNavigate]);

  const handleOpen = useCallback(
    (item: SidebarChatItem) => {
      onBeforeNavigate?.();
      navigateToWorkspace({ serverId: item.serverId, workspaceId: item.workspaceId });
    },
    [onBeforeNavigate],
  );

  const handleDelete = useCallback(
    (item: SidebarChatItem) => {
      const client = getHostRuntimeStore().getClient(item.serverId);
      if (!client) {
        toast.error(t("sidebar.workspace.toasts.hostDisconnected"));
        return;
      }
      archiveWorkspaceOptimistically({
        client,
        workspace: { serverId: item.serverId, workspaceId: item.workspaceId },
      }).catch((error: unknown) => toast.error(toErrorMessage(error)));
    },
    [t, toast],
  );

  let body: React.ReactNode;
  if (groups.length === 0) {
    body = (
      <Text style={styles.empty}>
        {query.trim() ? t("sidebar.chats.noMatches") : t("sidebar.chats.empty")}
      </Text>
    );
  } else {
    body = groups.map((group) => (
      <View key={group.key}>
        <Text style={styles.groupLabel}>{t(`sidebar.chats.groups.${group.key}`)}</Text>
        {group.items.map((item) => {
          const key = `${item.serverId}:${item.workspaceId}`;
          return (
            <SidebarChatRow
              key={key}
              item={item}
              isActive={key === activeKey}
              onOpen={handleOpen}
              onDelete={handleDelete}
              deleteLabel={t("sidebar.chats.delete")}
            />
          );
        })}
      </View>
    ));
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <SidebarSectionTabs />
      </View>
      <Pressable
        onPress={handleNewChat}
        disabled={!newChatServerId}
        testID="sidebar-new-chat"
        accessibilityRole="button"
        style={newChatButtonStyle}
      >
        <ThemedNewChatIcon size={14} uniProps={foregroundColorMapping} />
        <Text style={styles.newChatLabel}>{t("sidebar.chats.newChat")}</Text>
      </Pressable>
      <View style={styles.search}>
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder={t("sidebar.chats.search")}
          clearAccessibilityLabel={t("sessions.actions.clearSearch")}
          testID="sidebar-chat-search"
        />
      </View>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {body}
      </ScrollView>
    </View>
  );
}

function statusDotStyle(status: SidebarChatItem["status"]) {
  switch (status) {
    case "running":
      return styles.dotRunning;
    case "failed":
      return styles.dotFailed;
    case "needs_input":
    case "attention":
      return styles.dotAttention;
    default:
      return styles.dotIdle;
  }
}

const SidebarChatRow = memo(function SidebarChatRow({
  item,
  isActive,
  onOpen,
  onDelete,
  deleteLabel,
}: {
  item: SidebarChatItem;
  isActive: boolean;
  onOpen: (item: SidebarChatItem) => void;
  onDelete: (item: SidebarChatItem) => void;
  deleteLabel: string;
}) {
  const handlePress = useCallback(() => onOpen(item), [item, onOpen]);
  const handleDelete = useCallback(() => onDelete(item), [item, onDelete]);
  const rowStyle = useCallback(
    ({ hovered }: HoverState) => [
      styles.row,
      isActive && styles.rowActive,
      !isActive && Boolean(hovered) && styles.rowHovered,
    ],
    [isActive],
  );
  const renderContent = useCallback(
    ({ hovered }: HoverState) => (
      <>
        <View style={[styles.dot, statusDotStyle(item.status)]} />
        <Text
          numberOfLines={1}
          style={[styles.rowLabel, (isActive || Boolean(hovered)) && styles.rowLabelActive]}
        >
          {item.title}
        </Text>
        {hovered ? (
          <Pressable
            onPress={handleDelete}
            accessibilityRole="button"
            accessibilityLabel={deleteLabel}
            hitSlop={6}
            testID={`sidebar-chat-delete-${item.workspaceId}`}
          >
            <ThemedTrash size={14} uniProps={mutedColorMapping} />
          </Pressable>
        ) : null}
      </>
    ),
    [deleteLabel, handleDelete, isActive, item.status, item.title, item.workspaceId],
  );
  return (
    <Pressable
      onPress={handlePress}
      testID={`sidebar-chat-${item.workspaceId}`}
      accessibilityRole="button"
      style={rowStyle}
    >
      {renderContent}
    </Pressable>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: theme.spacing[2],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: theme.spacing[2],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[2],
  },
  newChat: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  newChatLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  search: {
    marginVertical: theme.spacing[1],
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: theme.spacing[4],
  },
  groupLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 6,
    borderRadius: theme.borderRadius.md,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface1,
  },
  rowActive: {
    backgroundColor: theme.colors.surface2,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotRunning: {
    backgroundColor: theme.colors.statusDotRunning,
  },
  dotFailed: {
    backgroundColor: theme.colors.statusDotDanger,
  },
  dotAttention: {
    backgroundColor: theme.colors.statusDotWarning,
  },
  dotIdle: {
    backgroundColor: theme.colors.surface4,
  },
  rowLabel: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  rowLabelActive: {
    color: theme.colors.foreground,
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[3],
  },
}));
