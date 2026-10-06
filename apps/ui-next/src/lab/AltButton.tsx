// Lab-only primary button candidates. Same chamfer, padding and type as components/Button.tsx;
// only the primary treatment differs. Not used by the app.
import type { LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { Cut } from "../components/Cut";
import { Brackets } from "../components/SessionList";
import { T } from "../components/Text";
import { color } from "../theme/tokens";

export type Alt = "solid" | "mint" | "outline" | "bar" | "bracket" | "tint";
export type Force = "hover" | "pressed";

const ink: Record<Alt, string> = {
  solid: color.onAccent,
  mint: color.onAccent,
  outline: color.cyan2,
  bar: color.text,
  bracket: color.cyan2,
  tint: color.cyan2,
};

export function AltButton({
  alt,
  label,
  icon: Icon,
  kbd,
  force,
  onPress,
}: {
  alt: Alt;
  label: string;
  icon?: LucideIcon;
  kbd?: string;
  force?: Force;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress}>
      {({ hovered, pressed }) => {
        const p = force === "pressed" || pressed;
        const h = !p && (force === "hover" || hovered);
        return (
          <Cut size={6} style={[s.b, s[alt], h && s[`${alt}H`], p && s[`${alt}P`]]}>
            {alt === "bar" && <View style={[s.stripe, (h || p) && s.stripeOn]} />}
            {alt === "bracket" && <Brackets c={h || p ? color.cyan2 : color.cyan} len={6} />}
            {Icon && <Icon size={12} color={ink[alt]} />}
            <T style={[s.l, s[`${alt}L`]]}>{label}</T>
            {kbd && <T style={[s.k, s[`${alt}K`]]}>{kbd}</T>}
          </Cut>
        );
      }}
    </Pressable>
  );
}

const s = StyleSheet.create({
  b: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  l: { fontSize: 12.5, fontWeight: "600" },
  k: { fontSize: 9.5, paddingHorizontal: 4, borderWidth: 1, borderColor: color.line2 },

  solid: { backgroundColor: color.cyan },
  solidH: { backgroundColor: color.cyan2 },
  solidP: { backgroundColor: color.cyanDim },
  solidL: { color: color.onAccent },
  solidK: { color: color.onAccent, borderColor: color.onAccent },

  mint: { backgroundColor: color.mint },
  mintH: { backgroundColor: color.mint, opacity: 0.88 },
  mintP: { backgroundColor: color.mintDim },
  mintL: { color: color.onAccent },
  mintK: { color: color.onAccent, borderColor: color.onAccent },

  outline: { borderWidth: 1, borderColor: color.cyan, paddingVertical: 5, paddingHorizontal: 10 },
  outlineH: { backgroundColor: color.cyanWash, borderColor: color.cyan2 },
  outlineP: { backgroundColor: color.cyanWash2, borderColor: color.cyan2 },
  outlineL: { color: color.cyan2 },
  outlineK: { color: color.cyan2, borderColor: color.cyan },

  bar: { backgroundColor: color.raise, paddingLeft: 13 },
  barH: { backgroundColor: color.panel },
  barP: { backgroundColor: color.bg2 },
  barL: { color: color.text },
  barK: { color: color.muted },
  stripe: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: color.cyan,
  },
  stripeOn: { backgroundColor: color.cyan2 },

  bracket: { backgroundColor: color.raise },
  bracketH: { backgroundColor: color.cyanWash },
  bracketP: { backgroundColor: color.cyanWash2 },
  bracketL: { color: color.cyan2 },
  bracketK: { color: color.cyan2, borderColor: color.cyan },

  tint: { backgroundColor: color.cyanWash },
  tintH: { backgroundColor: color.cyanWash2 },
  tintP: { backgroundColor: color.cyanWash3 },
  tintL: { color: color.cyan2 },
  tintK: { color: color.cyan2, borderColor: color.cyanWash3 },
});
