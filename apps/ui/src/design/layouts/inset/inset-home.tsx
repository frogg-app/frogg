import { ChevronRight, Plus, Search } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SidebarMenuToggle } from "@/components/headers/menu-header";
import { ScreenHeader } from "@/components/headers/screen-header";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useSidebarWorkspaceEntries } from "@/hooks/use-sidebar-workspace-entries";
import { useSidebarWorkspacesList } from "@/hooks/use-sidebar-workspaces-list";
import type { Theme } from "@/styles/theme";
import { INSET_COPY, VIEW_LABELS } from "./copy";
import {
  countView,
  filterRows,
  groupRows,
  useInsetRows,
  useInsetViewStore,
  type InsetView,
} from "./inset-data";
import { InsetGroupedList } from "./home-list";
import { useInsetActions } from "./use-inset-actions";
import { useScopedHostLabel } from "./use-scoped-host-label";

type HoverState = PressableStateCallbackType & { hovered?: boolean };

const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const onAccentMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });
const spinnerMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedSearch = withUnistyles(Search);
const ThemedPlus = withUnistyles(Plus);
const ThemedChevron = withUnistyles(ChevronRight);
const SEARCH_ICON = <ThemedSearch size={14} uniProps={mutedMapping} />;
const PLUS_ICON = <ThemedPlus size={14} uniProps={onAccentMapping} />;
const CRUMB_ICON = <ThemedChevron size={12} uniProps={mutedMapping} />;

const TABS: readonly InsetView[] = ["all", "active", "inbox", "running"];

function iconButtonStyle({ hovered, pressed }: HoverState) {
  return [styles.iconButton, (Boolean(hovered) || pressed) && styles.iconButtonHovered];
}
function primaryStyle({ hovered, pressed }: HoverState) {
  return [styles.primary, (Boolean(hovered) || pressed) && styles.primaryHovered];
}

/**
 * Linear's issue list as the home screen: a breadcrumb header, saved-view tabs, then every
 * session and chat grouped by status with a count on each group bar.
 */
export function InsetHome() {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const actions = useInsetActions();
  const hostLabel = useScopedHostLabel();
  const view = useInsetViewStore((state) => state.view);
  const setView = useInsetViewStore((state) => state.setView);
  const list = useSidebarWorkspacesList();
  const entries = useSidebarWorkspaceEntries(list.workspacePlacements);
  const rows = useInsetRows(entries);
  const groups = useMemo(() => groupRows(filterRows(rows, view)), [rows, view]);

  let body: React.ReactNode;
  if (groups.length > 0) {
    body = (
      <InsetGroupedList
        groups={groups}
        compact={compact}
        onOpen={actions.openWorkspace}
        onNewSession={actions.newSession}
      />
    );
  } else if (list.isInitialLoad) {
    body = (
      <View style={styles.empty}>
        <ThemedLoadingSpinner size="small" uniProps={spinnerMapping} />
      </View>
    );
  } else {
    body = (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>{INSET_COPY.emptyTitle}</Text>
        <Text style={styles.emptyBody}>{INSET_COPY.emptyBody}</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen} testID="inset-home">
      <ScreenHeader
        left={
          <View style={styles.crumbs}>
            <SidebarMenuToggle />
            <Text style={styles.crumbMuted} numberOfLines={1}>
              {hostLabel}
            </Text>
            {CRUMB_ICON}
            <Text style={styles.crumb} numberOfLines={1}>
              {VIEW_LABELS[view]}
            </Text>
          </View>
        }
        right={
          <View style={styles.headerActions}>
            <Pressable
              onPress={actions.search}
              style={iconButtonStyle}
              accessibilityRole="button"
              accessibilityLabel={t("sidebar.sections.search")}
            >
              {SEARCH_ICON}
            </Pressable>
            <Pressable
              onPress={actions.newSession}
              style={primaryStyle}
              accessibilityRole="button"
              testID="inset-home-new-session"
            >
              {PLUS_ICON}
              {compact ? null : (
                <Text style={styles.primaryText}>{t("sidebar.actions.newWorkspace")}</Text>
              )}
            </Pressable>
          </View>
        }
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabs}
      >
        {TABS.map((tab) => (
          <ViewTab
            key={tab}
            view={tab}
            count={countView(rows, tab)}
            selected={tab === view}
            onSelect={setView}
          />
        ))}
      </ScrollView>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {body}
      </ScrollView>
    </View>
  );
}

function tabStyle({ hovered }: HoverState) {
  return [styles.tab, Boolean(hovered) && styles.tabHovered];
}
function selectedTabStyle() {
  return [styles.tab, styles.tabSelected];
}

function ViewTab({
  view,
  count,
  selected,
  onSelect,
}: {
  view: InsetView;
  count: number;
  selected: boolean;
  onSelect: (view: InsetView) => void;
}) {
  const handlePress = useCallback(() => onSelect(view), [onSelect, view]);
  return (
    <Pressable
      onPress={handlePress}
      style={selected ? selectedTabStyle : tabStyle}
      accessibilityRole="tab"
      accessibilityState={selected ? SELECTED : UNSELECTED}
      testID={`inset-tab-${view}`}
    >
      <Text style={selected ? styles.tabTextSelected : styles.tabText}>{VIEW_LABELS[view]}</Text>
      <Text style={styles.tabCount}>{count}</Text>
    </Pressable>
  );
}

const SELECTED = { selected: true } as const;
const UNSELECTED = { selected: false } as const;

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  crumbs: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    flexShrink: 1,
  },
  crumbMuted: {
    fontSize: 13,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
  },
  crumb: {
    fontSize: 13,
    fontWeight: "500",
    color: theme.colors.foreground,
    flexShrink: 1,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  primary: {
    height: 28,
    minWidth: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: theme.colors.accent,
  },
  primaryHovered: {
    backgroundColor: theme.colors.accentBright,
  },
  primaryText: {
    fontSize: 12,
    fontWeight: "500",
    color: theme.colors.accentForeground,
  },
  tabsScroll: {
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  tabs: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tab: {
    height: 26,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "transparent",
  },
  tabHovered: {
    backgroundColor: theme.colors.surface2,
  },
  tabSelected: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.border,
  },
  tabText: {
    fontSize: 12,
    fontWeight: "500",
    color: theme.colors.foregroundMuted,
  },
  tabTextSelected: {
    fontSize: 12,
    fontWeight: "500",
    color: theme.colors.foreground,
  },
  tabCount: {
    fontSize: 12,
    color: theme.colors.foregroundExtraMuted,
    fontVariant: ["tabular-nums"],
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: { xs: 0, md: 8 },
    paddingTop: 6,
    paddingBottom: 24,
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 64,
    gap: 6,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: "500",
    color: theme.colors.foreground,
  },
  emptyBody: {
    fontSize: 13,
    color: theme.colors.foregroundMuted,
  },
}));
