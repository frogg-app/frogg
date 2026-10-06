import type { LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet } from "react-native";
import { color, web } from "../theme/tokens";
import { Cut } from "./Cut";
import { T } from "./Text";

type Kind = "primary" | "ghost" | "danger";

const labelTint: Record<Kind, string> = {
  primary: color.onAccent,
  ghost: color.text,
  danger: color.coral,
};

export function Button({
  label,
  onPress,
  kind = "ghost",
  icon: Icon,
  disabled,
  kbd,
  grow,
}: {
  label: string;
  onPress?: () => void;
  kind?: Kind;
  icon?: LucideIcon;
  disabled?: boolean;
  kbd?: string;
  grow?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={grow ? s.grow : undefined}>
      {({ hovered }) => (
        <Cut
          size={6}
          style={[s.b, s[kind], hovered && !disabled && s[`${kind}H`], disabled && s.disabled]}
        >
          {Icon && <Icon size={12} color={labelTint[kind]} />}
          <T style={[s.l, s[`${kind}L`]]}>{label}</T>
          {kbd && (
            <T v="mono" style={[s.k, kind === "primary" && s.kPrimary]}>
              {kbd}
            </T>
          )}
        </Cut>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  b: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  disabled: { opacity: 0.45 },
  l: { fontSize: 12.5, fontWeight: "600" },
  ghostL: { color: color.text },
  primaryL: { color: color.onAccent },
  dangerL: { color: color.coral },
  k: {
    fontSize: 9.5,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: color.line2,
  },
  kPrimary: { color: color.onAccent, borderColor: "rgba(4,22,26,0.35)" },
  ghost: { backgroundColor: "rgba(255,255,255,0.05)" },
  ghostH: { backgroundColor: "rgba(255,255,255,0.1)" },
  danger: { backgroundColor: "rgba(255,107,107,0.08)" },
  dangerH: { backgroundColor: "rgba(255,107,107,0.16)" },
  primary: {
    backgroundColor: color.cyan,
    ...web({
      backgroundImage: "linear-gradient(135deg, #7fd9e6, #25b5c8 55%, #045b9d)",
    }),
  },
  primaryH: { ...web({ filter: "brightness(1.1)" }) },
});
