import { StyleSheet, View, type ViewStyle } from "react-native";
import { Cut } from "../../components/Cut";
import { Brackets } from "../../components/SessionList";
import { T } from "../../components/Text";
import { anim, bp, color, font, frames, labelTint, motion, syntax, web } from "../../theme/tokens";
import { Cell, Loop, Stack, Wrap, type Entry } from "../kit";

const swatchCache = new Map<string, ViewStyle>();
function swatchStyle(c: string): ViewStyle {
  let st = swatchCache.get(c);
  if (!st) {
    st = StyleSheet.create({
      x: { width: 56, height: 40, backgroundColor: c, borderWidth: 1, borderColor: color.line },
    }).x;
    swatchCache.set(c, st);
  }
  return st;
}

function Swatches({ map }: { map: Record<string, string> }) {
  return (
    <Wrap>
      {Object.entries(map).map(([name, c]) => (
        <Cell key={name} label={name}>
          <View style={swatchStyle(c)} />
          <T v="mono" style={s.hex}>
            {c}
          </T>
        </Cell>
      ))}
    </Wrap>
  );
}

const Palette = () => <Swatches map={color} />;
const Labels = () => <Swatches map={labelTint} />;
const Syntax = () => <Swatches map={syntax} />;

function TypeScale() {
  return (
    <Stack>
      <View style={s.typeRow}>
        <T v="label">label · {font.mono} 10.5 / 1.6 tracking, uppercase</T>
      </View>
      <View style={s.typeRow}>
        <T v="display">display · {font.display} 600 15</T>
      </View>
      <View style={s.typeRow}>
        <T v="display" style={s.display19}>
          display 19 · conversation title
        </T>
      </View>
      <View style={s.typeRow}>
        <T>body · {font.body} 13.5 — The agent finished and is ready for review.</T>
      </View>
      <View style={s.typeRow}>
        <T v="mono">mono · {font.mono} 11.5 — npm run test -- session-store</T>
      </View>
      <View style={s.typeRow}>
        <T style={s.bodyMuted}>body muted 12.5 — hints, sub-lines and secondary copy</T>
      </View>
    </Stack>
  );
}

function LongText() {
  return (
    <T numberOfLines={2}>
      A very long session title that keeps going well past the width of its column so the ellipsis
      behaviour is visible at both the desktop and phone widths of the lab, without wrapping into a
      third line.
    </T>
  );
}

const CUTS = [5, 6, 8, 10, 12, 14, 16];
function Cuts() {
  return (
    <Wrap>
      {CUTS.map((n) => (
        <Cell key={n} label={`size ${n}`}>
          <Cut size={n} style={s.cut} />
        </Cell>
      ))}
      <Cell label="flip 12">
        <Cut size={12} flip style={s.cut} />
      </Cell>
      <Cell label="bordered 10">
        <Cut size={10} style={s.cutLine} />
      </Cell>
    </Wrap>
  );
}

function Layout() {
  return (
    <Stack>
      <T v="mono">
        bp.tablet {bp.tablet}px · bp.desktop {bp.desktop}px · docked side panel at ≥ 900px window
      </T>
      <T v="mono">
        rail 58 · side panel 340 (300 on tablet) · chat column max 860 · composer max 892
      </T>
      <View style={s.layout}>
        <View style={s.lRail} />
        <View style={s.lSide}>
          <T v="label">side 340</T>
        </View>
        <View style={s.lMain}>
          <T v="label">main · flex 1</T>
        </View>
      </View>
    </Stack>
  );
}

const MOTION: Array<{ id: string; label: string; style: object; once?: boolean }> = [
  { id: "enter", label: "enter 200ms", style: motion.enter, once: true },
  { id: "snap", label: "snap 220ms", style: motion.snap, once: true },
  { id: "fade", label: "fade 150ms", style: motion.fade, once: true },
  { id: "afterglow", label: "afterglow 1.2s", style: motion.afterglow, once: true },
  { id: "breathe", label: "breathe 1.6s ∞", style: motion.breathe },
];

const motionStyles = StyleSheet.create(
  Object.fromEntries(
    MOTION.map((m) => [
      m.id,
      {
        width: 72,
        height: 44,
        backgroundColor: color.raise,
        borderWidth: 1,
        borderColor: color.line2,
        ...m.style,
      },
    ]),
  ),
);

function Motion() {
  return (
    <Wrap>
      {MOTION.map((m) => (
        <Cell key={m.id} label={m.label}>
          {m.once ? (
            <Loop>
              <View style={motionStyles[m.id]} />
            </Loop>
          ) : (
            <View style={motionStyles[m.id]} />
          )}
        </Cell>
      ))}
      <Cell label="beam 1.4s ∞">
        <View style={s.beamTrack}>
          <View style={s.beam} />
        </View>
      </Cell>
      <Cell label="shimmer 2s ∞">
        <T v="mono" style={s.shimmer}>
          Thinking
        </T>
      </Cell>
      <Cell label="snap brackets">
        <Loop>
          <View style={s.bracketBox}>
            <Brackets />
          </View>
        </Loop>
      </Cell>
    </Wrap>
  );
}

export const foundations: Entry[] = [
  {
    id: "colour",
    name: "Colour",
    category: "Foundations",
    path: "theme/tokens.ts (color, labelTint, syntax)",
    purpose: "The Bracket palette: surfaces, lines, text, accents, washes and label tints.",
    usedBy: 86,
    polish: "none",
    variants: [
      { id: "palette", label: "color", C: Palette },
      { id: "labels", label: "labelTint (workspace labels)", C: Labels },
      { id: "syntax", label: "syntax (code highlighting)", C: Syntax },
    ],
  },
  {
    id: "type",
    name: "Type",
    category: "Foundations",
    path: "components/Text.tsx (T) + theme/tokens.ts (font)",
    purpose: "Every string goes through T with one of four variants; sizes are set per use.",
    usedBy: 85,
    polish: "none",
    variants: [
      { id: "scale", label: "Variants", C: TypeScale },
      { id: "long", label: "Long content", note: "numberOfLines={2}", C: LongText },
    ],
  },
  {
    id: "shape",
    name: "Shape & layout",
    category: "Foundations",
    path: "components/Cut.tsx · theme/tokens.ts (bp) · theme/layout.ts",
    purpose: "Chamfer sizes in use, the breakpoints and the shell's fixed widths.",
    usedBy: 24,
    polish: "none",
    variants: [
      { id: "cuts", label: "Chamfer sizes in use", C: Cuts },
      { id: "layout", label: "Breakpoints and shell widths", C: Layout },
    ],
  },
  {
    id: "motion",
    name: "Motion tokens",
    category: "Foundations",
    path: "theme/tokens.ts (frames, anim, motion) · theme/web-fonts.ts",
    purpose:
      "Every keyframe animation in the app, live. One-shot ones loop every 1.6s; click a cell to replay it now; use the speed control to slow them.",
    usedBy: 7,
    polish:
      "enter: opacity 0→1 + translateY 6→0, 200ms cubic-bezier(0.23,1,0.32,1) · snap: opacity + scale 1.06→1, 220ms same curve · fade: opacity, 150ms ease-out · afterglow: mint wash 0.28→0.09, 1.2s ease-out · breathe: opacity 0.45↔1, 1.6s ease-in-out ∞ · shimmer: background-position, 2s linear ∞ · beam: translateX −100%→400%, 1.4s cubic-bezier(0.77,0,0.175,1) ∞ · web only; native renders the end state · prefers-reduced-motion clamps all to 1ms",
    variants: [{ id: "all", label: "All keyframes", C: Motion }],
  },
];

const s = StyleSheet.create({
  hex: { fontSize: 9.5, color: color.faint },
  typeRow: { borderBottomWidth: 1, borderBottomColor: color.line, paddingBottom: 10 },
  display19: { fontSize: 19 },
  bodyMuted: { fontSize: 12.5, color: color.muted },
  cut: { width: 64, height: 40, backgroundColor: color.raise },
  cutLine: {
    width: 64,
    height: 40,
    borderWidth: 1,
    borderColor: color.cyan,
    backgroundColor: color.cyanWash,
  },
  layout: { flexDirection: "row", height: 90, borderWidth: 1, borderColor: color.line },
  lRail: {
    width: 18,
    backgroundColor: color.bg,
    borderRightWidth: 1,
    borderRightColor: color.line,
  },
  lSide: {
    width: 104,
    backgroundColor: color.bg2,
    borderRightWidth: 1,
    borderRightColor: color.line,
    padding: 8,
  },
  lMain: { flex: 1, padding: 8, backgroundColor: color.panel },
  beamTrack: { width: 120, height: 2, overflow: "hidden", backgroundColor: color.line },
  beam: {
    width: "25%",
    height: 2,
    backgroundColor: color.cyan2,
    ...web({ backgroundImage: "linear-gradient(90deg, transparent, #7fd9e6, transparent)" }),
    ...anim(frames.beam, "1.4s", "cubic-bezier(0.77,0,0.175,1)", "infinite", "none"),
  },
  shimmer: { fontSize: 12.5, ...motion.shimmerText, ...motion.shimmerRun },
  bracketBox: { width: 72, height: 44, backgroundColor: color.wash },
});
