import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { color } from "../theme/tokens";
import { T } from "./Text";

export function PanelHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={s.head}>
      <T v="display" style={s.title}>
        {title}
      </T>
      {children}
    </View>
  );
}

export function GroupHead({ label, count }: { label: string; count?: number }) {
  return (
    <View style={s.group}>
      <T v="label">{label}</T>
      {count !== undefined && (
        <T v="mono" style={s.count}>
          {count}
        </T>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
  },
  title: { fontSize: 15, flex: 1 },
  group: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  count: { color: color.faint, fontSize: 10.5 },
});
