import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check, Copy, RotateCw, TriangleAlert } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type {
  ReleaseStream,
  ReleaseStreamChange,
  ReleaseStreamFlow,
} from "@frogg/protocol/messages";
import {
  PaneContentToolbar,
  PaneToolbarAccessory,
  paneContentToolbarIconSize,
} from "@/components/ui/pane-content-toolbar";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SearchInput } from "@/components/ui/combobox";
import {
  foregroundMutedColorMapping,
  warningColorMapping,
} from "@/git/pull-request-panel/section-kit";
import { ICON_SIZE } from "@/styles/theme";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { formatTimeAgo } from "@/utils/time";
import {
  filterChanges,
  layoutStreamGraph,
  normalizePresenceState,
  orderStreams,
  summarizeFlow,
  type ChangeFilter,
  type StreamsGraphPayload,
} from "./model";
import { StreamGraph, type StreamGraphLabels } from "./stream-graph";
import { useReleaseStreams } from "./use-release-streams";

const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedCopy = withUnistyles(Copy);
const ThemedCheck = withUnistyles(Check);
const ThemedWarning = withUnistyles(TriangleAlert);

const STREAM_NAME_KEYS: Record<string, string> = {
  development: "releaseStreams.stream.development",
  stable: "releaseStreams.stream.stable",
  "upstream-development": "releaseStreams.stream.upstreamDevelopment",
  "upstream-stable": "releaseStreams.stream.upstreamStable",
};

function streamName(t: TFunction, id: string): string {
  const key = STREAM_NAME_KEYS[id];
  return key ? t(key) : id;
}

/**
 * Release streams: where the development (beta) and stable branches are, what upstream has, and
 * which change has reached which stream. The graph shows the shape; the flows say what is waiting
 * and the command that moves it; the change list answers "does stable have this yet?".
 */
export function StreamsPane({
  serverId,
  cwd,
  isOpen = true,
}: {
  serverId: string;
  cwd: string;
  isOpen?: boolean;
}) {
  const { t } = useTranslation();
  const state = useReleaseStreams({ serverId, cwd, enabled: isOpen });
  const data = state.data;
  const waiting = data?.flows.find((flow) => flow.kind === "promote")?.pending ?? 0;
  const summary = data?.config
    ? t("releaseStreams.toolbarSummary", {
        development: data.config.development,
        stable: data.config.stable,
        count: waiting,
      })
    : "";

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      testID="release-streams-pane"
    >
      <PaneContentToolbar style={styles.toolbar} testID="release-streams-toolbar">
        <Text style={styles.toolbarText} numberOfLines={1}>
          {summary}
        </Text>
        <View style={styles.toolbarActions}>
          {state.supported ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("releaseStreams.refresh")}
              style={iconButtonStyle}
              hitSlop={8}
              onPress={state.refetch}
              disabled={state.isFetching}
              testID="release-streams-refresh"
            >
              {state.isFetching ? (
                <ThemedLoadingSpinner
                  size={paneContentToolbarIconSize(false)}
                  uniProps={foregroundMutedColorMapping}
                />
              ) : (
                <ThemedRotateCw
                  size={paneContentToolbarIconSize(false)}
                  uniProps={foregroundMutedColorMapping}
                />
              )}
            </Pressable>
          ) : null}
          <PaneToolbarAccessory />
        </View>
      </PaneContentToolbar>
      <StreamsBody state={state} />
    </ScrollView>
  );
}

function StreamsBody({ state }: { state: ReturnType<typeof useReleaseStreams> }) {
  const { t } = useTranslation();
  if (!state.supported) {
    return (
      <EmptyState
        title={t("releaseStreams.unsupportedTitle")}
        description={t("releaseStreams.unsupportedDescription")}
      />
    );
  }
  if (state.isLoading || (!state.data && !state.error)) {
    return (
      <View style={styles.loading}>
        <ThemedLoadingSpinner size={ICON_SIZE.md} uniProps={foregroundMutedColorMapping} />
      </View>
    );
  }
  if (state.error || !state.data) {
    return <EmptyState title={t("releaseStreams.errorTitle")} description={state.error ?? ""} />;
  }
  return <StreamsContent data={state.data} />;
}

function StreamsContent({ data }: { data: StreamsGraphPayload }) {
  const { t } = useTranslation();
  const streams = useMemo(() => orderStreams(data.streams), [data.streams]);
  const layout = useMemo(
    () => layoutStreamGraph({ streams: data.streams, events: data.events, flows: data.flows }),
    [data.streams, data.events, data.flows],
  );
  const labels = useMemo<StreamGraphLabels>(
    () => ({
      channel: (channel) => t(`releaseStreams.channel.${channel === "stable" ? "stable" : "beta"}`),
      unreleased: (count) => t("releaseStreams.graph.unreleased", { count }),
      upToDate: t("releaseStreams.graph.upToDate"),
      missing: t("releaseStreams.graph.missing"),
      edge: (kind, count) =>
        kind === "backport"
          ? t("releaseStreams.graph.backport", { count })
          : kind === "promote"
            ? t("releaseStreams.graph.promote")
            : kind === "sync"
              ? t("releaseStreams.graph.sync")
              : t("releaseStreams.graph.contribute"),
      waiting: (count) => t("releaseStreams.graph.waiting", { count }),
    }),
    [t],
  );
  const stableMissing = data.streams.find((stream) => stream.id === "stable")?.exists === false;

  return (
    <View style={styles.body}>
      {data.fetchError ? (
        <Notice text={t("releaseStreams.fetchFailed", { message: data.fetchError })} />
      ) : null}
      {stableMissing && data.config ? (
        <View style={styles.setup} testID="release-streams-setup">
          <Text style={styles.setupTitle}>{t("releaseStreams.setup.title")}</Text>
          <Text style={styles.muted}>
            {t("releaseStreams.setup.description", {
              development: data.config.development,
              stable: data.config.stable,
            })}
          </Text>
          <CommandLine command="npm run streams -- init --push" />
        </View>
      ) : null}

      <View style={styles.cards}>
        {streams.map((stream) => (
          <StreamCard key={stream.id} stream={stream} />
        ))}
      </View>

      {layout.lanes.length > 0 ? (
        <View style={styles.graphFrame}>
          <StreamGraph layout={layout} labels={labels} />
          <Legend />
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>{t("releaseStreams.flows.title")}</Text>
      <FlowList data={data} />

      <ChangeList data={data} streams={streams} />
    </View>
  );
}

function StreamCard({ stream }: { stream: ReleaseStream }) {
  const { t } = useTranslation();
  const latest = stream.releases[0];
  const beta = stream.channel !== "stable";
  return (
    <View style={styles.card} testID={`release-stream-card-${stream.id}`}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {streamName(t, stream.id)}
        </Text>
        <View
          style={[styles.channelPill, beta ? styles.channelPillBeta : styles.channelPillStable]}
        >
          <Text style={[styles.channelPillText, beta ? styles.channelPillTextBeta : null]}>
            {t(`releaseStreams.channel.${beta ? "beta" : "stable"}`)}
          </Text>
        </View>
      </View>
      <Text style={styles.mono} numberOfLines={1}>
        {stream.label}
      </Text>
      <Text style={styles.cardVersion}>{stream.version ?? "—"}</Text>
      <Text style={styles.muted} numberOfLines={1}>
        {!stream.exists
          ? t("releaseStreams.card.missing")
          : latest
            ? t("releaseStreams.card.latest", {
                version: latest.version,
                time: latest.date ? formatTimeAgo(new Date(latest.date)) : "",
              })
            : t("releaseStreams.card.noRelease")}
      </Text>
      {stream.exists && stream.unreleased > 0 ? (
        <Text style={styles.muted}>
          {t("releaseStreams.card.unreleased", { count: stream.unreleased })}
        </Text>
      ) : null}
    </View>
  );
}

function Legend() {
  const { t } = useTranslation();
  const items: Array<[string, object]> = [
    [t("releaseStreams.legend.release"), styles.legendRelease],
    [t("releaseStreams.legend.tip"), styles.legendTip],
    [t("releaseStreams.legend.promote"), styles.legendPromote],
    [t("releaseStreams.legend.backport"), styles.legendBackport],
    [t("releaseStreams.legend.sync"), styles.legendSync],
    [t("releaseStreams.legend.waiting"), styles.legendWaiting],
  ];
  return (
    <View style={styles.legend}>
      {items.map(([label, swatch]) => (
        <View key={label} style={styles.legendItem}>
          <View style={swatch} />
          <Text style={styles.legendText}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

function FlowList({ data }: { data: StreamsGraphPayload }) {
  const { t } = useTranslation();
  const flows = data.flows.filter((flow) => flow.pending > 0);
  if (flows.length === 0) {
    return <Text style={[styles.muted, styles.padded]}>{t("releaseStreams.flows.none")}</Text>;
  }
  return (
    <View style={styles.flows}>
      {flows.map((flow) => (
        <FlowCard key={`${flow.kind}:${flow.from}:${flow.to}`} flow={flow} data={data} />
      ))}
    </View>
  );
}

const FLOW_KINDS = new Set(["promote", "forward-port", "sync", "contribute"]);

function FlowCard({ flow, data }: { flow: ReleaseStreamFlow; data: StreamsGraphPayload }) {
  const { t } = useTranslation();
  const kind = FLOW_KINDS.has(flow.kind) ? flow.kind : "promote";
  const key = kind === "forward-port" ? "forwardPort" : kind;
  const counts = summarizeFlow(flow, data.changes);
  const warn = kind === "forward-port";
  const branch =
    flow.kind === "promote" || flow.kind === "forward-port"
      ? data.config?.stable
      : data.config?.development;
  return (
    <View
      style={[styles.flowCard, warn ? styles.flowCardWarn : null]}
      testID={`release-streams-flow-${flow.kind}`}
    >
      <View style={styles.flowHeader}>
        {warn ? <ThemedWarning size={ICON_SIZE.sm} uniProps={warningColorMapping} /> : null}
        <Text style={styles.flowTitle}>
          {t(`releaseStreams.flows.${key}.title`, {
            from: streamName(t, flow.from),
            to: streamName(t, flow.to),
          })}
        </Text>
        <Text style={styles.flowCount}>
          {t("releaseStreams.flows.pending", { count: flow.pending })}
        </Text>
      </View>
      <Text style={styles.muted}>{t(`releaseStreams.flows.${key}.description`)}</Text>
      <Text style={styles.muted}>{t("releaseStreams.flows.counts", counts)}</Text>
      {flow.command ? (
        <>
          {branch && flow.kind !== "forward-port" && flow.kind !== "contribute" ? (
            <Text style={styles.mutedSmall}>{t("releaseStreams.flows.runOn", { branch })}</Text>
          ) : null}
          <CommandLine command={flow.command} />
        </>
      ) : null}
    </View>
  );
}

function CommandLine({ command }: { command: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void copyToClipboard(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [command]);
  return (
    <View style={styles.command}>
      <Text style={styles.commandText} selectable numberOfLines={2}>
        {command}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          copied ? t("releaseStreams.flows.copied") : t("releaseStreams.flows.copy")
        }
        onPress={copy}
        hitSlop={8}
        style={iconButtonStyle}
      >
        {copied ? (
          <ThemedCheck size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
        ) : (
          <ThemedCopy size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
        )}
      </Pressable>
    </View>
  );
}

function ChangeList({ data, streams }: { data: StreamsGraphPayload; streams: ReleaseStream[] }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<ChangeFilter>("all");
  const [query, setQuery] = useState("");
  const visible = useMemo(
    () => filterChanges(data.changes, filter, query),
    [data.changes, filter, query],
  );
  const options = useMemo(
    () =>
      (["all", "features", "fixes", "waiting"] as const).map((value) => ({
        value,
        label: t(`releaseStreams.changes.filter.${value}`),
        testID: `release-streams-filter-${value}`,
      })),
    [t],
  );
  const columns = streams.filter((stream) => stream.exists || stream.releases.length > 0);
  return (
    <View>
      <Text style={styles.sectionTitle}>{t("releaseStreams.changes.title")}</Text>
      <View style={styles.changeControls}>
        <SegmentedControl size="sm" value={filter} onValueChange={setFilter} options={options} />
        <View style={styles.search}>
          <SearchInput placeholder={t("releaseStreams.changes.search")} onChangeText={setQuery} />
        </View>
      </View>
      {visible.length === 0 ? (
        <Text style={[styles.muted, styles.padded]}>{t("releaseStreams.changes.empty")}</Text>
      ) : (
        visible.map((change) => (
          <ChangeRow key={`${change.origin}:${change.sha}`} change={change} columns={columns} />
        ))
      )}
      {data.truncated ? (
        <Text style={[styles.mutedSmall, styles.padded]}>
          {t("releaseStreams.changes.truncated", { count: data.changes.length })}
        </Text>
      ) : null}
    </View>
  );
}

function ChangeRow({ change, columns }: { change: ReleaseStreamChange; columns: ReleaseStream[] }) {
  const { t } = useTranslation();
  const typeStyle =
    change.type === "feat"
      ? styles.typeFeat
      : change.type === "fix" || change.type === "perf"
        ? styles.typeFix
        : styles.typeOther;
  return (
    <View style={styles.changeRow} testID="release-streams-change">
      <View style={styles.changeHeader}>
        <View style={[styles.typeBadge, typeStyle]}>
          <Text style={styles.typeText}>{change.type}</Text>
        </View>
        <Text style={styles.changeSubject} numberOfLines={2}>
          {change.subject}
        </Text>
        <Text style={styles.mono}>{change.sha.slice(0, 7)}</Text>
      </View>
      {change.origin !== "development" ? (
        <Text style={styles.mutedSmall}>
          {t("releaseStreams.changes.origin", { stream: streamName(t, change.origin) })}
        </Text>
      ) : null}
      <View style={styles.presenceRow}>
        {columns.map((stream) => {
          const entry = change.presence.find((p) => p.stream === stream.id);
          const stateName = normalizePresenceState(entry?.state ?? "absent");
          const via =
            entry?.via && entry.via !== "commit"
              ? t(`releaseStreams.presence.via.${entry.via}`, { defaultValue: entry.via })
              : null;
          const text =
            stateName === "shipped"
              ? (entry?.release ?? t("releaseStreams.presence.released"))
              : t(`releaseStreams.presence.${stateName}`);
          return (
            <View key={stream.id} style={[styles.presence, presenceStyles[stateName]]}>
              <Text style={styles.presenceStream} numberOfLines={1}>
                {streamName(t, stream.id)}
              </Text>
              <Text style={[styles.presenceText, presenceTextStyles[stateName]]} numberOfLines={1}>
                {text}
                {via ? ` · ${via}` : ""}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <View style={styles.notice}>
      <ThemedWarning size={ICON_SIZE.sm} uniProps={warningColorMapping} />
      <Text style={styles.noticeText}>{text}</Text>
    </View>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDescription}>{description}</Text>
    </View>
  );
}

function iconButtonStyle({ hovered }: { hovered?: boolean }) {
  return [styles.iconButton, hovered ? styles.iconButtonHover : null];
}

const SWATCH = { width: 10, height: 10, borderRadius: 5 } as const;
const LINE_SWATCH = { width: 14, height: 0, borderTopWidth: 2 } as const;

const styles = StyleSheet.create((theme) => ({
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: theme.spacing[6] },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[3],
  },
  toolbarText: { flexShrink: 1, fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  toolbarActions: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  iconButton: { padding: theme.spacing[1], borderRadius: theme.borderRadius.base },
  iconButtonHover: { backgroundColor: theme.colors.surface2 },
  body: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    gap: theme.spacing[3],
  },
  loading: { padding: theme.spacing[6], alignItems: "center" },
  padded: { paddingVertical: theme.spacing[2] },
  muted: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  mutedSmall: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundExtraMuted },
  mono: {
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foregroundMuted,
  },
  sectionTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    marginTop: theme.spacing[2],
  },
  setup: {
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface1,
  },
  setupTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  card: {
    flexGrow: 1,
    flexBasis: 180,
    minWidth: 160,
    gap: 2,
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  cardTitle: {
    flexShrink: 1,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  cardVersion: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    fontVariant: ["tabular-nums"],
    marginVertical: 2,
  },
  channelPill: {
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 1,
  },
  channelPillStable: { backgroundColor: theme.colors.surface3 },
  channelPillBeta: { backgroundColor: theme.colors.palette.amber[500] },
  channelPillText: { fontSize: theme.fontSize.sm, color: theme.colors.foreground },
  channelPillTextBeta: { color: theme.colors.palette.zinc[900] },
  graphFrame: {
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[2],
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  legendText: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  legendRelease: { ...SWATCH, backgroundColor: theme.colors.statusSuccess },
  legendTip: { ...SWATCH, borderWidth: 2, borderColor: theme.colors.foregroundMuted },
  legendPromote: { ...LINE_SWATCH, borderTopColor: theme.colors.statusSuccess },
  legendBackport: {
    ...LINE_SWATCH,
    borderTopColor: theme.colors.statusWarning,
    borderStyle: "dashed",
  },
  legendSync: { ...LINE_SWATCH, borderTopColor: theme.colors.statusMerged },
  legendWaiting: {
    ...LINE_SWATCH,
    borderTopColor: theme.colors.foregroundMuted,
    borderStyle: "dotted",
  },
  flows: { gap: theme.spacing[2] },
  flowCard: {
    gap: theme.spacing[1],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  flowCardWarn: { borderColor: theme.colors.statusWarning },
  flowHeader: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  flowTitle: {
    flex: 1,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  flowCount: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
  command: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
    paddingLeft: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  commandText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foreground,
  },
  changeControls: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
    marginVertical: theme.spacing[2],
  },
  search: { flexGrow: 1, flexBasis: 200 },
  changeRow: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  changeHeader: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  changeSubject: { flex: 1, fontSize: theme.fontSize.base, color: theme.colors.foreground },
  typeBadge: { borderRadius: theme.borderRadius.base, paddingHorizontal: 6, paddingVertical: 1 },
  typeFeat: { backgroundColor: theme.colors.statusMerged },
  typeFix: { backgroundColor: theme.colors.statusWarning },
  typeOther: { backgroundColor: theme.colors.surface3 },
  typeText: {
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.surface0,
  },
  presenceRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[1] },
  presence: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 1,
  },
  presenceStream: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  presenceText: { fontSize: theme.fontSize.sm, fontVariant: ["tabular-nums"] },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  noticeText: { flex: 1, fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  emptyTitle: { color: theme.colors.foreground },
  emptyDescription: { color: theme.colors.foregroundMuted, textAlign: "center" },
}));

const presenceStyles = StyleSheet.create((theme) => ({
  shipped: { borderColor: theme.colors.statusSuccess },
  landed: { borderColor: theme.colors.statusDotRunning },
  pending: { borderColor: theme.colors.statusWarning, borderStyle: "dashed" },
  absent: { borderColor: theme.colors.border },
}));

const presenceTextStyles = StyleSheet.create((theme) => ({
  shipped: { color: theme.colors.statusSuccess },
  landed: { color: theme.colors.statusDotRunning },
  pending: { color: theme.colors.statusWarning },
  absent: { color: theme.colors.foregroundExtraMuted },
}));
