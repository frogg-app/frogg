import { useMemo, useState, useCallback, useEffect, type ReactElement } from "react";
import { View, Text } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { router } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ChevronLeft } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { AgentList } from "@/components/agent-list";
import { SearchField } from "@/components/ui/search-field";
import { HostFilter } from "@/components/hosts/host-filter";
import { ALL_HOSTS_OPTION_ID } from "@/components/hosts/host-picker";
import { type AgentHistoryHostError, useAgentHistory } from "@/hooks/use-agent-history";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { buildOpenProjectRoute } from "@/utils/host-routes";

/** Long enough that a typed word is one request, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 200;

const sessionsHostOptionTestID = (serverId: string) => `sessions-host-filter-item-${serverId}`;

/**
 * A host that failed while others answered. Without this the list silently
 * under-reports, and under a query "No sessions match" becomes a claim the app
 * has no basis for.
 */
function SessionHostErrorsBanner({
  errors,
  t,
}: {
  errors: AgentHistoryHostError[];
  t: TFunction;
}): ReactElement {
  return (
    <View style={styles.errorsBannerWrap}>
      <View style={styles.errorsBanner} testID="sessions-host-errors">
        {errors.map((error) => (
          <Text key={error.serverId} style={styles.errorsBannerText}>
            {t("sessions.hostLoadFailed", { host: error.serverName })}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** An empty list means something different once a query is narrowing it. */
function resolveEmptyText(input: {
  t: TFunction;
  isSearching: boolean;
  isAllHosts: boolean;
  isProjectScoped: boolean;
}): string {
  if (input.isSearching) return input.t("sessions.noMatches");
  // A scoped view is never "no sessions anywhere" — the fleet may be full of
  // them. What it can say is that this project has none.
  if (input.isProjectScoped) return input.t("sessions.emptyForProject");
  if (input.isAllHosts) return input.t("sessions.empty");
  return "No sessions for this host";
}

export interface SessionsScreenProps {
  /** Scopes the list to one project's sessions. Absent = the whole fleet. */
  projectKey?: string | null;
  /** The host owning `projectKey`. A project key is only unique per host. */
  serverId?: string | null;
}

export function SessionsScreen(props: SessionsScreenProps) {
  const isFocused = useIsFocused();

  if (!isFocused) {
    return <View style={styles.container} />;
  }

  return <SessionsScreenContent {...props} />;
}

/**
 * The project name to put in the header. The host's directory replica is the
 * authority, because it still names a project whose sessions are all archived —
 * the placement carried on a row would leave that case titleless.
 */
function useScopedProjectName(input: {
  serverId: string | null;
  projectKey: string | null;
}): string | null {
  const { serverId, projectKey } = input;
  return useSessionStore(
    useCallback(
      (state) => {
        if (!serverId || !projectKey) return null;
        for (const project of state.sessions[serverId]?.projects.values() ?? []) {
          if (project.projectKey === projectKey || project.projectId === projectKey) {
            return project.projectCustomName ?? project.projectDisplayName;
          }
        }
        return null;
      },
      [projectKey, serverId],
    ),
  );
}

/**
 * Resolves the optional project scope into what the history request and the
 * header need.
 */
function useProjectScope(input: { projectKey: string | null; serverId: string | null }) {
  const { projectKey, serverId } = input;
  // Scoping needs both halves: a project key only identifies a project on the
  // host that issued it, so one without the other would silently widen the view.
  const scope = projectKey && serverId ? { projectKey, serverId } : null;
  const scopedProjectName = useScopedProjectName({
    serverId: scope?.serverId ?? null,
    projectKey: scope?.projectKey ?? null,
  });
  // Archived rows are the point of the scoped view; history includes them by
  // default, and saying so keeps the request honest about what it asked for.
  const scopedProjectKey = scope?.projectKey ?? null;
  const historyFilter = useMemo(
    () =>
      scopedProjectKey ? { projectKeys: [scopedProjectKey], includeArchived: true } : undefined,
    [scopedProjectKey],
  );
  return {
    isProjectScoped: scope !== null,
    scopedServerId: scope?.serverId ?? null,
    projectLabel: scope ? (scopedProjectName ?? scope.projectKey) : null,
    historyFilter,
  };
}

function resolveTitle(t: TFunction, projectLabel: string | null): string {
  return projectLabel ? t("sessions.projectTitle", { project: projectLabel }) : t("sessions.title");
}

/** A picked host that has since disconnected or been removed. */
function isStaleHostSelection(
  selectedHost: string,
  hosts: ReadonlyArray<{ serverId: string }>,
): boolean {
  return (
    selectedHost !== ALL_HOSTS_OPTION_ID && !hosts.some((host) => host.serverId === selectedHost)
  );
}

function resolveHistoryServerId(scopedServerId: string | null, selectedHost: string) {
  if (scopedServerId) return scopedServerId;
  return selectedHost === ALL_HOSTS_OPTION_ID ? null : selectedHost;
}

function SessionsFilterRow(props: {
  showSearch: boolean;
  searchInput: string;
  onChangeSearch: (value: string) => void;
  showHostFilter: boolean;
  hosts: ReturnType<typeof useHosts>;
  selectedHost: string;
  onSelectHost: (serverId: string) => void;
  t: TFunction;
}) {
  const { t } = props;
  return (
    <View style={styles.filterContainer}>
      {props.showSearch ? (
        <SearchField
          value={props.searchInput}
          onChangeText={props.onChangeSearch}
          placeholder={t("sessions.searchPlaceholder")}
          clearAccessibilityLabel={t("sessions.actions.clearSearch")}
          testID="sessions-search-input"
          clearTestID="sessions-search-clear"
        />
      ) : null}
      {props.showHostFilter ? (
        <HostFilter
          hosts={props.hosts}
          selectedHost={props.selectedHost}
          onSelectHost={props.onSelectHost}
          triggerTestID="sessions-host-filter-trigger"
          hostOptionTestID={sessionsHostOptionTestID}
        />
      ) : null}
    </View>
  );
}

function SessionsEmptyState(props: {
  text: string;
  isSearching: boolean;
  onClearSearch: () => void;
  onBack: () => void;
  t: TFunction;
}) {
  return (
    <View style={styles.emptyContainer} testID="sessions-empty">
      <Text style={styles.emptyText}>{props.text}</Text>
      {props.isSearching ? (
        <Button variant="ghost" onPress={props.onClearSearch}>
          {props.t("sessions.actions.clearSearch")}
        </Button>
      ) : (
        <Button variant="ghost" leftIcon={ChevronLeft} onPress={props.onBack}>
          Back
        </Button>
      )}
    </View>
  );
}

function SessionsScreenContent({ projectKey = null, serverId = null }: SessionsScreenProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const hosts = useHosts();
  const { isProjectScoped, scopedServerId, projectLabel, historyFilter } = useProjectScope({
    projectKey,
    serverId,
  });
  const [selectedHost, setSelectedHost] = useState(ALL_HOSTS_OPTION_ID);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS).trim();
  const historyServerId = resolveHistoryServerId(scopedServerId, selectedHost);
  const {
    agents,
    hasMore,
    isInitialLoad,
    isLoadingMore,
    isError,
    isSearchSupported,
    isSearchTruncated,
    searchMatchesByAgentKey,
    hostErrors,
    loadMore,
    refreshAll,
  } = useAgentHistory({
    serverId: historyServerId,
    search,
    ...(historyFilter ? { filter: historyFilter } : {}),
  });
  const isSearching = isSearchSupported && search.length > 0;

  useEffect(() => {
    if (!isProjectScoped && isStaleHostSelection(selectedHost, hosts)) {
      setSelectedHost(ALL_HOSTS_OPTION_ID);
    }
  }, [hosts, isProjectScoped, selectedHost]);

  const [isManualRefresh, setIsManualRefresh] = useState(false);

  const handleRefresh = useCallback(() => {
    setIsManualRefresh(true);
    void refreshAll().finally(() => setIsManualRefresh(false));
  }, [refreshAll]);

  // `useAgentHistory` owns the order: recency at rest, relevance under a query.
  const emptyText = resolveEmptyText({
    t,
    isSearching,
    isAllHosts: selectedHost === ALL_HOSTS_OPTION_ID,
    isProjectScoped,
  });
  // The host picker is dropped in the scoped view rather than pinned to the
  // scoped host: every option it could still offer would break the scope, so a
  // control that cannot be used is worse than one that is not there. The header
  // already names the project, and the project only exists on one host.
  const showHostFilter = !isProjectScoped && hosts.length > 1;
  const showFilterRow = showHostFilter || isSearchSupported;
  const showLoadError = isError && agents.length === 0;

  const handleBack = useCallback(() => {
    router.navigate(buildOpenProjectRoute());
  }, []);

  const handleClearSearch = useCallback(() => setSearchInput(""), []);

  const listFooterComponent = useMemo(() => {
    // A ranked result set has no next page — reaching a weaker match means
    // narrowing the query, so the footer says that instead of offering a button.
    if (isSearchTruncated) {
      return (
        <View style={styles.footer}>
          <Text style={styles.footerHint}>{t("sessions.tooManyMatches")}</Text>
        </View>
      );
    }
    if (!hasMore) {
      return null;
    }
    return (
      <View style={styles.footer}>
        <Button variant="ghost" onPress={loadMore} disabled={isLoadingMore}>
          {isLoadingMore ? "Loading..." : t("sessions.actions.loadMore")}
        </Button>
      </View>
    );
  }, [hasMore, isLoadingMore, isSearchTruncated, loadMore, t]);

  return (
    <View style={styles.container}>
      <MenuHeader title={resolveTitle(t, projectLabel)} />
      {showFilterRow ? (
        <SessionsFilterRow
          showSearch={isSearchSupported}
          searchInput={searchInput}
          onChangeSearch={setSearchInput}
          showHostFilter={showHostFilter}
          hosts={hosts}
          selectedHost={selectedHost}
          onSelectHost={setSelectedHost}
          t={t}
        />
      ) : null}
      {hostErrors.length > 0 ? <SessionHostErrorsBanner errors={hostErrors} t={t} /> : null}
      {isInitialLoad ? (
        <View style={styles.loadingContainer}>
          <LoadingSpinner size="large" color={theme.colors.foregroundMuted} />
        </View>
      ) : null}
      {!isInitialLoad && showLoadError ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Unable to load sessions</Text>
          <Button variant="ghost" onPress={handleRefresh}>
            Try again
          </Button>
        </View>
      ) : null}
      {!isInitialLoad && !showLoadError && agents.length === 0 ? (
        <SessionsEmptyState
          text={emptyText}
          isSearching={isSearching}
          onClearSearch={handleClearSearch}
          onBack={handleBack}
          t={t}
        />
      ) : null}
      {!isInitialLoad && !showLoadError && agents.length > 0 ? (
        <AgentList
          agents={agents}
          showCheckoutInfo={false}
          isRefreshing={isManualRefresh}
          onRefresh={handleRefresh}
          listFooterComponent={listFooterComponent}
          showAttentionIndicator={false}
          showHostColumn
          searchMatchesByAgentKey={isSearching ? searchMatchesByAgentKey : undefined}
          flat={isSearching}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  filterContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[4],
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[6],
    padding: theme.spacing[6],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  footer: {
    alignItems: "center",
    paddingVertical: theme.spacing[4],
  },
  footerHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  errorsBannerWrap: {
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[3],
  },
  errorsBanner: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
    gap: theme.spacing[1],
  },
  errorsBannerText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
}));
