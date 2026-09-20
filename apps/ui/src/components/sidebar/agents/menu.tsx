import { useCallback, useMemo, type ComponentProps, type PropsWithChildren } from "react";
import { useTranslation } from "react-i18next";
import { type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Archive, Hash, MoreVertical, Unlink } from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import { toSessionId, toSubagentSessionId } from "@frogg/protocol/session-id";
import { isWeb } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import { useArchiveSubagent, useDetachSubagent, type SubagentRow } from "@/subagents";
import type { Theme } from "@/styles/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MenuItem } from "@/components/ui/menu";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ThemedMoreVertical = withUnistyles(MoreVertical);
const ThemedArchive = withUnistyles(Archive);
const ThemedUnlink = withUnistyles(Unlink);
const ThemedHash = withUnistyles(Hash);

const sessionIdLeadingIcon = <ThemedHash size={14} uniProps={foregroundMutedColorMapping} />;
const detachLeadingIcon = <ThemedUnlink size={14} uniProps={foregroundMutedColorMapping} />;
const archiveLeadingIcon = <ThemedArchive size={14} uniProps={foregroundMutedColorMapping} />;

function renderTriggerIcon({ hovered }: { hovered?: boolean }) {
  return (
    <ThemedMoreVertical
      size={14}
      uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
    />
  );
}

/**
 * The kebab on a sidebar agent row — the same trigger, in the same column, as the one on the
 * session rows above it, carrying the actions the composer's subagent track already offers:
 * copy the session ID, detach, archive.
 *
 * A provider-reported subagent is not an agent the daemon owns, so it can be identified but
 * not detached or archived; its menu is the copy action alone rather than no menu at all.
 */
function useSidebarAgentActions({ serverId, row }: { serverId: string; row: SubagentRow }) {
  const { t } = useTranslation();
  const toast = useToast();
  const archiveSubagent = useArchiveSubagent({ serverId });
  const detachSubagent = useDetachSubagent({ serverId });
  const canDetach = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.agentDetach === true,
  );
  // A frogg subagent is a full agent with its own UUID; a provider subagent is only unique
  // under its parent, so it takes the composite-key form.
  const sessionId = useMemo(
    () =>
      row.kind === "provider"
        ? toSubagentSessionId(row.parentAgentId, row.id)
        : toSessionId(row.id),
    [row],
  );
  const onCopySessionId = useCallback(() => {
    void Clipboard.setStringAsync(sessionId);
    toast.copied(t("sidebar.workspace.toasts.sessionIdCopied"));
  }, [sessionId, t, toast]);
  const onDetach = useCallback(() => {
    detachSubagent(row.id);
  }, [detachSubagent, row.id]);
  const onArchive = useCallback(() => {
    archiveSubagent(row.id);
  }, [archiveSubagent, row.id]);
  return {
    onCopySessionId,
    onDetach,
    onArchive,
    canDetach,
    isOwnAgent: row.kind === "frogg",
  };
}

/**
 * The actions themselves, shared by the kebab's dropdown and the row's context menu so a right
 * click and a kebab click offer exactly the same menu.
 */
function SidebarAgentMenuItems({
  row,
  surface,
  onCopySessionId,
  onDetach,
  onArchive,
  canDetach,
  isOwnAgent,
}: {
  row: SubagentRow;
  surface: "kebab" | "context";
  onCopySessionId: () => void;
  onDetach: () => void;
  onArchive: () => void;
  canDetach: boolean;
  isOwnAgent: boolean;
}) {
  const { t } = useTranslation();
  const prefix = surface === "context" ? "sidebar-agent-context-menu" : "sidebar-agent-menu";
  return (
    <>
      <MenuItem
        testID={`${prefix}-copy-session-id-${row.id}`}
        leading={sessionIdLeadingIcon}
        onSelect={onCopySessionId}
      >
        {t("sidebar.workspace.actions.copySessionId")}
      </MenuItem>
      {isOwnAgent && canDetach ? (
        <MenuItem
          testID={`${prefix}-detach-${row.id}`}
          leading={detachLeadingIcon}
          onSelect={onDetach}
        >
          {t("subagents.detachTooltip")}
        </MenuItem>
      ) : null}
      {isOwnAgent ? (
        <MenuItem
          testID={`${prefix}-archive-${row.id}`}
          leading={archiveLeadingIcon}
          onSelect={onArchive}
        >
          {t("subagents.archiveTooltip")}
        </MenuItem>
      ) : null}
    </>
  );
}

export function SidebarAgentMenu({
  serverId,
  row,
  label,
  open,
  onOpenChange,
}: {
  serverId: string;
  row: SubagentRow;
  label: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const actions = useSidebarAgentActions({ serverId, row });
  return (
    <DropdownMenu compactMode="sheet" open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        hitSlop={8}
        style={triggerStyle}
        accessibilityRole={isWeb ? undefined : "button"}
        accessibilityLabel={t("subagents.actionsMenu", { label })}
        testID={`sidebar-agent-kebab-${row.id}`}
      >
        {renderTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={260} sheetTitle={label}>
        <SidebarAgentMenuItems row={row} surface="kebab" {...actions} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Right clicking an agent row gives the same actions as its kebab. Without this the row falls
 * through to the platform's own edit menu — copy, paste, select all — which has nothing to do
 * with the agent under the cursor.
 */
export function SidebarAgentContextMenu({
  children,
  serverId,
  row,
  open,
  onOpenChange,
  ...triggerProps
}: PropsWithChildren<
  Omit<ComponentProps<typeof ContextMenuTrigger>, "children" | "enabledOnMobile"> & {
    serverId: string;
    row: SubagentRow;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }
>) {
  const actions = useSidebarAgentActions({ serverId, row });
  return (
    <ContextMenu open={open} onOpenChange={onOpenChange}>
      <ContextMenuTrigger {...triggerProps} enabledOnMobile={false}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent align="start" width={260} testID={`sidebar-agent-context-menu-${row.id}`}>
        <SidebarAgentMenuItems row={row} surface="context" {...actions} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function triggerStyle({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.trigger, hovered && styles.triggerHovered];
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    padding: 2,
    borderRadius: 4,
    marginLeft: 2,
    // MoreVertical paints only around the center of its SVG. Keep the padded hit box, but
    // pull the painted dots through that unused view-box space onto the trailing rail, the
    // same offset the workspace row's kebab uses so the two line up.
    marginRight: -7,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
}));
