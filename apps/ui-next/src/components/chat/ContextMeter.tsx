import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import type { Agent } from "../../daemon/types";
import { color, web } from "../../theme/tokens";
import { toneFor } from "../Meter";
import { T } from "../Text";

const SIZE = 14;
const STROKE = 2;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

const ktok = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));

/** Context window fill for the session's last turn: a ring plus percentage, as in the stable app. */
export function ContextMeter({ agent }: { agent: Agent }) {
  const used = agent.lastUsage?.contextWindowUsedTokens;
  const max = agent.lastUsage?.contextWindowMaxTokens;
  const pct = useMemo(
    () => (used !== undefined && max ? Math.min(100, (used / max) * 100) : null),
    [used, max],
  );
  if (pct === null || used === undefined || !max) return null;
  const tone = toneFor(pct);
  const label = `Context ${Math.round(pct)}% · ${ktok(used)} of ${ktok(max)} tokens`;
  return (
    <View style={s.wrap} accessibilityLabel={label} {...web({ title: label })}>
      <Svg width={SIZE} height={SIZE}>
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          stroke={color.line2}
          strokeWidth={STROKE}
          fill="none"
        />
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          stroke={tone}
          strokeWidth={STROKE}
          fill="none"
          strokeDasharray={`${CIRC}`}
          strokeDashoffset={CIRC * (1 - pct / 100)}
          strokeLinecap="round"
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </Svg>
      <T v="mono" style={[s.pct, pct >= 70 && { color: tone }]}>
        {Math.round(pct)}%
      </T>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  pct: { fontSize: 11, color: color.faint },
});
