import { ChevronRight } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { getClient } from "../../daemon/store";
import { anim, color, ease, frames, web } from "../../theme/tokens";
import { Num } from "../CountUp";
import { SkeletonRows } from "../Skeleton";
import { Brackets, BracketScope } from "../Brackets";
import { T } from "../Text";

type Client = NonNullable<ReturnType<typeof getClient>>;
export type Graph = Awaited<ReturnType<Client["checkoutStreamsGetGraph"]>>;
type Stream = Graph["streams"][number];
type Change = Graph["changes"][number];

/** Load the release-streams graph for a checkout. */
export function useStreams(cwd: string | null, active: boolean) {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    const client = getClient();
    if (!cwd || !client) return;
    client.checkoutStreamsGetGraph(cwd).then(
      (g) => {
        setGraph(g);
        setError(g.error?.message ?? null);
        return undefined;
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [cwd]);
  useEffect(() => {
    if (active) load();
  }, [active, load]);
  return { graph, error, load };
}

const DOT: Record<string, string> = {
  development: color.cyan,
  stable: color.mint,
  feature: color.violet,
};

/** Bars and their counts share one glide. */
const BAR_MS = 420;

/** The Streams tab: one row per stream with what is waiting on it; tap to list those changes. */
export function StreamList({ graph, error }: { graph: Graph | null; error: string | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const max = useMemo(
    () => Math.max(1, ...(graph?.streams ?? []).map((x) => x.unreleased)),
    [graph],
  );
  if (error)
    return (
      <T v="mono" style={s.error}>
        {error}
      </T>
    );
  if (!graph) return <SkeletonRows rows={4} />;
  if (!graph.streams.length)
    return <T style={[s.pad, s.muted]}>No release streams for this repository.</T>;
  return (
    <BracketScope>
      {graph.streams.map((st, i) => (
        <StreamRow
          key={st.id}
          st={st}
          i={i}
          max={max}
          graph={graph}
          on={open === st.id}
          onToggle={setOpen}
        />
      ))}
      {graph.config && !graph.config.declared && (
        <T v="mono" style={s.foot}>
          default streams · declare them in frogg.json
        </T>
      )}
    </BracketScope>
  );
}

function waitingOn(graph: Graph, id: string): Change[] {
  return graph.changes.filter((c) =>
    c.presence.some((p) => p.stream === id && (p.state === "landed" || p.state === "pending")),
  );
}

const OPEN = { expanded: true };
const SHUT = { expanded: false };
const expanded = (on: boolean) => (on ? OPEN : SHUT);

function countLabel(st: Stream, graph: Graph): string {
  if (!st.exists) return "missing";
  if (st.kind !== "feature") return "waiting";
  const behind = graph.flows.find((f) => f.to === st.id && f.kind === "sync")?.pending ?? 0;
  return behind ? `ahead · ${behind} behind` : "ahead";
}

function StreamRow({
  st,
  i,
  max,
  graph,
  on,
  onToggle,
}: {
  st: Stream;
  i: number;
  max: number;
  graph: Graph;
  on: boolean;
  onToggle: (id: string | null) => void;
}) {
  const press = useCallback(() => onToggle(on ? null : st.id), [on, onToggle, st.id]);
  const waiting = useMemo(() => waitingOn(graph, st.id), [graph, st.id]);
  const tint = DOT[st.kind] ?? (st.channel === "stable" ? color.mint : color.cyan);
  const dot = useMemo(() => [s.dot, { backgroundColor: tint }], [tint]);
  const fill = useMemo(
    () => [s.fill, { backgroundColor: tint, width: `${(st.unreleased / max) * 100}%` as const }],
    [tint, st.unreleased, max],
  );
  const enter = useMemo(() => [s.enter, web({ animationDelay: `${i * 40}ms` })], [i]);
  const flows = graph.flows.filter((f) => f.from === st.id && f.pending > 0);
  const tag = st.releases[0]?.tag;
  return (
    <View style={enter}>
      <Pressable onPress={press} disabled={!st.exists} accessibilityState={expanded(on)}>
        {({ hovered }) => (
          <View style={[s.row, hovered && s.hover, on && s.rowOn]}>
            <Brackets on={on} />
            <View style={[s.chev, on && s.chevOpen]}>
              <ChevronRight size={12} color={hovered || on ? color.muted : color.faint} />
            </View>
            <View style={dot} />
            <View style={s.main}>
              <View style={s.line}>
                <T numberOfLines={1} style={[s.name, !st.exists && s.muted, on && s.nameOn]}>
                  {st.label}
                </T>
                {tag && (
                  <T v="mono" style={s.tag}>
                    {tag}
                  </T>
                )}
              </View>
              <View style={s.track}>
                <View style={fill} />
              </View>
            </View>
            <View style={s.countBox}>
              {st.exists && <Num value={st.unreleased} duration={BAR_MS} style={s.num} />}
              <T v="mono" style={s.count}>
                {countLabel(st, graph)}
              </T>
            </View>
          </View>
        )}
      </Pressable>
      {on && (
        <View style={s.changes}>
          {flows.map((f) => (
            <FlowRow key={`${f.from}>${f.to}:${f.kind}`} f={f} />
          ))}
          {waiting.length === 0 && <T style={s.muted}>Nothing waiting.</T>}
          {waiting.slice(0, 30).map((c, n) => (
            <ChangeRow key={c.sha} c={c} n={n} stream={st.id} />
          ))}
        </View>
      )}
    </View>
  );
}

function FlowRow({ f }: { f: Graph["flows"][number] }) {
  return (
    <View style={s.flowRow}>
      <T v="mono" style={s.flowKind}>
        {f.kind}
      </T>
      <T v="mono" numberOfLines={1} style={s.flow}>
        → {f.to} · {f.pending}
        {f.command ? ` · ${f.command}` : ""}
      </T>
    </View>
  );
}

function ChangeRow({ c, n, stream }: { c: Change; n: number; stream: string }) {
  const here = c.presence.find((p) => p.stream === stream);
  const style = useMemo(
    () => [s.change, web({ animationDelay: `${Math.min(n, 10) * 22}ms` })],
    [n],
  );
  return (
    <Pressable>
      {({ hovered }) => (
        <View style={[style, hovered && s.changeHover]}>
          <View
            style={[
              s.diamond,
              here?.state === "pending" && s.diamondPending,
              c.presence.some((p) => p.state === "shipped") && s.diamondOn,
            ]}
          />
          <T numberOfLines={1} style={s.subject}>
            {c.subject}
          </T>
          {here?.via === "backport" && (
            <T v="mono" style={s.via}>
              backport
            </T>
          )}
          <T v="mono" style={s.sha}>
            {c.sha.slice(0, 7)}
          </T>
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  pad: { padding: 16 },
  muted: { color: color.muted },
  error: { color: color.coral, padding: 16 },
  foot: { padding: 16, fontSize: 10.5, color: color.faint },
  enter: anim(frames.enter, "220ms", ease),
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
    ...web({ transition: "background-color 120ms ease-out" }),
  },
  hover: { backgroundColor: color.wash },
  rowOn: { backgroundColor: color.cyanWash },
  chev: { width: 12, height: 12, ...web({ transition: `transform 180ms ${ease}` }) },
  chevOpen: { transform: [{ rotate: "90deg" }] },
  dot: { width: 8, height: 8, transform: [{ rotate: "45deg" }] },
  main: { flex: 1, gap: 6 },
  line: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  name: { flexShrink: 1, fontSize: 13, ...web({ transition: "color 120ms ease-out" }) },
  nameOn: { color: color.cyan2 },
  tag: { fontSize: 10, color: color.faint },
  track: { height: 2, backgroundColor: color.wash2, overflow: "hidden" },
  fill: { height: 2, ...web({ transition: `width ${BAR_MS}ms ${ease}` }) },
  countBox: { alignItems: "flex-end", minWidth: 64 },
  num: { fontSize: 13, color: color.text },
  count: { fontSize: 10, color: color.faint },
  changes: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    gap: 2,
    ...anim(frames.fade, "180ms", ease),
  },
  flowRow: { flexDirection: "row", gap: 8, paddingVertical: 3 },
  flowKind: { fontSize: 10.5, color: color.amber, minWidth: 74 },
  flow: { flex: 1, fontSize: 10.5, color: color.cyan2 },
  change: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 4,
    paddingHorizontal: 4,
    ...anim(frames.enter, "200ms", ease),
    ...web({ transition: "background-color 120ms ease-out" }),
  },
  changeHover: { backgroundColor: color.wash },
  diamond: {
    width: 7,
    height: 7,
    borderWidth: 1,
    borderColor: color.muted,
    transform: [{ rotate: "45deg" }],
  },
  diamondPending: { borderColor: color.amber },
  diamondOn: { backgroundColor: color.mint, borderColor: color.mint },
  subject: { flex: 1, fontSize: 12.5 },
  via: { fontSize: 10, color: color.violet },
  sha: { fontSize: 10.5, color: color.faint },
});
