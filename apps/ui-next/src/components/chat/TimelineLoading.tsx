import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { anim, color, frames, motion, web } from "../../theme/tokens";
import { StatusGlyph } from "../StatusGlyph";
import { T } from "../Text";

/** Reply line widths, so the placeholder reads as a paragraph rather than a block. */
const LINES = [92, 84, 63];

/**
 * A timeline still on its way: the shape of a conversation (a prompt, a reply, a tool row) under
 * a soft sweep, and one line saying whether the host is still connecting or the conversation is
 * loading. Everything fades in after a beat, so a fast load never flashes it (web; native shows
 * the still shapes).
 */
export function TimelineLoading({
  connecting = false,
  label,
}: {
  connecting?: boolean;
  /** Overrides the status line ("Loading subagent activity"). */
  label?: string;
}) {
  const text = label ?? (connecting ? "Connecting to host" : "Loading conversation");
  return (
    <View style={s.root} accessibilityRole="progressbar" accessibilityLabel={text}>
      <View style={s.d0}>
        <View style={[s.user, s.sweep]} />
      </View>
      <View style={[s.reply, s.d1]}>
        <View style={s.who}>
          <View style={s.diamond} />
          <View style={[s.name, s.sweep]} />
        </View>
        {LINES.map((w) => (
          <Line key={w} w={w} />
        ))}
      </View>
      <View style={[s.tool, s.d2]}>
        <View style={[s.toolIcon, s.sweep]} />
        <View style={[s.toolBar, s.sweep]} />
      </View>
      <View style={[s.status, s.d3]}>
        <StatusGlyph bucket={connecting ? "needs" : "working"} size={7} />
        <T v="mono" style={connecting ? s.waiting : s.shimmer}>
          {`${text}…`}
        </T>
      </View>
    </View>
  );
}

function Line({ w }: { w: number }) {
  const st = useMemo(() => [s.line, s.sweep, { width: `${w}%` as const }], [w]);
  return <View style={st} />;
}

const sweep = `linear-gradient(90deg, ${color.wash2} 0%, ${color.wash2} 35%, ${color.wash3} 50%, ${color.wash2} 65%, ${color.wash2} 100%)`;
const enter = (delay: number) => ({
  ...anim(frames.enter, "260ms"),
  ...web({ animationDelay: `${delay}ms` }),
});

const s = StyleSheet.create({
  root: { paddingTop: 4 },
  sweep: {
    ...web({ backgroundImage: sweep, backgroundSize: "200% 100%", backgroundAttachment: "fixed" }),
    ...anim(frames.shimmer, "1.6s", "linear", "infinite", "none"),
  },
  // Staggered entrances, all after a short hold so a quick load shows nothing at all.
  d0: enter(180),
  d1: enter(230),
  d2: enter(280),
  d3: enter(330),
  user: {
    alignSelf: "flex-end",
    width: "46%",
    height: 40,
    marginTop: 14,
    backgroundColor: color.wash2,
    borderLeftWidth: 2,
    borderLeftColor: color.line2,
  },
  reply: { marginTop: 18, gap: 8 },
  who: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  diamond: {
    width: 6,
    height: 6,
    backgroundColor: color.line2,
    transform: [{ rotate: "45deg" }],
  },
  name: { width: 72, height: 9, backgroundColor: color.wash2 },
  line: { height: 10, backgroundColor: color.wash2 },
  tool: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.panel,
  },
  toolIcon: { width: 12, height: 12, backgroundColor: color.wash2 },
  toolBar: { width: "38%", height: 9, backgroundColor: color.wash2 },
  status: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 18 },
  waiting: { fontSize: 12.5, color: color.amber, ...motion.breathe },
  shimmer: { fontSize: 12.5, ...motion.shimmerText, ...motion.shimmerRun },
});
