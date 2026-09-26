import type {
  CheckoutStreamsGetGraphResponse,
  ReleaseStream,
  ReleaseStreamChange,
  ReleaseStreamEvent,
  ReleaseStreamFlow,
} from "@frogg/protocol/messages";

export type StreamsGraphPayload = CheckoutStreamsGetGraphResponse["payload"];
export type PresenceState = "shipped" | "landed" | "pending" | "absent";
export type ChangeFilter = "all" | "features" | "fixes" | "waiting";

/** Most stable at the top, as in a Perforce stream graph; upstream above the fork's own. */
const STREAM_ORDER = ["upstream-stable", "upstream-development", "stable", "development"];

export function orderStreams(streams: readonly ReleaseStream[]): ReleaseStream[] {
  const rank = (id: string) => {
    const index = STREAM_ORDER.indexOf(id);
    return index === -1 ? STREAM_ORDER.length : index;
  };
  return [...streams].sort((a, b) => rank(a.id) - rank(b.id));
}

/** Wire states are open strings; anything unknown reads as absent. */
export function normalizePresenceState(value: string): PresenceState {
  return value === "shipped" || value === "landed" || value === "pending" ? value : "absent";
}

export function isFeature(change: ReleaseStreamChange): boolean {
  return change.type === "feat";
}

export function isFix(change: ReleaseStreamChange): boolean {
  return change.type === "fix" || change.type === "perf";
}

export function presenceOn(change: ReleaseStreamChange, stream: string) {
  return change.presence.find((entry) => entry.stream === stream) ?? null;
}

/** Still travelling: somewhere it is expected to reach but has not. */
export function isWaiting(change: ReleaseStreamChange): boolean {
  return change.presence.some((entry) => normalizePresenceState(entry.state) === "pending");
}

export function filterChanges(
  changes: readonly ReleaseStreamChange[],
  filter: ChangeFilter,
  query: string,
): ReleaseStreamChange[] {
  const needle = query.trim().toLowerCase();
  return changes.filter((change) => {
    if (filter === "features" && !isFeature(change)) return false;
    if (filter === "fixes" && !isFix(change)) return false;
    if (filter === "waiting" && !isWaiting(change)) return false;
    if (!needle) return true;
    return (
      change.subject.toLowerCase().includes(needle) ||
      change.sha.startsWith(needle) ||
      (change.scope?.toLowerCase().includes(needle) ?? false)
    );
  });
}

/** Features and fixes waiting on a flow, for its summary line. */
export function summarizeFlow(
  flow: ReleaseStreamFlow,
  changes: readonly ReleaseStreamChange[],
): { features: number; fixes: number; other: number } {
  const moving = changes.filter((change) => {
    if (flow.kind === "forward-port") {
      return change.origin === flow.from && presenceOn(change, flow.to)?.state === "absent";
    }
    if (flow.kind === "contribute") {
      return change.origin === flow.from && presenceOn(change, flow.to)?.state === "absent";
    }
    return (
      normalizePresenceState(presenceOn(change, flow.to)?.state ?? "") === "pending" &&
      normalizePresenceState(presenceOn(change, flow.from)?.state ?? "") !== "absent"
    );
  });
  const features = moving.filter(isFeature).length;
  const fixes = moving.filter(isFix).length;
  return { features, fixes, other: moving.length - features - fixes };
}

// ---------------------------------------------------------------------------------------------
// Graph layout: lanes top to bottom, one column per release in time order, connectors between.

export interface GraphNode {
  key: string;
  stream: string;
  lane: number;
  column: number;
  version: string | null;
  tag: string | null;
  date: string | null;
  /** The branch tip: commits not yet in a release. */
  head: boolean;
  unreleased: number;
}

export interface GraphEdge {
  key: string;
  kind: string;
  from: GraphNode;
  to: GraphNode;
  /** Changes carried, when the event counts them (backports). */
  count: number;
}

export interface GraphLane {
  stream: ReleaseStream;
  index: number;
  firstColumn: number;
  lastColumn: number;
}

export interface PendingArrow {
  flow: ReleaseStreamFlow;
  from: GraphNode;
  to: GraphNode;
}

export interface StreamGraphLayout {
  lanes: GraphLane[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  pending: PendingArrow[];
  columns: number;
}

/** Releases drawn per lane; the full list is in the stream's card. */
export const RELEASES_PER_LANE = 8;

function time(date: string | null): number {
  const parsed = date ? Date.parse(date) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function layoutStreamGraph(input: {
  streams: readonly ReleaseStream[];
  events: readonly ReleaseStreamEvent[];
  flows: readonly ReleaseStreamFlow[];
}): StreamGraphLayout {
  const ordered = orderStreams(input.streams).filter(
    (stream) => stream.exists || stream.releases.length > 0,
  );
  const points: Array<Omit<GraphNode, "column">> = [];
  ordered.forEach((stream, lane) => {
    const releases = stream.releases.slice(0, RELEASES_PER_LANE).reverse();
    for (const release of releases) {
      points.push({
        key: `${stream.id}:${release.tag}`,
        stream: stream.id,
        lane,
        version: release.version,
        tag: release.tag,
        date: release.date,
        head: false,
        unreleased: 0,
      });
    }
  });
  // Columns follow release time; the heads share a final column so "now" lines up.
  const sorted = [...points].sort((a, b) => time(a.date) - time(b.date) || a.lane - b.lane);
  const nodes: GraphNode[] = [];
  let column = -1;
  let lastTime = Number.NaN;
  const occupied = new Set<string>();
  for (const point of sorted) {
    const at = time(point.date);
    // Same instant on another lane may share a column; the same lane never does.
    if (at !== lastTime || occupied.has(`${column}:${point.lane}`)) {
      column += 1;
      lastTime = at;
    }
    occupied.add(`${column}:${point.lane}`);
    nodes.push({ ...point, column });
  }
  const headColumn = column + 1;
  ordered.forEach((stream, lane) => {
    if (!stream.exists) return;
    nodes.push({
      key: `${stream.id}:head`,
      stream: stream.id,
      lane,
      column: headColumn,
      version: stream.version,
      tag: null,
      date: stream.headDate,
      head: true,
      unreleased: stream.unreleased,
    });
  });

  const byVersion = new Map<string, GraphNode>();
  const heads = new Map<string, GraphNode>();
  for (const node of nodes) {
    if (node.head) heads.set(node.stream, node);
    else if (node.version) byVersion.set(`${node.stream}:${node.version}`, node);
  }
  const resolve = (stream: string, version: string | null, fallbackColumn: number | null) => {
    if (version) {
      const found = byVersion.get(`${stream}:${version}`);
      if (found) return found;
    }
    if (fallbackColumn === null) return heads.get(stream) ?? null;
    const lane = ordered.findIndex((entry) => entry.id === stream);
    if (lane === -1) return null;
    // An anchor on the lane with no release of its own: where the change left from.
    return {
      key: `${stream}:anchor:${fallbackColumn}`,
      stream,
      lane,
      column: fallbackColumn,
      version: null,
      tag: null,
      date: null,
      head: false,
      unreleased: 0,
    } satisfies GraphNode;
  };

  const edges: GraphEdge[] = [];
  for (const event of input.events) {
    const to = resolve(event.to, event.toRelease, null);
    if (!to) continue;
    // A backport or contribution leaves from the source lane just before it lands.
    const from = resolve(event.from, event.fromRelease, Math.max(0, to.column - 1));
    if (!from || from.key === to.key) continue;
    edges.push({
      key: `${event.kind}:${event.sha}`,
      kind: event.kind,
      from,
      to,
      count: event.count,
    });
  }

  const pending: PendingArrow[] = [];
  for (const flow of input.flows) {
    if (flow.pending <= 0) continue;
    const from = heads.get(flow.from);
    const to = heads.get(flow.to);
    if (from && to) pending.push({ flow, from, to });
  }

  const lanes: GraphLane[] = ordered.map((stream, index) => {
    const columns = nodes.filter((node) => node.lane === index).map((node) => node.column);
    return {
      stream,
      index,
      firstColumn: columns.length ? Math.min(...columns) : headColumn,
      lastColumn: columns.length ? Math.max(...columns) : headColumn,
    };
  });

  return { lanes, nodes, edges, pending, columns: headColumn + 1 };
}
