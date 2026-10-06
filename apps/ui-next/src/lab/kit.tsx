// Building blocks for lab entries: the entry/variant types, specimen frames and demo controls.
import type { ComponentType, ReactNode } from "react";
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "../components/Button";
import { T } from "../components/Text";
import { color } from "../theme/tokens";

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
  aboveFrame: { flex: 1, justifyContent: "flex-end" },
  above: { height: 1 },
});
