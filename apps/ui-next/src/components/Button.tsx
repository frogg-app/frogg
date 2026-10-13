import type { LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { usePrefs, type ButtonStyle } from "../prefs";
import { color, web } from "../theme/tokens";
import { Brackets } from "./Brackets";
import { ShapeFace, useShape, type ShapeLang } from "./Shape";
import { T } from "./Text";

type Kind = "primary" | "ghost" | "danger";
export type PrimaryStyle = ButtonStyle;
export type ForceState = "hover" | "pressed";

type Ink = "onAccent" | "cyan2" | "text" | "coral";
/** Label and icon colour of each primary treatment. */
const ink: Record<PrimaryStyle, Ink> = {
  gradient: "onAccent",
  solid: "onAccent",
  mint: "onAccent",
  outline: "cyan2",
  bar: "text",
  bracket: "cyan2",
  tint: "cyan2",
};
const kindInk: Record<Exclude<Kind, "primary">, Ink> = { ghost: "text", danger: "coral" };

const edgeOf: Record<Kind, string> = {
  primary: color.cyan,
  ghost: color.line2,
  danger: color.coral,
};

interface FaceProps {
  label: string;
  kind: Kind;
  icon?: LucideIcon;
  disabled?: boolean;
  kbd?: string;
  alt: PrimaryStyle;
  lang: ShapeLang;
  force?: ForceState;
}

/** Style stack of one face: fill by kind or primary look, then hover / pressed / disabled. */
function faceStyle(kind: Kind, alt: PrimaryStyle, h: boolean, p: boolean, disabled?: boolean) {
  const key = kind === "primary" ? alt : kind;
  return [
    s.b,
    s[key],
    h && s[`${key}H`],
    p && s[`${key}P`],
    kind === "primary" && alt === "outline" && s.outlinePad,
    disabled && s.disabled,
  ];
}

const FILLED = new Set<PrimaryStyle>(["gradient", "solid", "mint"]);

function Decor({ alt, on }: { alt: PrimaryStyle; on: boolean }) {
  if (alt === "bar") return <View style={[s.stripe, on && s.stripeOn]} />;
  if (alt === "bracket") return <Brackets c={on ? color.cyan2 : color.cyan} len={6} />;
  return null;
}

function ButtonFace({
  label,
  kind,
  icon: Icon,
  disabled,
  kbd,
  alt,
  lang,
  force,
  hovered,
  pressed,
}: FaceProps & { hovered?: boolean; pressed?: boolean }) {
  const p = !disabled && (force === "pressed" || !!pressed);
  const h = !disabled && !p && (force === "hover" || !!hovered);
  const primary = kind === "primary";
  const tone = primary ? ink[alt] : kindInk[kind];
  const hud = lang === "hud";
  const edge = primary && alt === "bar" ? color.cyan : edgeOf[kind];
  return (
    <ShapeFace lang={lang} edge={edge} on={h || p} style={faceStyle(kind, alt, h, p, disabled)}>
      {primary && <Decor alt={alt} on={h || p} />}
      {Icon && <Icon size={12} color={color[tone]} />}
      <T v={hud ? "mono" : "body"} style={[s.l, hud && s.hudL, tones[tone]]}>
        {hud ? `[ ${label.toUpperCase()} ]` : label}
      </T>
      {kbd && (
        <T v="mono" style={[s.k, primary && FILLED.has(alt) && s.kPrimary]}>
          {kbd}
        </T>
      )}
    </ShapeFace>
  );
}

export function Button({
  label,
  onPress,
  kind = "ghost",
  icon,
  disabled,
  kbd,
  grow,
  look,
  shape,
  force,
}: {
  label: string;
  onPress?: () => void;
  kind?: Kind;
  icon?: LucideIcon;
  disabled?: boolean;
  kbd?: string;
  grow?: boolean;
  /** Primary treatment; defaults to the Design options pick. */
  look?: PrimaryStyle;
  /** Silhouette; defaults to the Design options pick. */
  shape?: ShapeLang;
  /** Pin hover or pressed (lab and the Design options preview). */
  force?: ForceState;
}) {
  const pickedLook = usePrefs((st) => st.buttonStyle);
  const pickedShape = useShape();
  const face = {
    label,
    kind,
    icon,
    disabled,
    kbd,
    force,
    alt: look ?? pickedLook,
    lang: shape ?? pickedShape,
  };
  return (
    <Pressable onPress={onPress} disabled={disabled} style={grow ? s.grow : undefined}>
      {({ hovered, pressed }) => <ButtonFace {...face} hovered={hovered} pressed={pressed} />}
    </Pressable>
  );
}

const tones = StyleSheet.create({
  onAccent: { color: color.onAccent },
  cyan2: { color: color.cyan2 },
  text: { color: color.text },
  coral: { color: color.coral },
});

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
  outlinePad: { paddingVertical: 5, paddingHorizontal: 10 },
  disabled: { opacity: 0.45 },
  l: { fontSize: 12.5, fontWeight: "600" },
  hudL: { fontSize: 11.5, letterSpacing: 1 },
  k: {
    fontSize: 9.5,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: color.line2,
  },
  kPrimary: { color: color.onAccent, borderColor: "rgba(4,22,26,0.35)" },

  ghost: { backgroundColor: "rgba(255,255,255,0.05)" },
  ghostH: { backgroundColor: "rgba(255,255,255,0.1)" },
  ghostP: { backgroundColor: "rgba(255,255,255,0.14)" },
  danger: { backgroundColor: "rgba(255,107,107,0.08)" },
  dangerH: { backgroundColor: "rgba(255,107,107,0.16)" },
  dangerP: { backgroundColor: "rgba(255,107,107,0.22)" },

  gradient: {
    backgroundColor: color.cyan,
    ...web({
      backgroundImage: "linear-gradient(135deg, #7fd9e6, #25b5c8 55%, #045b9d)",
    }),
  },
  gradientH: { ...web({ filter: "brightness(1.1)" }) },
  gradientP: { backgroundColor: color.cyanDim, ...web({ filter: "brightness(0.95)" }) },

  solid: { backgroundColor: color.cyan },
  solidH: { backgroundColor: color.cyan2 },
  solidP: { backgroundColor: color.cyanDim },

  mint: { backgroundColor: color.mint },
  mintH: { backgroundColor: color.mint, opacity: 0.88 },
  mintP: { backgroundColor: color.mintDim },

  outline: { borderWidth: 1, borderColor: color.cyan },
  outlineH: { backgroundColor: color.cyanWash, borderColor: color.cyan2 },
  outlineP: { backgroundColor: color.cyanWash2, borderColor: color.cyan2 },

  bar: { backgroundColor: color.raise, paddingLeft: 13 },
  barH: { backgroundColor: color.panel },
  barP: { backgroundColor: color.bg2 },
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

  tint: { backgroundColor: color.cyanWash },
  tintH: { backgroundColor: color.cyanWash2 },
  tintP: { backgroundColor: color.cyanWash3 },
});
