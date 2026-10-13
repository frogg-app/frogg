import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { anim, color, frames, web } from "../theme/tokens";

/** Bar widths that read as a list of names, cycled per row. */
const WIDTHS = [62, 44, 78, 52, 68, 38];

/**
 * Loading placeholder rows: an icon chip and a name bar per row, a soft highlight sweeping
 * across them (web; native shows the still bars). Rows fade in on a short stagger so a fast
 * load never flashes a full block.
 */
export function SkeletonRows({
  rows = 4,
  indent = 0,
  icon = true,
}: {
  rows?: number;
  indent?: number;
  icon?: boolean;
}) {
  const pad = useMemo(() => ({ paddingLeft: indent }), [indent]);
  const keys = useMemo(() => Array.from({ length: rows }, (_, i) => `sk${i}`), [rows]);
  return (
    <View style={pad} accessibilityLabel="Loading" accessibilityRole="progressbar">
      {keys.map((k, i) => (
        <SkeletonRow key={k} i={i} icon={icon} />
      ))}
    </View>
  );
}

function SkeletonRow({ i, icon }: { i: number; icon: boolean }) {
  const bar = useMemo(
    () => [s.bar, s.sweep, { width: `${WIDTHS[i % WIDTHS.length]}%` as const }],
    [i],
  );
  const row = useMemo(() => [s.row, web({ animationDelay: `${i * 45}ms` })], [i]);
  return (
    <View style={row}>
      {icon && <View style={[s.chip, s.sweep]} />}
      <View style={bar} />
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    ...anim(frames.fade, "240ms", "ease-out"),
  },
  chip: { width: 12, height: 12, borderRadius: 2, backgroundColor: color.wash2 },
  bar: { height: 9, borderRadius: 2, backgroundColor: color.wash2 },
  sweep: {
    ...web({
      backgroundImage: `linear-gradient(90deg, ${color.wash2} 0%, ${color.wash2} 35%, ${color.wash3} 50%, ${color.wash2} 65%, ${color.wash2} 100%)`,
      backgroundSize: "200% 100%",
      backgroundAttachment: "fixed",
    }),
    ...anim(frames.shimmer, "1.6s", "linear", "infinite", "none"),
  },
});
