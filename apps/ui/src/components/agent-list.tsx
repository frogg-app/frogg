import {
  View,
  Text,
  Pressable,
  Modal,
  RefreshControl,
  FlatList,
  type ListRenderItem,
  type PressableStateCallbackType,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useIsCompactFormFactor } from "@/constants/layout";
import { formatTimeAgo } from "@/utils/time";
import { type AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useSessionStore } from "@/stores/session-store";
import { Archive, ChevronRight } from "lucide-react-native";
import { getProviderIcon } from "@/components/provider-icons";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import { HighlightedText } from "@/components/ui/highlighted-text";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import type { AgentSearchMatch } from "@frogg/protocol/messages";
import type { MatchRange } from "@frogg/protocol/search/text-match";
import { DESIGN_FONT_DATASET } from "@/styles/code-surface";
import type { Theme } from "@/styles/theme";
import { themeOf } from "@/styles/design-theme";
import { designTextFont } from "@/styles/settings-treatment";
import { usePanelMetaDataSet } from "@/workspace/use-panel-meta-dataset";

interface AgentListProps {
  agents: AggregatedAgent[];
  showCheckoutInfo?: boolean;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  selectedAgentId?: string;
  onAgentSelect?: () => void;
  listFooterComponent?: ReactElement | null;
  showAttentionIndicator?: boolean;
  showHostColumn?: boolean;
  /**
   * Where a search matched each row, keyed by `serverId:agentId`. Rows mark the
   * spans so the list can explain why a result is in it — the subsequence and
   * typo tiers match characters the eye would not find on its own.
   */
  searchMatchesByAgentKey?: Record<string, AgentSearchMatch[]>;
  /**
   * Renders one flat list in the given order instead of grouping by day. Day
   * headings claim the list is chronological, which is a lie once the caller
   * has ordered it by something else — relevance, for instance.
   */
  flat?: boolean;
}

type DateSectionKey = "today" | "yesterday" | "thisWeek" | "thisMonth" | "older";

const DATE_SECTION_ORDER = [
  "today",
  "yesterday",
  "thisWeek",
  "thisMonth",
  "older",
] as const satisfies readonly DateSectionKey[];

type FlatListItem =
  | { type: "header"; key: string; section: DateSectionKey }
  | { type: "agent"; key: string; agent: AggregatedAgent };

function deriveDateSectionKey(lastActivityAt: Date): DateSectionKey {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const activityStart = new Date(
    lastActivityAt.getFullYear(),
    lastActivityAt.getMonth(),
    lastActivityAt.getDate(),
  );

  if (activityStart.getTime() >= todayStart.getTime()) {
    return "today";
  }
  if (activityStart.getTime() >= yesterdayStart.getTime()) {
    return "yesterday";
  }

  const diffTime = todayStart.getTime() - activityStart.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays <= 7) {
    return "thisWeek";
  }
  if (diffDays <= 30) {
    return "thisMonth";
  }
  return "older";
}

function formatDateSectionLabel(t: TFunction, section: DateSectionKey): string {
  switch (section) {
    case "today":
      return t("agentList.dateSections.today");
    case "yesterday":
      return t("agentList.dateSections.yesterday");
    case "thisWeek":
      return t("agentList.dateSections.thisWeek");
    case "thisMonth":
      return t("agentList.dateSections.thisMonth");
    case "older":
      return t("agentList.dateSections.older");
  }
}

function SessionBadge({
  label,
  icon,
  tone = "neutral",
}: {
  label: string;
  icon?: ReactElement;
  tone?: "neutral" | "warning" | "danger";
}) {
  let variant: StatusBadgeVariant = "muted";
  if (tone === "warning") variant = "warning";
  else if (tone === "danger") variant = "error";
  return <StatusBadge label={label} variant={variant} leading={icon} />;
}

function WorkspaceTitlePrefix({
  visible,
  workspaceName,
  ranges,
  testID,
  iconSize,
  color,
}: {
  visible: boolean;
  workspaceName: string;
  ranges?: readonly MatchRange[];
  testID: string;
  iconSize: number;
  color: string;
}) {
  if (!visible) {
    return null;
  }

  return (
    <>
      <HighlightedText
        text={workspaceName}
        ranges={ranges}
        style={styles.workspaceTitleText}
        numberOfLines={1}
        testID={testID}
      />
      <ChevronRight size={iconSize} color={color} />
    </>
  );
}

function SessionRowBadges({
  agent,
  archivedIcon,
  pendingPermissionCount,
  showDesktopAttention,
}: {
  agent: AggregatedAgent;
  archivedIcon: ReactElement;
  pendingPermissionCount: number;
  showDesktopAttention: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      {agent.archivedAt ? (
        <SessionBadge label={t("agentList.badges.archived")} icon={archivedIcon} />
      ) : null}
      {pendingPermissionCount > 0 ? (
        <SessionBadge
          label={t("agentList.badges.pending", { count: pendingPermissionCount })}
          tone="warning"
        />
      ) : null}
      {showDesktopAttention ? (
        <SessionBadge label={t("agentList.badges.attention")} tone="danger" />
      ) : null}
    </>
  );
}

function SessionRowTrailingAttention({
  isMobile,
  showAttentionIndicator,
  requiresAttention,
}: {
  isMobile: boolean;
  showAttentionIndicator: boolean;
  requiresAttention: boolean | undefined;
}) {
  const { t } = useTranslation();
  if (!isMobile || !showAttentionIndicator || !requiresAttention) {
    return null;
  }
  return (
    <View style={styles.rowTrailing}>
      <SessionBadge label={t("agentList.badges.attention")} tone="danger" />
    </View>
  );
}

function SessionRow({
  agent,
  searchMatches,
  isMobile,
  selectedAgentId,
  showAttentionIndicator,
  showHostColumn,
  onPress,
  onLongPress,
}: {
  agent: AggregatedAgent;
  searchMatches?: readonly AgentSearchMatch[];
  isMobile: boolean;
  selectedAgentId?: string;
  showAttentionIndicator: boolean;
  showHostColumn: boolean;
  onPress: (agent: AggregatedAgent) => void;
  onLongPress: (agent: AggregatedAgent) => void;
}) {
  const { theme } = useUnistyles();
  const metaDataSet = usePanelMetaDataSet();
  const { t } = useTranslation();
  const timeAgo = formatTimeAgo(agent.lastActivityAt);
  const agentKey = `${agent.serverId}:${agent.id}`;
  const isSelected = selectedAgentId === agentKey;
  const projectName = agent.projectPlacement?.projectName ?? "";
  const branch = agent.projectPlacement?.checkout.currentBranch ?? "";
  const workspaceName = agent.projectPlacement?.workspaceName ?? "";
  const ProviderIcon = getProviderIcon(agent.provider);
  const pendingPermissionCount = agent.pendingPermissionCount ?? 0;
  const rangesFor = useCallback(
    (field: AgentSearchMatch["field"]) =>
      searchMatches?.find((match) => match.field === field)?.ranges,
    [searchMatches],
  );

  const pressableStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      isSelected && styles.rowSelected,
      Boolean(hovered) && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [isSelected],
  );

  const handlePress = useCallback(() => onPress(agent), [onPress, agent]);
  const handleLongPress = useCallback(() => onLongPress(agent), [onLongPress, agent]);

  const sessionTitleStyle = useMemo(
    () => [styles.sessionTitle, isSelected && styles.sessionTitleHighlighted],
    [isSelected],
  );

  const archivedIcon = useMemo(
    () => <Archive size={theme.fontSize.sm} color={theme.colors.foregroundMuted} />,
    [theme.fontSize.sm, theme.colors.foregroundMuted],
  );
  const showDesktopAttention =
    !isMobile && showAttentionIndicator && Boolean(agent.requiresAttention);

  return (
    <Pressable
      style={pressableStyle}
      onPress={handlePress}
      onLongPress={handleLongPress}
      testID={`agent-row-${agent.serverId}-${agent.id}`}
    >
      <View style={styles.rowContent}>
        <View style={styles.rowTitleRow}>
          <WorkspaceTitlePrefix
            visible={!isMobile && Boolean(workspaceName)}
            workspaceName={workspaceName}
            ranges={rangesFor("workspace")}
            testID={`agent-row-workspace-${agent.serverId}-${agent.id}`}
            iconSize={theme.iconSize.xs}
            color={theme.colors.foregroundMuted}
          />
          <View style={styles.providerIconWrap}>
            <ProviderIcon size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
          </View>
          <HighlightedText
            text={agent.title || t("agentList.fallbackTitle")}
            ranges={agent.title ? rangesFor("title") : undefined}
            style={sessionTitleStyle}
            numberOfLines={1}
          />
          <SessionRowBadges
            agent={agent}
            archivedIcon={archivedIcon}
            pendingPermissionCount={pendingPermissionCount}
            showDesktopAttention={showDesktopAttention}
          />
        </View>
        {isMobile ? (
          <View style={styles.rowMetaRow}>
            <HighlightedText
              text={projectName}
              ranges={rangesFor("project")}
              style={styles.sessionMetaText}
              numberOfLines={1}
              testID={`agent-row-project-${agent.serverId}-${agent.id}`}
            />
            <Text style={styles.sessionMetaSeparator}>·</Text>
            <HighlightedText
              text={branch}
              ranges={rangesFor("branch")}
              style={styles.sessionMetaText}
              numberOfLines={1}
              testID={`agent-row-branch-${agent.serverId}-${agent.id}`}
            />
            <Text style={styles.sessionMetaSeparator}>·</Text>
            <HighlightedText
              text={workspaceName}
              ranges={rangesFor("workspace")}
              style={styles.sessionMetaText}
              numberOfLines={1}
              testID={`agent-row-workspace-${agent.serverId}-${agent.id}`}
            />
            <Text style={styles.sessionMetaSeparator}>·</Text>
            <Text style={styles.sessionMetaTime} dataSet={metaDataSet}>
              {timeAgo}
            </Text>
            {showHostColumn && agent.serverLabel ? (
              <>
                <Text style={styles.sessionMetaSeparator}>·</Text>
                <Text style={styles.sessionMetaText} numberOfLines={1}>
                  {agent.serverLabel}
                </Text>
              </>
            ) : null}
          </View>
        ) : null}
      </View>
      {!isMobile ? (
        <View style={styles.rowColumns} dataSet={metaDataSet}>
          <HighlightedText
            text={projectName}
            ranges={rangesFor("project")}
            style={styles.columnMetaProject}
            numberOfLines={1}
            testID={`agent-row-project-${agent.serverId}-${agent.id}`}
          />
          {showHostColumn ? (
            <Text style={styles.columnMetaHost} numberOfLines={1}>
              {agent.serverLabel}
            </Text>
          ) : null}
          <HighlightedText
            text={branch}
            ranges={rangesFor("branch")}
            style={styles.columnMetaBranch}
            numberOfLines={1}
            testID={`agent-row-branch-${agent.serverId}-${agent.id}`}
          />
          <Text style={styles.columnMetaFixed} numberOfLines={1}>
            {timeAgo}
          </Text>
        </View>
      ) : null}
      <SessionRowTrailingAttention
        isMobile={isMobile}
        showAttentionIndicator={showAttentionIndicator}
        requiresAttention={agent.requiresAttention}
      />
    </Pressable>
  );
}

export function AgentList({
  agents,
  isRefreshing = false,
  onRefresh,
  selectedAgentId,
  onAgentSelect,
  listFooterComponent,
  showAttentionIndicator = true,
  showHostColumn = false,
  searchMatchesByAgentKey,
  flat = false,
}: AgentListProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [actionAgent, setActionAgent] = useState<AggregatedAgent | null>(null);
  const isMobile = useIsCompactFormFactor();
  const { archiveAgent } = useArchiveAgent();

  const actionClient = useSessionStore((state) =>
    actionAgent?.serverId ? (state.sessions[actionAgent.serverId]?.client ?? null) : null,
  );

  const isActionSheetVisible = actionAgent !== null;
  const isActionDaemonUnavailable = Boolean(actionAgent?.serverId && !actionClient);

  const handleAgentPress = useCallback(
    (agent: AggregatedAgent) => {
      if (isActionSheetVisible) {
        return;
      }

      const serverId = agent.serverId;
      const agentId = agent.id;

      onAgentSelect?.();
      navigateToAgent({
        serverId,
        agentId,
        workspaceId: agent.workspaceId,
        pin: true,
      });
    },
    [isActionSheetVisible, onAgentSelect],
  );

  const handleAgentLongPress = useCallback(
    (agent: AggregatedAgent) => {
      const isRunning = agent.status === "running";
      if (isRunning) {
        setActionAgent(agent);
        return;
      }

      const client = useSessionStore.getState().sessions[agent.serverId]?.client ?? null;
      if (!client) {
        setActionAgent(agent);
        return;
      }
      void archiveAgent({ serverId: agent.serverId, agentId: agent.id }).catch(() => {});
    },
    [archiveAgent],
  );

  const handleCloseActionSheet = useCallback(() => {
    setActionAgent(null);
  }, []);

  const handleArchiveAgent = useCallback(() => {
    if (!actionAgent || !actionClient) {
      return;
    }
    // Timeout errors are swallowed — the daemon will still process the archive
    void archiveAgent({ serverId: actionAgent.serverId, agentId: actionAgent.id }).catch(() => {});
    setActionAgent(null);
  }, [actionAgent, actionClient, archiveAgent]);

  const flatItems = useMemo((): FlatListItem[] => {
    if (flat) {
      return agents.map((agent) => ({
        type: "agent" as const,
        key: `${agent.serverId}:${agent.id}`,
        agent,
      }));
    }

    const buckets = new Map<DateSectionKey, AggregatedAgent[]>();
    for (const agent of agents) {
      const section = deriveDateSectionKey(agent.lastActivityAt);
      const existing = buckets.get(section) ?? [];
      existing.push(agent);
      buckets.set(section, existing);
    }

    const result: FlatListItem[] = [];
    for (const section of DATE_SECTION_ORDER) {
      const data = buckets.get(section);
      if (!data || data.length === 0) {
        continue;
      }
      result.push({ type: "header", key: `header:${section}`, section });
      for (const agent of data) {
        result.push({ type: "agent", key: `${agent.serverId}:${agent.id}`, agent });
      }
    }
    return result;
  }, [agents, flat]);

  const renderItem: ListRenderItem<FlatListItem> = useCallback(
    ({ item }) => {
      if (item.type === "header") {
        return (
          <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle} dataSet={DESIGN_FONT_DATASET}>
              {formatDateSectionLabel(t, item.section)}
            </Text>
          </View>
        );
      }
      return (
        <SessionRow
          agent={item.agent}
          searchMatches={searchMatchesByAgentKey?.[item.key]}
          isMobile={isMobile}
          selectedAgentId={selectedAgentId}
          showAttentionIndicator={showAttentionIndicator}
          showHostColumn={showHostColumn}
          onPress={handleAgentPress}
          onLongPress={handleAgentLongPress}
        />
      );
    },
    [
      handleAgentLongPress,
      handleAgentPress,
      isMobile,
      searchMatchesByAgentKey,
      selectedAgentId,
      showAttentionIndicator,
      showHostColumn,
      t,
    ],
  );

  const keyExtractor = useCallback((item: FlatListItem) => item.key, []);

  const refreshColors = useMemo(
    () => [theme.colors.foregroundMuted],
    [theme.colors.foregroundMuted],
  );
  const sheetContainerStyle = useMemo(
    () => [styles.sheetContainer, { paddingBottom: Math.max(insets.bottom, theme.spacing[6]) }],
    [insets.bottom, theme.spacing],
  );
  const sheetArchiveTextStyle = useMemo(
    () => [styles.sheetArchiveText, isActionDaemonUnavailable && styles.sheetArchiveTextDisabled],
    [isActionDaemonUnavailable],
  );

  const refreshControl = useMemo(
    () =>
      onRefresh ? (
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          tintColor={theme.colors.foregroundMuted}
          colors={refreshColors}
        />
      ) : undefined,
    [onRefresh, isRefreshing, theme.colors.foregroundMuted, refreshColors],
  );

  return (
    <>
      <FlatList
        data={flatItems}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListFooterComponent={listFooterComponent}
        refreshControl={refreshControl}
      />

      <Modal
        visible={isActionSheetVisible}
        animationType="fade"
        transparent
        onRequestClose={handleCloseActionSheet}
      >
        <View style={styles.sheetOverlay}>
          <Pressable style={styles.sheetBackdrop} onPress={handleCloseActionSheet} />
          <View style={sheetContainerStyle}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>
              {isActionDaemonUnavailable
                ? t("agentList.archiveSheet.hostOffline")
                : t("agentList.archiveSheet.runningAgent")}
            </Text>
            <View style={styles.sheetButtonRow}>
              <Pressable
                style={[styles.sheetButton, styles.sheetCancelButton]}
                onPress={handleCloseActionSheet}
                testID="agent-action-cancel"
              >
                <Text style={styles.sheetCancelText}>{t("common.actions.cancel")}</Text>
              </Pressable>
              <Pressable
                disabled={isActionDaemonUnavailable}
                style={[styles.sheetButton, styles.sheetArchiveButton]}
                onPress={handleArchiveAgent}
                testID="agent-action-archive"
              >
                <Text style={sheetArchiveTextStyle}>{t("agentList.archiveSheet.archive")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const SECTION_TITLE = {
  current: { size: "base", weight: "500", transform: "none", spacing: 0 },
  inset: { size: "sm", weight: "500", transform: "none", spacing: 0 },
  mono: { size: "sm", weight: "500", transform: "uppercase", spacing: 0.8 },
  paper: { size: "xl", weight: "500", transform: "none", spacing: -0.2 },
  focus: { size: "sm", weight: "500", transform: "none", spacing: 0 },
  soft: { size: "lg", weight: "700", transform: "none", spacing: -0.2 },
} as const;

const ROW_PADDING = {
  current: 2,
  inset: 1.5,
  mono: 3,
  paper: 3,
  focus: 3,
  soft: 3,
} as const;

// Every direction-dependent value below reads the REAL theme (`themeOf(rt.themeName)`, referenced
// inside the style value) so a live direction switch on web recomputes it.

function rowShape(theme: Theme) {
  const variant = theme.design.variant;
  if (variant === "mono") {
    // A dashboard table: square rows on hairline dividers.
    return {
      borderRadius: 0,
      marginBottom: 0,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    };
  }
  if (variant === "soft") {
    return {
      borderRadius: theme.borderRadius.xl,
      marginBottom: theme.spacing[1],
      backgroundColor: { xs: theme.colors.surface1, md: "transparent" },
    };
  }
  if (variant === "current") {
    return {
      borderRadius: { xs: theme.borderRadius.lg, md: 0 },
      marginBottom: { xs: theme.spacing[1], md: 0 },
    };
  }
  return { borderRadius: theme.borderRadius.lg, marginBottom: 0 };
}

function metaFont(theme: Theme, size: number) {
  return theme.design.monoMeta
    ? { fontFamily: theme.design.monoFontFamily, fontSize: theme.fontSize.sm }
    : { fontSize: size };
}

function sectionTitleFont(theme: Theme) {
  const spec = SECTION_TITLE[theme.design.variant] ?? SECTION_TITLE.current;
  const face =
    theme.design.variant === "mono"
      ? designTextFont(theme, theme.design.monoFontFamily)
      : designTextFont(theme, theme.design.headingFontFamily);
  return {
    ...face,
    fontSize: theme.fontSize[spec.size],
    fontWeight: spec.weight,
    textTransform: spec.transform,
    letterSpacing: spec.spacing,
    color:
      theme.design.variant === "paper" || theme.design.variant === "soft"
        ? theme.colors.foreground
        : theme.colors.foregroundMuted,
  };
}

// Project and branch columns narrow inside a capped reading column so titles keep their room.
function metaColumnWidth(theme: Theme): number {
  return theme.design.contentMaxWidth ? 112 : 132;
}

function rowTextSize(theme: Theme): number {
  return theme.design.variant === "inset" ? 13 : theme.fontSize.base;
}

const styles = StyleSheet.create((theme, rt) => {
  return {
    list: {
      flex: 1,
      minHeight: 0,
    },
    listContent: {
      width: "100%",
      maxWidth: themeOf(rt.themeName).design.contentMaxWidth ?? undefined,
      alignSelf: "center",
      paddingHorizontal: {
        xs: theme.spacing[3],
        md: theme.spacing[6],
      },
      paddingTop: theme.spacing[4],
      paddingBottom: theme.spacing[6],
      gap: themeOf(rt.themeName).design.variant === "mono" ? 0 : theme.spacing[1],
    },
    sectionHeading: {
      marginTop:
        themeOf(rt.themeName).design.variant === "current" ? theme.spacing[2] : theme.spacing[4],
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[3],
      paddingHorizontal: theme.spacing[3],
      marginBottom: theme.spacing[2],
    },
    sectionTitle: {
      ...sectionTitleFont(themeOf(rt.themeName)),
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical:
        theme.spacing[ROW_PADDING[themeOf(rt.themeName).design.variant] ?? ROW_PADDING.current],
      paddingHorizontal: theme.spacing[3],
      ...rowShape(themeOf(rt.themeName)),
    },
    rowContent: {
      flex: 1,
      minWidth: 0,
      overflow: "hidden",
    },
    rowTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "nowrap",
      gap: theme.spacing[2],
      overflow: "hidden",
    },
    providerIconWrap: {
      width: theme.iconSize.md,
      alignItems: "center",
      justifyContent: "center",
    },
    workspaceTitleText: {
      flexShrink: 0,
      maxWidth: 220,
      fontSize: theme.fontSize.base,
      color: theme.colors.foregroundMuted,
    },
    rowMetaRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: theme.spacing[1],
      marginTop: 2,
    },
    rowTrailing: {
      marginLeft: theme.spacing[2],
    },
    rowSelected: {
      backgroundColor: theme.colors.surface2,
    },
    rowHovered: {
      backgroundColor: theme.colors.surface1,
    },
    rowPressed: {
      backgroundColor: theme.colors.surface2,
    },
    sessionTitle: {
      flexShrink: 1,
      minWidth: 0,
      fontSize: rowTextSize(themeOf(rt.themeName)),
      fontWeight: "400",
      color: theme.colors.foreground,
      opacity: 0.86,
    },
    sessionTitleHighlighted: {
      opacity: 1,
    },
    sessionMetaText: {
      maxWidth: "100%",
      fontSize: rowTextSize(themeOf(rt.themeName)),
      color: theme.colors.foregroundMuted,
    },
    sessionMetaTime: {
      color: theme.colors.foregroundMuted,
      ...metaFont(themeOf(rt.themeName), rowTextSize(themeOf(rt.themeName))),
    },
    sessionMetaSeparator: {
      fontSize: theme.fontSize.base,
      color: theme.colors.foregroundMuted,
      opacity: 0.7,
    },
    rowColumns: {
      flexDirection: "row",
      alignItems: "center",
      flexShrink: 0,
      gap: theme.spacing[3],
    },
    columnMetaProject: {
      fontSize: rowTextSize(themeOf(rt.themeName)),
      // Inside the mono-tagged columns the web UI-font rule no longer reaches the project name.
      fontFamily: themeOf(rt.themeName).design.monoMeta
        ? themeOf(rt.themeName).design.uiFontFamily
        : undefined,
      color: theme.colors.foregroundMuted,
      flexShrink: 0,
      width: metaColumnWidth(themeOf(rt.themeName)),
    },
    columnMetaBranch: {
      ...metaFont(themeOf(rt.themeName), rowTextSize(themeOf(rt.themeName))),
      color: theme.colors.foregroundMuted,
      flexShrink: 0,
      width: metaColumnWidth(themeOf(rt.themeName)),
    },
    columnMetaFixed: {
      ...metaFont(themeOf(rt.themeName), rowTextSize(themeOf(rt.themeName))),
      color: theme.colors.foregroundMuted,
      flexShrink: 0,
      width: 72,
      textAlign: "right" as const,
    },
    columnMetaHost: {
      ...metaFont(themeOf(rt.themeName), rowTextSize(themeOf(rt.themeName))),
      color: theme.colors.foregroundMuted,
      flexShrink: 0,
      // A capped reading column (Paper, Focus, Soft) has no room for the host column.
      display: themeOf(rt.themeName).design.contentMaxWidth ? "none" : "flex",
      width: 120,
      marginLeft: theme.spacing[4],
      textAlign: "right" as const,
    },
    sheetOverlay: {
      flex: 1,
      justifyContent: "flex-end",
    },
    sheetBackdrop: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: "rgba(0,0,0,0.35)",
    },
    sheetContainer: {
      backgroundColor: theme.colors.surface2,
      borderTopLeftRadius: theme.borderRadius["2xl"],
      borderTopRightRadius: theme.borderRadius["2xl"],
      paddingHorizontal: theme.spacing[6],
      paddingTop: theme.spacing[4],
      gap: theme.spacing[4],
    },
    sheetHandle: {
      alignSelf: "center",
      width: 40,
      height: 4,
      borderRadius: theme.borderRadius.full,
      backgroundColor: theme.colors.foregroundMuted,
      opacity: 0.3,
    },
    sheetTitle: {
      fontSize: theme.fontSize.base,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.foreground,
      textAlign: "center",
    },
    sheetButtonRow: {
      flexDirection: "row",
      gap: theme.spacing[3],
    },
    sheetButton: {
      flex: 1,
      borderRadius: theme.borderRadius.lg,
      paddingVertical: theme.spacing[4],
      alignItems: "center",
      justifyContent: "center",
    },
    sheetArchiveButton: {
      backgroundColor: theme.colors.primary,
    },
    sheetArchiveText: {
      color: theme.colors.primaryForeground,
      fontWeight: theme.fontWeight.semibold,
      fontSize: theme.fontSize.base,
    },
    sheetArchiveTextDisabled: {
      opacity: 0.5,
    },
    sheetCancelButton: {
      backgroundColor: theme.colors.surface1,
    },
    sheetCancelText: {
      color: theme.colors.foreground,
      fontWeight: theme.fontWeight.semibold,
      fontSize: theme.fontSize.base,
    },
  };
});
