import { router } from "expo-router";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MenuItem, MenuRoot, MenuSeparator, MenuSurface, MenuTrigger } from "@/components/ui/menu";
import type { MenuTriggerState } from "@/components/ui/menu";
import { useToast } from "@/contexts/toast-context";
import { useSidebarWorkspacePinController } from "@/hooks/use-sidebar-workspace-pin";
import { useKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher-context";
import { useHostFeature } from "@/runtime/host-features";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { DESIGN_FONT_DATASET } from "@/styles/code-surface";
import { toErrorMessage } from "@/utils/error-messages";
import { buildOpenProjectRoute } from "@/utils/host-routes";
import { archiveWorkspaceOptimistically } from "@/workspace/workspace-archive";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { PaperIcon, paperMuted } from "./paper-icons";
import { paperWorkspaceTitle } from "./use-paper-recents";

const ICON = 14;
const starIcon = <PaperIcon.star size={ICON} uniProps={paperMuted} />;
const unstarIcon = <PaperIcon.starOff size={ICON} uniProps={paperMuted} />;
const renameIcon = <PaperIcon.pencil size={ICON} uniProps={paperMuted} />;
const archiveIcon = <PaperIcon.archive size={ICON} uniProps={paperMuted} />;

function triggerStyle({ hovered, open }: MenuTriggerState) {
  return [styles.trigger, (hovered || open) && styles.triggerHovered];
}

/**
 * Claude's conversation header: the chat's title centred above the thread, with a chevron that
 * opens Star, Rename and Delete. Here those are the session's pin, rename and archive.
 */
export function PaperConversationTop({ serverId, agentId }: { serverId: string; agentId: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const dispatcher = useKeyboardActionDispatcher();
  const togglePin = useSidebarWorkspacePinController();
  const canPin = useHostFeature(serverId, "workspacePinning");
  const agentTitle = useSessionStore(
    (state) => state.sessions[serverId]?.agents.get(agentId)?.title ?? null,
  );
  const workspaceId = useSessionStore(
    (state) => state.sessions[serverId]?.agents.get(agentId)?.workspaceId ?? null,
  );
  const workspace = useWorkspaceFields(serverId, workspaceId, (entry) => ({
    id: entry.id,
    title: paperWorkspaceTitle(entry),
    pinnedAt: entry.pinnedAt ?? null,
  }));
  const title = workspace?.title ?? agentTitle ?? t("agentList.fallbackTitle");

  const handlePin = useCallback(() => {
    if (!workspace) return;
    const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId: workspace.id });
    if (!workspaceKey) return;
    togglePin({ serverId, workspaceId: workspace.id, workspaceKey, pinnedAt: workspace.pinnedAt });
  }, [serverId, togglePin, workspace]);
  const handleRename = useCallback(() => {
    dispatcher.dispatch({ id: "workspace.rename", scope: "workspace" });
  }, [dispatcher]);
  const handleArchive = useCallback(() => {
    if (!workspace) return;
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client) {
      toast.error(t("sidebar.workspace.toasts.hostDisconnected"));
      return;
    }
    router.push(buildOpenProjectRoute());
    archiveWorkspaceOptimistically({
      client,
      workspace: { serverId, workspaceId: workspace.id },
    }).catch((error: unknown) => toast.error(toErrorMessage(error)));
  }, [serverId, t, toast, workspace]);

  return (
    <View style={styles.bar} testID="paper-conversation-top">
      <MenuRoot compactMode="sheet">
        <MenuTrigger
          style={triggerStyle}
          accessibilityRole="button"
          accessibilityLabel={title}
          testID="paper-conversation-title"
        >
          <Text numberOfLines={1} style={styles.title} dataSet={DESIGN_FONT_DATASET}>
            {title}
          </Text>
          <PaperIcon.chevronDown size={14} strokeWidth={1.8} uniProps={paperMuted} />
        </MenuTrigger>
        <MenuSurface
          side="bottom"
          align="center"
          width={220}
          sheetTitle={title}
          testID="paper-conversation-menu"
        >
          {workspace && canPin ? (
            <MenuItem
              leading={workspace.pinnedAt ? unstarIcon : starIcon}
              onSelect={handlePin}
              testID="paper-conversation-pin"
            >
              {workspace.pinnedAt
                ? t("sidebar.workspace.actions.unpin")
                : t("sidebar.workspace.actions.pin")}
            </MenuItem>
          ) : null}
          {workspace ? (
            <MenuItem leading={renameIcon} onSelect={handleRename} testID="paper-conversation-rename">
              {t("sidebar.workspace.actions.rename")}
            </MenuItem>
          ) : null}
          {workspace ? <MenuSeparator /> : null}
          {workspace ? (
            <MenuItem
              leading={archiveIcon}
              onSelect={handleArchive}
              destructive
              testID="paper-conversation-archive"
            >
              {t("sidebar.workspace.actions.archive")}
            </MenuItem>
          ) : null}
        </MenuSurface>
      </MenuRoot>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 2,
    paddingHorizontal: 24,
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 560,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
  title: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontFamily: theme.design.headingFontFamily,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "500",
  },
}));
