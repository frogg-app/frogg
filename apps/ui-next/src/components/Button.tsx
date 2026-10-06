import type { ReactNode } from "react";
import { Pressable, StyleSheet } from "react-native";
import { color, web } from "../theme/tokens";
import { Cut } from "./Cut";
import { T } from "./Text";

export function Button({
  label, onPress, kind = "ghost", icon, disabled, kbd, grow,
}: {
  label: string; onPress?: () => void; kind?: "primary" | "ghost" | "danger"; icon?: ReactNode;
  disabled?: boolean; kbd?: string; grow?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={grow ? { flex: 1 } : undefined}>
      {({ hovered }) => (
        <Cut size={6} style={[s.b, s[kind], hovered && !disabled && s[`${kind}H`], disabled && { opacity: 0.45 }]}>
          {icon}
          <T style={[s.l, kind === "primary" && { color: color.onAccent }, kind === "danger" && { color: color.coral }]}>{label}</T>
          {kbd && <T v="mono" style={[s.k, kind === "primary" && { color: color.onAccent, borderColor: "rgba(4,22,26,0.35)" }]}>{kbd}</T>}
        </Cut>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  b: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 11, paddingVertical: 6 },
  l: { fontSize: 12.5, fontWeight: "600" },
  k: { fontSize: 9.5, paddingHorizontal: 4, borderWidth: 1, borderColor: color.line2 },
  ghost: { backgroundColor: "rgba(255,255,255,0.05)" },
  ghostH: { backgroundColor: "rgba(255,255,255,0.1)" },
  danger: { backgroundColor: "rgba(255,107,107,0.08)" },
  dangerH: { backgroundColor: "rgba(255,107,107,0.16)" },
  primary: { backgroundColor: color.cyan, ...web({ backgroundImage: "linear-gradient(135deg, #7fd9e6, #25b5c8 55%, #045b9d)" }) },
  primaryH: { ...web({ filter: "brightness(1.1)" }) },
});
