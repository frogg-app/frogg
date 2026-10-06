import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { getClient } from "../../daemon/store";
import { color } from "../../theme/tokens";
import { Brackets } from "../SessionList";
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
};

/** The Streams tab: one row per stream with what is waiting on it; tap to list those changes. */
export function StreamList({ graph, error }: { graph: Graph | null; error: string | null }) {
  const [open, setOpen] = useState<string | null>(null);
  if (error)
    return (
      <T v="mono" style={s.error}>
        {error}
      </T>
    );
  if (!graph)
    return (
      <T v="label" style={s.pad}>
        loading…
      </T>
    );
  if (!graph.streams.length)
    return <T style={[s.pad, s.muted]}>No release streams for this repository.</T>;
  return (
    <>
      {graph.streams.map((st) => (
        <StreamRow key={st.id} st={st} graph={graph} on={open === st.id} onToggle={setOpen} />
      ))}
      {graph.config && !graph.config.declared && (
        <T v="mono" style={s.foot}>
          default streams · declare them in frogg.json
        </T>
      )}
    </>
  );
}

function waitingOn(graph: Graph, id: string): Change[] {
  return graph.changes.filter((c) =>
    c.presence.some((p) => p.stream === id && (p.state === "landed" || p.state === "pending")),
  );
}

function StreamRow({
  st,
  graph,
  on,
  onToggle,
}: {
  st: Stream;
  graph: Graph;
  on: boolean;
  onToggle: (id: string | null) => void;
}) {
  const press = useCallback(() => onToggle(on ? null : st.id), [on, onToggle, st.id]);
  const waiting = useMemo(() => waitingOn(graph, st.id), [graph, st.id]);
  const dot = useMemo(
    () => [
      s.dot,
      { backgroundColor: DOT[st.kind] ?? (st.channel === "stable" ? color.mint : color.cyan) },
    ],
    [st.kind, st.channel],
  );
  const flows = graph.flows.filter((f) => f.from === st.id && f.pending > 0);
  return (
    <>
      <Pressable onPress={press} disabled={!st.exists}>
        {({ hovered }) => (
          <View style={[s.row, hovered && s.hover, on && s.rowOn]}>
            {on && <Brackets />}
            <View style={dot} />
            <T numberOfLines={1} style={[s.name, !st.exists && s.muted]}>
              {st.label}
              {st.version ? ` · ${st.version}` : ""}
            </T>
            <T v="mono" style={s.count}>
              {st.exists ? `${st.unreleased} waiting` : "missing"}
            </T>
          </View>
        )}
      </Pressable>
      {on && (
        <View style={s.changes}>
          {flows.map((f) => (
            <T key={`${f.from}>${f.to}:${f.kind}`} v="mono" style={s.flow}>
              {f.kind} → {f.to}: {f.pending}
              {f.command ? ` · ${f.command}` : ""}
            </T>
          ))}
          {waiting.length === 0 && <T style={s.muted}>Nothing waiting.</T>}
          {waiting.slice(0, 30).map((c) => (
            <View key={c.sha} style={s.change}>
              <View
                style={[s.diamond, c.presence.some((p) => p.state === "shipped") && s.diamondOn]}
              />
              <T numberOfLines={1} style={s.subject}>
                {c.subject}
              </T>
              <T v="mono" style={s.sha}>
                {c.sha.slice(0, 4)}
              </T>
            </View>
          ))}
        </View>
      )}
    </>
  );
}

const s = StyleSheet.create({
  pad: { padding: 16 },
  muted: { color: color.muted },
  error: { color: color.coral, padding: 16 },
  foot: { padding: 16, fontSize: 10.5, color: color.faint },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 8,
    paddingHorizontal: 10,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  hover: { backgroundColor: color.wash },
  rowOn: { backgroundColor: "rgba(127,217,230,0.05)" },
  dot: { width: 8, height: 8, transform: [{ rotate: "45deg" }] },
  name: { flex: 1, fontSize: 13 },
  count: { fontSize: 10.5, color: color.faint },
  changes: { paddingHorizontal: 18, paddingVertical: 8, gap: 6 },
  flow: { fontSize: 10.5, color: color.cyan2 },
  change: { flexDirection: "row", alignItems: "center", gap: 10 },
  diamond: {
    width: 7,
    height: 7,
    borderWidth: 1,
    borderColor: color.muted,
    transform: [{ rotate: "45deg" }],
  },
  diamondOn: { backgroundColor: color.mint, borderColor: color.mint },
  subject: { flex: 1, fontSize: 12.5 },
  sha: { fontSize: 10.5, color: color.faint },
});
