import { SlidersHorizontal } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import type { Commit } from "../../daemon/scm";
import { prefSetter, usePrefs } from "../../prefs";
import { color, motion } from "../../theme/tokens";
import { ago } from "../../util";
import { GroupHead } from "../PanelHead";
import { Toggle } from "../settings/controls";
import { T } from "../Text";
import { Popover, useAnchor } from "../tools/Menu";

/** How many of the base branch's newest commits sit under the branch, to show where it forked. */
const BASE_CONTEXT = 5;

type Lane = "branch" | "base";
interface Row {
  c: Commit;
  lane: Lane;
  /** First and last row on its lane, for where the lane line starts and ends. */
  first: boolean;
  last: boolean;
}

function rowsFor(commits: Commit[], withBase: boolean): Row[] {
  const branch = commits.filter((c) => !c.isOnBase);
  const base = withBase ? commits.filter((c) => c.isOnBase).slice(0, BASE_CONTEXT) : [];
  return [
    ...branch.map((c, i) => ({
      c,
      lane: "branch" as const,
      first: i === 0,
      last: i === branch.length - 1,
    })),
    ...base.map((c, i) => ({ c, lane: "base" as const, first: i === 0, last: false })),
  ];
}

/**
 * The checkout's commits as a list with a branch graph as its left-most column: this branch's
 * commits on their own lane, joining the base branch's lane where it forked. The daemon lists
 * commits without parents, so the graph shows this fork, not merges inside either branch.
 */
export function CommitGraph({ commits, base }: { commits: Commit[] | null; base: string | null }) {
  const p = usePrefs();
  const rows = useMemo(() => rowsFor(commits ?? [], p.scmBaseCommits), [commits, p.scmBaseCommits]);
  const branchCount = rows.filter((r) => r.lane === "branch").length;
  if (!rows.length) return null;
  const hasBranch = branchCount > 0;
  return (
    <View>
      <GroupHead
        label={
          hasBranch ? `Commits not in ${base ?? "the base branch"}` : `Recent on ${base ?? "base"}`
        }
        count={hasBranch ? branchCount : undefined}
      />
      {rows.some((r) => !r.c.isOnRemote) && (
        <View style={s.legend}>
          <View style={[s.node, s.nodeLocal]} />
          <T v="mono" style={s.legendT}>
            not pushed yet
          </T>
          {hasBranch && p.scmBaseCommits && (
            <>
              <View style={[s.node, s.nodeBase]} />
              <T v="mono" style={s.legendT}>
                {base ?? "base"}
              </T>
            </>
          )}
        </View>
      )}
      {rows.map((r) => (
        <CommitLine key={r.c.sha} row={r} hasBranch={hasBranch} />
      ))}
    </View>
  );
}

function CommitLine({ row, hasBranch }: { row: Row; hasBranch: boolean }) {
  const p = usePrefs();
  const { c, lane } = row;
  return (
    <View style={[s.line, p.scmCompact && s.lineCompact, motion.enter]}>
      {p.scmGraph ? (
        <GraphCell row={row} hasBranch={hasBranch} />
      ) : (
        <View style={s.dotCell}>{!c.isOnRemote && <View style={[s.node, s.nodeLocal]} />}</View>
      )}
      {p.scmSha && (
        <T v="mono" style={[s.sha, lane === "base" && s.dim]}>
          {c.shortSha}
        </T>
      )}
      <T numberOfLines={1} style={[s.subject, lane === "base" && s.dim]}>
        {c.subject}
      </T>
      {p.scmAuthor && (
        <T v="mono" numberOfLines={1} style={s.author}>
          {c.authorName}
        </T>
      )}
      {p.scmDate && (
        <T v="mono" style={s.when}>
          {ago(c.authorDate)}
        </T>
      )}
    </View>
  );
}

const onlyOne = (first: boolean, last: boolean) => first && last;

/** One row of the two-lane graph: lane lines, the fork connector and the commit's node. */
function GraphCell({ row, hasBranch }: { row: Row; hasBranch: boolean }) {
  const { c, lane, first, last } = row;
  const solo = onlyOne(first, last);
  const onBranch = lane === "branch";
  let node: ViewStyle = s.nodePushed;
  if (!c.isOnRemote) node = s.nodeLocal;
  else if (!onBranch) node = s.nodeBase;
  return (
    <View style={[s.graph, !hasBranch && s.graphNarrow]}>
      {/* The base lane runs the full height; under the branch it is the line the branch forked from. */}
      {hasBranch && onBranch && <View style={[s.lane, s.laneBase, s.laneDim]} />}
      {!onBranch && <View style={[s.lane, s.laneBase]} />}
      {onBranch && !solo && (
        <View style={[s.lane, s.laneBranch, first && s.fromMid, last && s.toMid]} />
      )}
      {onBranch && solo && <View style={[s.lane, s.laneBranch, s.fromMid, s.toMid]} />}
      {onBranch && last && <View style={s.fork} />}
      <View style={[s.node, node, onBranch ? s.atBranch : s.atBase]} />
    </View>
  );
}

/** Top-right quick settings for the commit list: columns, density and layout. */
export function ScmQuickSettings({ base }: { base: string | null }) {
  const anchor = useAnchor();
  const p = usePrefs();
  return (
    <>
      <View ref={anchor.ref} collapsable={false}>
        <Pressable onPress={anchor.open} accessibilityLabel="Source control view settings">
          <SlidersHorizontal size={14} color={anchor.rect ? color.cyan2 : color.faint} />
        </Pressable>
      </View>
      <Popover rect={anchor.rect} onClose={anchor.close} right width={260}>
        <View style={s.quick}>
          <T v="label">Columns</T>
          <QuickRow label="Branch graph" value={p.scmGraph} on={prefSetter("scmGraph")} />
          <QuickRow label="Commit hash" value={p.scmSha} on={prefSetter("scmSha")} />
          <QuickRow label="Author" value={p.scmAuthor} on={prefSetter("scmAuthor")} />
          <QuickRow label="Age" value={p.scmDate} on={prefSetter("scmDate")} />
          <T v="label" style={s.quickHead}>
            Appearance
          </T>
          <QuickRow label="Compact rows" value={p.scmCompact} on={prefSetter("scmCompact")} />
          <T v="label" style={s.quickHead}>
            Layout
          </T>
          <QuickRow
            label={`Show ${base ?? "base"} under the branch`}
            value={p.scmBaseCommits}
            on={prefSetter("scmBaseCommits")}
          />
          <QuickRow label="Stashes" value={p.scmStashes} on={prefSetter("scmStashes")} />
        </View>
      </Popover>
    </>
  );
}

function QuickRow({
  label,
  value,
  on,
}: {
  label: string;
  value: boolean;
  on: (v: boolean) => void;
}) {
  return (
    <View style={s.quickRow}>
      <T style={s.quickLabel} numberOfLines={1}>
        {label}
      </T>
      <Toggle value={value} onChange={on} />
    </View>
  );
}

const LANE_BASE = 7;
const LANE_BRANCH = 19;
const NODE = 7;

const s = StyleSheet.create({
  legend: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  legendT: { fontSize: 10, color: color.faint, marginRight: 8 },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 8,
    paddingHorizontal: 8,
    minHeight: 30,
  },
  lineCompact: { minHeight: 22 },
  dotCell: { width: 6, alignItems: "center" },
  graph: { width: 26, alignSelf: "stretch" },
  graphNarrow: { width: 14 },
  lane: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: color.line2 },
  laneBase: { left: LANE_BASE },
  laneBranch: { left: LANE_BRANCH, backgroundColor: color.cyan },
  laneDim: { opacity: 0.5 },
  fromMid: { top: "50%" },
  // The last branch row's lane stops where the fork segment takes over.
  toMid: { bottom: LANE_BRANCH - LANE_BASE },
  // The branch leaves the base lane: a 45° segment from the branch lane down to the base lane.
  fork: {
    position: "absolute",
    width: 1,
    height: Math.SQRT2 * (LANE_BRANCH - LANE_BASE),
    left: (LANE_BASE + LANE_BRANCH) / 2,
    bottom: -((Math.SQRT2 - 1) * (LANE_BRANCH - LANE_BASE)) / 2,
    backgroundColor: color.cyan,
    transform: [{ rotate: "45deg" }],
  },
  node: { width: NODE, height: NODE, transform: [{ rotate: "45deg" }] },
  atBranch: { position: "absolute", top: "50%", marginTop: -NODE / 2, left: LANE_BRANCH - 3 },
  atBase: { position: "absolute", top: "50%", marginTop: -NODE / 2, left: LANE_BASE - 3 },
  nodePushed: { backgroundColor: color.cyan },
  nodeLocal: { backgroundColor: color.bg2, borderWidth: 1, borderColor: color.amber },
  nodeBase: { backgroundColor: color.faint },
  sha: { color: color.cyan2, fontSize: 11 },
  dim: { color: color.muted },
  subject: { flex: 1, fontSize: 12.5 },
  author: { fontSize: 10.5, color: color.faint, maxWidth: 90 },
  when: { fontSize: 10.5, color: color.faint, maxWidth: 70 },
  quick: { padding: 12, gap: 6 },
  quickHead: { marginTop: 8 },
  quickRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 30 },
  quickLabel: { flex: 1, fontSize: 12.5 },
});
