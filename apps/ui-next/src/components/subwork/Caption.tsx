import { useMemo, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { color } from "../../theme/tokens";
import { Num } from "../CountUp";
import { T } from "../Text";
import { Collapse } from "./Collapse";
import { usePulse } from "./views";

/**
 * "N sub-processes running" under the status legend. A secondary line: it never changes the five
 * status counts above it, and slides away when nothing runs.
 */
export function SubCaption({ n }: { n: number }) {
  const last = useRef(n);
  if (n > 0) last.current = n;
  const pulse = usePulse(n > 0);
  const mark = useMemo(() => [s.mark, { opacity: pulse }], [pulse]);
  const shown = n > 0 ? n : last.current;
  return (
    <Collapse open={n > 0}>
      <View style={s.row}>
        <Animated.View style={mark} />
        <Num value={shown} style={s.n} />
        <T style={s.t}>{shown === 1 ? "sub-process running" : "sub-processes running"}</T>
      </View>
    </Collapse>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  mark: { width: 6, height: 6, backgroundColor: color.cyan2, transform: [{ rotate: "45deg" }] },
  n: { fontSize: 11.5, color: color.cyan2 },
  t: { fontSize: 11.5, color: color.muted },
});
