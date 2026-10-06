import type { ReactNode } from "react";
import { View } from "react-native";
import { color } from "../theme/tokens";
import { T } from "./Text";

export function PanelHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10 }}>
      <T v="display" style={{ fontSize: 15, flex: 1 }}>{title}</T>
      {children}
    </View>
  );
}

export function GroupHead({ label, count }: { label: string; count?: number }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 }}>
      <T v="label">{label}</T>
      {count !== undefined && <T v="mono" style={{ color: color.faint, fontSize: 10.5 }}>{count}</T>}
    </View>
  );
}
