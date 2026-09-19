import { useEffect, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Archive, Hash, Pencil, Pin, PinOff, Tag } from "lucide-react-native";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useWorkspaceLabelMenuPages,
  WORKSPACE_LABEL_PAGE_ID,
  type WorkspaceLabelTarget,
} from "@/workspace-labels/picker";

/**
 * The trailing 3-dot kebab, expanded.
 *
 * Holding Alt turns the kebab on the selected and hovered rows into this rail: the five
 * things people do to a session in bulk, one press each, no menu to open and dismiss per
 * session. Archiving a run of finished sessions is the case it exists for.
 *
 * Icon-only by necessity — five labelled rows do not fit a sidebar — so every icon carries
 * the action's real name in a tooltip. The order matches the kebab's own so muscle memory
 * built in one transfers to the other.
 */

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ThemedPencil = withUnistyles(Pencil);
const ThemedPin = withUnistyles(Pin);
const ThemedPinOff = withUnistyles(PinOff);
const ThemedTag = withUnistyles(Tag);
const ThemedHash = withUnistyles(Hash);
const ThemedArchive = withUnistyles(Archive);

type QuickActionIcon = typeof ThemedPencil;

const ICON_SIZE = 14;
/** One button: the icon plus the 2px padding that gives it a hover chip. */
const ACTION_WIDTH = ICON_SIZE + 4;
const ACTION_GAP = 1;
const ACTION_COUNT = 5;
/**
 * The collapsed width, which is the kebab's own painted footprint. The rail grows out of the
 * dots and shrinks back into them rather than appearing beside them.
 */
const COLLAPSED_WIDTH = ACTION_WIDTH;
const EXPANDED_WIDTH = ACTION_WIDTH * ACTION_COUNT + ACTION_GAP * (ACTION_COUNT - 1);

/**
 * Fast on purpose. This is a modifier-hold affordance like the shortcut badges, and a hold
 * that takes a beat to answer reads as lag rather than as animation.
 */
const EXPAND_DURATION_MS = 110;

export interface SidebarWorkspaceQuickActionsProps {
  workspaceKey: string;
  serverId: string;
  workspaceId: string;
  workspaceLabels?: readonly string[];
  isPinned?: boolean;
  onRename?: () => void;
  onTogglePin?: () => void;
  onCopySessionId: () => void;
  onArchive: () => void;
  archiveLabel?: string;
}

export function SidebarWorkspaceQuickActions({
  workspaceKey,
  serverId,
  workspaceId,
  workspaceLabels,
  isPinned = false,
  onRename,
  onTogglePin,
  onCopySessionId,
  onArchive,
  archiveLabel,
}: SidebarWorkspaceQuickActionsProps): ReactElement {
  const { t } = useTranslation();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, { duration: EXPAND_DURATION_MS });
  }, [progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: COLLAPSED_WIDTH + (EXPANDED_WIDTH - COLLAPSED_WIDTH) * progress.value,
    opacity: progress.value,
  }));

  return (
    <Animated.View
      style={[styles.rail, animatedStyle]}
      testID={`sidebar-workspace-quick-actions-${workspaceKey}`}
    >
      <QuickAction
        label={t("sidebar.workspace.actions.rename")}
        testID={`sidebar-workspace-quick-action-rename-${workspaceKey}`}
        onPress={onRename}
        Icon={ThemedPencil}
      />
      <QuickAction
        label={isPinned ? t("sidebar.workspace.actions.unpin") : t("sidebar.workspace.actions.pin")}
        testID={`sidebar-workspace-quick-action-pin-${workspaceKey}`}
        onPress={onTogglePin}
        Icon={isPinned ? ThemedPinOff : ThemedPin}
      />
      <QuickActionLabels
        workspaceKey={workspaceKey}
        serverId={serverId}
        workspaceId={workspaceId}
        workspaceLabels={workspaceLabels}
      />
      <QuickAction
        label={t("sidebar.workspace.actions.copySessionId")}
        testID={`sidebar-workspace-quick-action-copy-session-id-${workspaceKey}`}
        onPress={onCopySessionId}
        Icon={ThemedHash}
      />
      <QuickAction
        label={archiveLabel ?? t("sidebar.workspace.actions.archive")}
        testID={`sidebar-workspace-quick-action-archive-${workspaceKey}`}
        onPress={onArchive}
        Icon={ThemedArchive}
      />
    </Animated.View>
  );
}

/**
 * Labels is the one action that cannot complete in a press, so it opens the same picker the
 * kebab's `Labels` row opens — the popover's root page is the picker itself rather than a menu
 * containing a row that leads to it, since the icon has already made the choice the row would.
 */
function QuickActionLabels({
  workspaceKey,
  serverId,
  workspaceId,
  workspaceLabels,
}: {
  workspaceKey: string;
  serverId: string;
  workspaceId: string;
  workspaceLabels?: readonly string[];
}): ReactElement {
  const { t } = useTranslation();
  const target: WorkspaceLabelTarget = {
    serverId,
    workspaceId,
    labels: workspaceLabels ?? [],
  };
  const pages = useWorkspaceLabelMenuPages(target);
  const rootPage = pages.find((page) => page.id === WORKSPACE_LABEL_PAGE_ID);

  return (
    <DropdownMenu compactMode="sheet">
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            hitSlop={8}
            style={quickActionStyle}
            accessibilityRole={isWeb ? undefined : "button"}
            accessibilityLabel={t("workspaceLabels.title")}
            testID={`sidebar-workspace-quick-action-labels-${workspaceKey}`}
          >
            {({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => (
              <ThemedTag
                size={ICON_SIZE}
                uniProps={hovered || pressed ? foregroundColorMapping : foregroundMutedColorMapping}
              />
            )}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{t("workspaceLabels.title")}</Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        width={260}
        pages={pages}
        sheetTitle={t("workspaceLabels.title")}
      >
        {rootPage?.content}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * An action with nothing to offer is drawn disabled rather than dropped: the rail would
 * otherwise reshuffle between rows, and the icon under the pointer would not be the icon
 * that was under it a row ago.
 */
function QuickAction({
  label,
  testID,
  onPress,
  Icon,
}: {
  label: string;
  testID: string;
  onPress?: () => void;
  Icon: QuickActionIcon;
}): ReactElement {
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild disabled={!onPress}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={onPress ? undefined : DISABLED_STATE}
          disabled={!onPress}
          testID={testID}
          onPress={onPress}
          style={quickActionStyle}
          hitSlop={8}
        >
          {({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => (
            <View style={onPress ? undefined : styles.actionDisabled}>
              <Icon
                size={ICON_SIZE}
                uniProps={hovered || pressed ? foregroundColorMapping : foregroundMutedColorMapping}
              />
            </View>
          )}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const DISABLED_STATE = { disabled: true };

function quickActionStyle({ hovered = false }: { hovered?: boolean; pressed?: boolean }) {
  return [styles.action, hovered && styles.actionHovered];
}

const styles = StyleSheet.create((theme) => ({
  rail: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: ACTION_GAP,
    overflow: "hidden",
    // Matches the kebab trigger's pull onto the trailing rail, so the rightmost icon lands
    // exactly where the dots it replaced were painted.
    marginRight: -7,
  },
  action: {
    padding: 2,
    borderRadius: 4,
  },
  actionHovered: {
    backgroundColor: theme.colors.surface2,
  },
  actionDisabled: {
    opacity: 0.4,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
