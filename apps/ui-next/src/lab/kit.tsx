// Building blocks for lab entries: the entry/variant types, specimen frames and demo controls.
import type { ComponentType, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Button } from "../components/Button";
import { T } from "../components/Text";
import { color } from "../theme/tokens";
import { useLab } from "./store";

export const CATEGORIES = [
  "Foundations",
  "Primitives",
  "Data display",
  "Feedback",
  "Chat",
  "Navigation & shell",
  "Settings controls",
  "Rail tools & widgets",
  "Interactions",
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Variant {
  id: string;
  label: string;
  /** One line under the label: what to look at or try. */
  note?: string;
  C: ComponentType;
  /** Fixed frame height, for components that fill their box (panels, chat, shell). */
  h?: number;
  /** No padding: the component paints edge to edge. */
  bleed?: boolean;
}

export interface Entry {
  /** Deep-link id: `/lab?c=<id>`. */
  id: string;
  name: string;
  category: Category;
  /** Source file(s), relative to apps/ui-next/src. */
  path: string;
  purpose: string;
  /** Files outside the component's own that import it (from grep, see LAB.md). */
  usedBy?: number;
  /** Motion as found in code: property, duration, easing. "none" when it has none. */
  polish: string;
  variants: Variant[];
  /** Runs after the fixtures reseed, before the variants mount (select a session, open a tool). */
  setup?: () => void;
  /** An open question for the user; shows a DECIDE marker in the index and a callout on the page. */
  decision?: string;
  /** The demo mounts its own ToastHost (the real shell), so the lab's is left out. */
  ownToasts?: boolean;
}

/** Frame around one variant: label, note, then the live component. */
export function Specimen({ v }: { v: Variant }) {
  const frame = useMemo(
    () => [s.frame, v.bleed && s.bleed, v.h !== undefined && { height: v.h }],
    [v.bleed, v.h],
  );
  return (
    <View style={s.spec}>
      <View style={s.specHead}>
        <T style={s.specLabel}>{v.label}</T>
        {v.note && <T style={s.specNote}>{v.note}</T>}
      </View>
      <View style={frame}>
        <v.C />
      </View>
    </View>
  );
}

/** A row of demo triggers above a live component. */
export function Controls({ children }: { children: ReactNode }) {
  return <View style={s.controls}>{children}</View>;
}

/** A demo trigger. `run` must be stable (module-level or memoised). */
export function Act({
  label,
  run,
  primary,
}: {
  label: string;
  run: () => void;
  primary?: boolean;
}) {
  return <Button label={label} onPress={run} kind={primary ? "primary" : "ghost"} />;
}

/** Horizontal wrap of small specimens (glyphs, buttons, swatches). */
export function Wrap({ children }: { children: ReactNode }) {
  return <View style={s.wrap}>{children}</View>;
}

/** Vertical stack with even spacing. */
export function Stack({ children }: { children: ReactNode }) {
  return <View style={s.stack}>{children}</View>;
}

/** A caption under a small specimen inside a Wrap. */
export function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={s.cell}>
      <View style={s.cellBody}>{children}</View>
      <T v="mono" style={s.cellLabel}>
        {label}
      </T>
    </View>
  );
}

/**
 * Remounts its children every `every` ms (scaled by the lab speed) and on click, so one-shot
 * mount animations (enter, snap, fade, afterglow, bracket snap) keep replaying in view.
 */
export function Loop({ children, every = 1600 }: { children: ReactNode; every?: number }) {
  const [n, setN] = useState(0);
  const rate = Number(useLab((st) => st.speed));
  const replay = useCallback(() => setN((x) => x + 1), []);
  useEffect(() => {
    const id = setInterval(replay, every / rate);
    return () => clearInterval(id);
  }, [replay, every, rate, n]);
  return (
    <Pressable onPress={replay} accessibilityLabel="Replay">
      <View key={n}>{children}</View>
    </Pressable>
  );
}

/** Fills a fixed-height frame, for components that expect a flex parent. */
export function Fill({ children }: { children: ReactNode }) {
  return <View style={s.fill}>{children}</View>;
}

/** A fixed-width column, e.g. a side panel at its shell width. */
export function Column({ width, children }: { width: number; children: ReactNode }) {
  const st = useMemo(() => [s.column, { width }], [width]);
  return <View style={st}>{children}</View>;
}

/** Keeps children at their natural width instead of stretching across the frame. */
export function Start({ children }: { children: ReactNode }) {
  return <View style={s.start}>{children}</View>;
}

/** Anchors a popover that positions itself above its parent (bottom: 100%) to the frame's foot. */
export function Above({ children }: { children: ReactNode }) {
  return (
    <View style={s.aboveFrame}>
      <View style={s.above}>{children}</View>
    </View>
  );
}

/** Side by side panes that fill the frame. */
export function Row({ children }: { children: ReactNode }) {
  return <View style={s.row}>{children}</View>;
}

/** Real context widths: docked side panel, tablet side panel, phone screen. */
export const W = { panel: 340, tablet: 300, phone: 390 } as const;

/**
 * One labelled case: the component name, its key props and the width it is shown at, then the
 * live component in a frame of that width. Lay several side by side with `Cases`.
 */
export function Case({
  name,
  props,
  note,
  w,
  h,
  plain,
  children,
}: {
  /** Component name, e.g. "PanelHead". */
  name: string;
  /** Key props as written in JSX, e.g. `title="Usage" actions=[refresh]`. */
  props?: string;
  /** What this case proves or what to try. */
  note?: string;
  /** Frame width in px (the component's real context); omit for natural width. */
  w?: number;
  /** Fixed frame height, for components that fill their parent. */
  h?: number;
  /** No surface or border: for components that paint their own card. */
  plain?: boolean;
  children: ReactNode;
}) {
  const box = useMemo(
    () => [s.caseBox, w !== undefined && { width: w }, h !== undefined && { height: h }],
    [w, h],
  );
  const frame = useMemo(() => [s.caseFrame, plain && s.casePlain], [plain]);
  return (
    <View style={box}>
      <View style={s.caseHead}>
        <T v="mono" style={s.caseName} numberOfLines={3}>
          {name}
          {props ? <T v="mono" style={s.caseProps}>{` ${props}`}</T> : null}
        </T>
        {w !== undefined && (
          <T v="mono" style={s.caseW}>
            {w}px
          </T>
        )}
      </View>
      {note && <T style={s.caseNote}>{note}</T>}
      <View style={frame}>{children}</View>
    </View>
  );
}

/** Cases side by side, wrapping onto new lines (one per line on a phone). */
export function Cases({ children }: { children: ReactNode }) {
  return <View style={s.cases}>{children}</View>;
}

const GHOST = [
  { id: "a", w: "72%" as const },
  { id: "b", w: "54%" as const },
  { id: "c", w: "64%" as const },
  { id: "d", w: "46%" as const },
];
/** Placeholder rows beneath a head, so it reads as the top of a real panel. */
export function Ghost({ n = 2 }: { n?: number }) {
  return (
    <View style={s.ghost}>
      {GHOST.slice(0, n).map((g) => (
        <GhostRow key={g.id} w={g.w} />
      ))}
    </View>
  );
}
function GhostRow({ w }: { w: `${number}%` }) {
  const bar = useMemo(() => [s.ghostBar, { width: w }], [w]);
  return (
    <View style={s.ghostRow}>
      <View style={s.ghostDot} />
      <View style={bar} />
    </View>
  );
}

const s = StyleSheet.create({
  spec: { gap: 8 },
  specHead: { gap: 2 },
  specLabel: { fontSize: 12.5, fontWeight: "600", color: color.text },
  specNote: { fontSize: 12, color: color.faint },
  frame: {
    backgroundColor: color.bg2,
    borderWidth: 1,
    borderColor: color.line,
    padding: 16,
    overflow: "hidden",
  },
  bleed: { padding: 0 },
  controls: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 18, alignItems: "flex-end" },
  stack: { gap: 14 },
  cell: { alignItems: "center", gap: 8, minWidth: 64 },
  cellBody: { minHeight: 24, alignItems: "center", justifyContent: "center" },
  cellLabel: { fontSize: 10.5, color: color.faint },
  fill: { flex: 1 },
  column: { borderRightWidth: 1, borderRightColor: color.line, backgroundColor: color.bg2 },
  row: { flex: 1, flexDirection: "row" },
  start: { alignItems: "flex-start", gap: 14 },
  caseBox: { maxWidth: "100%", gap: 6 },
  caseHead: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  caseName: { flex: 1, fontSize: 11.5, color: color.cyan2 },
  caseProps: { fontSize: 11.5, color: color.muted },
  caseW: { fontSize: 10.5, color: color.faint },
  caseNote: { fontSize: 12, color: color.faint },
  caseFrame: {
    flex: 1,
    backgroundColor: color.bg2,
    borderWidth: 1,
    borderColor: color.line2,
    borderStyle: "dashed",
    overflow: "hidden",
  },
  casePlain: { backgroundColor: "transparent", borderWidth: 0, overflow: "visible" },
  cases: { flexDirection: "row", flexWrap: "wrap", gap: 24, alignItems: "flex-start" },
  ghost: { paddingHorizontal: 16, paddingVertical: 6, gap: 2 },
  ghostRow: { flexDirection: "row", alignItems: "center", gap: 10, height: 30 },
  ghostDot: { width: 8, height: 8, borderWidth: 1, borderColor: color.line2 },
  ghostBar: { height: 8, backgroundColor: color.wash2 },
  aboveFrame: { flex: 1, justifyContent: "flex-end" },
  above: { height: 1 },
});
