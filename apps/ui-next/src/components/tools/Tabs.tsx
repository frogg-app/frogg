import { useCallback, useMemo } from "react";
import { Animated, Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { color, glide, web } from "../../theme/tokens";
import { useGlide } from "../Glide";
import { T } from "../Text";

/**
 * Underlined panel tabs with an optional count, as in the round-4 tool panels. One shared
 * underline slides and resizes to the picked tab; label colour crossfades alongside it.
 */
export function Tabs<V extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ id: V; label: string; count?: number | null }>;
  value: V;
  onChange: (v: V) => void;
}) {
  const g = useGlide(value);
  const bar = useMemo(
    () => [s.bar, !g.ready && s.hidden, { left: g.left, width: g.width }],
    [g.ready, g.left, g.width],
  );
  return (
    <View style={s.row}>
      <Animated.View style={bar} pointerEvents="none" />
      {tabs.map((t) => (
        <Tab
          key={t.id}
          id={t.id}
          label={t.label}
          count={t.count}
          on={t.id === value}
          onPick={onChange}
          onMeasure={g.measure}
        />
      ))}
    </View>
  );
}

function Tab<V extends string>({
  id,
  label,
  count,
  on,
  onPick,
  onMeasure,
}: {
  id: V;
  label: string;
  count?: number | null;
  on: boolean;
  onPick: (v: V) => void;
  onMeasure: (id: V, e: LayoutChangeEvent) => void;
}) {
  const layout = useCallback((e: LayoutChangeEvent) => onMeasure(id, e), [onMeasure, id]);
  const accessibilityState = useMemo(() => ({ selected: on }), [on]);
  const press = useCallback(() => onPick(id), [onPick, id]);
  return (
    <Pressable
      onPress={press}
      onLayout={layout}
      accessibilityRole="tab"
      accessibilityState={accessibilityState}
    >
      {({ hovered }) => (
        <View style={s.tab}>
          <T style={[s.label, (on || hovered) && s.labelOn]}>{label}</T>
          {count != null && (
            <T v="mono" style={s.count}>
              {count}
            </T>
          )}
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  tab: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  bar: { position: "absolute", bottom: -1, height: 2, backgroundColor: color.cyan },
  hidden: { opacity: 0 },
  label: {
    fontSize: 13,
    color: color.muted,
    ...web({ transition: `color ${glide.ms}ms ease-out` }),
  },
  labelOn: { color: color.text },
  count: { fontSize: 10.5, color: color.faint },
});
