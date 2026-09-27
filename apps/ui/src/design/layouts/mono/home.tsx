import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHosts } from "@/runtime/host-runtime";
import { OpenProjectScreen } from "@/screens/open-project-screen";
import { DESIGN_FONT_DATASET } from "@/styles/code-surface";
import { ChatsFilterBar } from "./chats-filter-bar";
import { ChatsListRow, ChatsTableRow } from "./chats-table";
import { useAgentsHydrated, useMonoChatRows, useNow, type MonoChatRow } from "./mono-data";
import { MonoText } from "./mono-parts";
import { useMonoScope } from "./mono-scope";

// Mono's home: Vercel's deployments page for chats. A tight heading with a live count, the
// filter row, then the table. With no chats at all it falls back to the shipping onboarding.

// preview copy
const COPY = {
  title: "Chats",
  subtitle: "Every agent on your hosts, most recent activity first.",
  noMatches: "No chats match these filters.",
  clear: "Clear filters",
  running: "running",
  total: "total",
};

function matches(row: MonoChatRow, filters: ReturnType<typeof useFilters>): boolean {
  if (filters.serverId && row.serverId !== filters.serverId) return false;
  if (filters.projectName && row.projectName !== filters.projectName) return false;
  if (filters.status && row.bucket !== filters.status) return false;
  if (filters.branch && row.branch !== filters.branch) return false;
  const query = filters.query.trim().toLocaleLowerCase();
  if (!query) return true;
  return [row.title, row.shortId, row.branch, row.projectName, row.model, row.agentId].some(
    (value) => value?.toLocaleLowerCase().includes(query) ?? false,
  );
}

function useFilters() {
  const serverId = useMonoScope((state) => state.serverId);
  const projectName = useMonoScope((state) => state.projectName);
  const status = useMonoScope((state) => state.status);
  const branch = useMonoScope((state) => state.branch);
  const query = useMonoScope((state) => state.query);
  return useMemo(
    () => ({ serverId, projectName, status, branch, query }),
    [branch, projectName, query, serverId, status],
  );
}

export function MonoHome() {
  const rows = useMonoChatRows();
  const hasHosts = useHosts().length > 0;
  const hydrated = useAgentsHydrated();
  if (rows.length === 0 && (!hasHosts || hydrated)) return <OpenProjectScreen />;
  return <MonoChatsDashboard rows={rows} loading={!hydrated} />;
}

function MonoChatsDashboard({ rows, loading }: { rows: MonoChatRow[]; loading: boolean }) {
  const compact = useIsCompactFormFactor();
  const filters = useFilters();
  const clearFilters = useMonoScope((state) => state.clearFilters);
  const scoped = useMemo(
    () => (filters.serverId ? rows.filter((row) => row.serverId === filters.serverId) : rows),
    [filters.serverId, rows],
  );
  const visible = useMemo(() => scoped.filter((row) => matches(row, filters)), [filters, scoped]);
  const runningCount = useMemo(() => scoped.filter((row) => row.bucket === "running").length, [scoped]);
  const now = useNow(runningCount > 0);
  const Row = compact ? ChatsListRow : ChatsTableRow;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID="mono-home">
      <View style={styles.heading}>
        <View style={styles.headingText}>
          <Text style={styles.title} dataSet={DESIGN_FONT_DATASET}>
            {COPY.title}
          </Text>
          {compact ? null : <Text style={styles.subtitle}>{COPY.subtitle}</Text>}
        </View>
        <View style={styles.counts}>
          <MonoText tone="strong">{runningCount}</MonoText>
          <MonoText tone="muted">{COPY.running}</MonoText>
          <MonoText tone="faint">/</MonoText>
          <MonoText tone="strong">{scoped.length}</MonoText>
          <MonoText tone="muted">{COPY.total}</MonoText>
        </View>
      </View>
      <ChatsFilterBar rows={scoped} compact={compact} />
      <View style={styles.table}>
        {visible.map((row, index) => (
          <Row key={row.key} row={row} now={now} first={index === 0} />
        ))}
        {loading && visible.length === 0 ? <LoadingRows /> : null}
        {!loading && visible.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.subtitle}>{COPY.noMatches}</Text>
            <Pressable onPress={clearFilters} style={styles.clear} testID="mono-clear-filters">
              <Text style={styles.clearText}>{COPY.clear}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

function LoadingRows() {
  return (
    <>
      {[0, 1, 2].map((index) => (
        <View key={index} style={index === 0 ? styles.skeletonRowFirst : styles.skeletonRow}>
          <View style={styles.skeletonShort} />
          <View style={styles.skeletonLong} />
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  scroll: {
    flex: 1,
    backgroundColor: theme.colors.surface1,
  },
  content: {
    width: "100%",
    maxWidth: 1200,
    alignSelf: "center",
    paddingHorizontal: { xs: 12, md: 32 },
    paddingTop: { xs: 16, md: 32 },
    paddingBottom: 48,
    gap: 16,
  },
  heading: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 16,
  },
  headingText: { gap: 4, flexShrink: 1 },
  title: {
    color: theme.colors.foreground,
    fontFamily: theme.design.headingFontFamily,
    fontSize: { xs: 22, md: 28 },
    fontWeight: "600",
    letterSpacing: -0.8,
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: 14,
  },
  counts: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingBottom: 4,
  },
  table: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    overflow: "hidden",
  },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 24,
    height: 64,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  skeletonRowFirst: {
    flexDirection: "row",
    alignItems: "center",
    gap: 24,
    height: 64,
    paddingHorizontal: 16,
  },
  skeletonShort: {
    width: 90,
    height: 10,
    borderRadius: 4,
    backgroundColor: theme.colors.surface2,
  },
  skeletonLong: {
    flex: 1,
    maxWidth: 360,
    height: 10,
    borderRadius: 4,
    backgroundColor: theme.colors.surface2,
  },
  empty: {
    alignItems: "center",
    gap: 12,
    paddingVertical: 48,
  },
  clear: {
    height: 32,
    paddingHorizontal: 12,
    justifyContent: "center",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  clearText: {
    color: theme.colors.foreground,
    fontSize: 13,
    fontWeight: "500",
  },
}));
