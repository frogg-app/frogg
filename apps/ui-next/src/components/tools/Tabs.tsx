import { useCallback, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { color } from "../../theme/tokens";
import { T } from "../Text";

/** Underlined panel tabs with an optional count, as in the round-4 tool panels. */
export function Tabs<V extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ id: V; label: string; count?: number | null }>;
  value: V;
  onChange: (v: V) => void;
}) {
  return (
    <View style={s.row}>
      {tabs.map((t) => (
        <Tab
          key={t.id}
          id={t.id}
          label={t.label}
          count={t.count}
          on={t.id === value}
          onPick={onChange}
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
}: {
  id: V;
  label: string;
  count?: number | null;
  on: boolean;
  onPick: (v: V) => void;
}) {
  const accessibilityState = useMemo(() => ({ selected: on }), [on]);
  const press = useCallback(() => onPick(id), [onPick, id]);
  return (
    <Pressable onPress={press} accessibilityRole="tab" accessibilityState={accessibilityState}>
      {({ hovered }) => (
        <View style={[s.tab, on && s.tabOn]}>
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
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    marginBottom: -1,
  },
  tabOn: { borderBottomColor: color.cyan },
  label: { fontSize: 13, color: color.muted },
  labelOn: { color: color.text },
  count: { fontSize: 10.5, color: color.faint },
});
