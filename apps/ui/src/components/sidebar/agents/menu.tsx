import { useCallback, useMemo } from "react";
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
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  const handleCopySessionId = useCallback(() => {
    void Clipboard.setStringAsync(sessionId);
    toast.copied(t("sidebar.workspace.toasts.sessionIdCopied"));
  }, [sessionId, t, toast]);
  const handleDetach = useCallback(() => {
    detachSubagent(row.id);
  }, [detachSubagent, row.id]);
  const handleArchive = useCallback(() => {
    archiveSubagent(row.id);
  }, [archiveSubagent, row.id]);
  const isOwnAgent = row.kind === "frogg";
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
        <DropdownMenuItem
          testID={`sidebar-agent-menu-copy-session-id-${row.id}`}
          leading={sessionIdLeadingIcon}
          onSelect={handleCopySessionId}
        >
          {t("sidebar.workspace.actions.copySessionId")}
        </DropdownMenuItem>
        {isOwnAgent && canDetach ? (
          <DropdownMenuItem
            testID={`sidebar-agent-menu-detach-${row.id}`}
            leading={detachLeadingIcon}
            onSelect={handleDetach}
          >
            {t("subagents.detachTooltip")}
          </DropdownMenuItem>
        ) : null}
        {isOwnAgent ? (
          <DropdownMenuItem
            testID={`sidebar-agent-menu-archive-${row.id}`}
            leading={archiveLeadingIcon}
            onSelect={handleArchive}
          >
            {t("subagents.archiveTooltip")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
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
