// Presentational sub-work views: the session-row indicator (three variants), the nested item
// rows, and the one-shot settle feedback. Props in, no store: the app wraps them with
// useSubWork (hooks.ts) and the lab feeds them simulated rows.
import { Bot, ChevronDown, GitBranch, Server, SquareTerminal, Timer } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import type { Bucket } from "../../daemon/types";
import { useNow } from "../../daemon/subwork";
import { anim, color, ease, frames, glide, subworkMs } from "../../theme/tokens";
import { Cut } from "../Cut";
import { Num } from "../CountUp";
import { useReducedMotion } from "../Meter";
import { StatusGlyph } from "../StatusGlyph";
import { T } from "../Text";
import { Collapse } from "./Collapse";
import {
  elapsed,
  KIND_NOUN,
  rollup,
  visibleItems,
  type SubWork,
  type SubWorkKind,
  type SubWorkStatus,
} from "./model";

/** The session-row indicator: A count chip, B one dot per item, C nested rows always shown. */
export type SubWorkVariant = "chip" | "dots" | "tree";

export const statusColor: Record<SubWorkStatus, string> = {
  running: color.cyan2,
  attention: color.amber,
  failed: color.coral,
  done: color.mint,
  idle: color.faint,
};
const wash: Record<SubWorkStatus, string> = {
  running: color.cyanWash,
  attention: "rgba(245,184,74,0.1)",
  failed: color.coralWash,
  done: "rgba(63,207,142,0.08)",
  idle: color.wash,
};
const bucketOfStatus: Record<SubWorkStatus, Bucket> = {
  running: "working",
  attention: "needs",
  failed: "failed",
  done: "review",
  idle: "idle",
};

const curve = Easing.bezier(...glide.curve);
const wave = Easing.inOut(Easing.quad);
const out = Easing.out(Easing.quad);

const KIND_ICON = {
  subagent: Bot,
  "child-session": GitBranch,
  "background-task": Timer,
  terminal: SquareTerminal,
  script: Server,
} satisfies Record<SubWorkKind, unknown>;

export function KindGlyph({
  kind,
  size = 12,
  tint = color.muted,
}: {
  kind: SubWorkKind;
  size?: number;
  tint?: string;
}) {
  const Icon = KIND_ICON[kind];
  return <Icon size={size} color={tint} />;
}

/** The tone a roll-up reads in: waiting on you, failed, running, else done. */
export function toneOf(items: SubWork[]): SubWorkStatus {
  const r = rollup(items);
  if (r.attention) return "attention";
  if (r.failed) return "failed";
  if (r.running) return "running";
  return r.done ? "done" : "idle";
}

// ---- motion hooks -------------------------------------------------------------------------------

/** 0 → 1 on a loop while `on`; JS-driven so web and Android share it. Idle and still otherwise. */
export function useLoop01(on: boolean, ms: number, hold = 0): Animated.Value {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  const run = on && !reduced;
  useEffect(() => {
    if (!run) {
      v.setValue(0);
      return undefined;
    }
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(v, {
          toValue: 1,
          duration: ms,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
        Animated.delay(hold),
      ]),
    );
    a.start();
    return () => a.stop();
  }, [run, v, ms, hold]);
  return v;
}

/** An opacity that breathes between 0.45 and 1 while `on`; steady at 1 otherwise. */
export function usePulse(on: boolean): Animated.AnimatedInterpolation<number> | number {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  const run = on && !reduced;
  useEffect(() => {
    if (!run) {
      v.setValue(0);
      return undefined;
    }
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(v, {
          toValue: 1,
          duration: subworkMs.pulse,
          easing: wave,
          useNativeDriver: false,
        }),
        Animated.timing(v, {
          toValue: 0,
          duration: subworkMs.pulse,
          easing: wave,
          useNativeDriver: false,
        }),
      ]),
    );
    a.start();
    return () => a.stop();
  }, [run, v]);
  return useMemo(
    () => (run ? v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) : 1),
    [run, v],
  );
}

export interface Settle {
  /** 0 → 1 → 0 wash overlay opacity. */
  flash: Animated.Value;
  /** Glyph scale. */
  pop: Animated.Value;
  /** Which way it settled, while the one-shot plays. */
  kind: "done" | "failed" | null;
}

/**
 * Plays once on a live running → done/failed change (never on mount with a final status): a soft
 * mint glow for done, one sharp coral flash for failed, and a small glyph pop on both.
 */
export function useSettle(status: SubWorkStatus): Settle {
  const reduced = useReducedMotion();
  const prev = useRef(status);
  const flash = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const [kind, setKind] = useState<Settle["kind"]>(null);
  useEffect(() => {
    const was = prev.current;
    prev.current = status;
    if (was !== "running" || (status !== "done" && status !== "failed") || reduced)
      return undefined;
    setKind(status);
    const failed = status === "failed";
    const a = Animated.parallel([
      Animated.sequence([
        Animated.timing(flash, {
          toValue: failed ? 1 : 0.6,
          duration: failed ? subworkMs.flashUp : subworkMs.flashUp * 3,
          easing: out,
          useNativeDriver: false,
        }),
        Animated.timing(flash, {
          toValue: 0,
          duration: subworkMs.flashDown,
          easing: out,
          useNativeDriver: false,
        }),
      ]),
      Animated.sequence([
        Animated.timing(pop, {
          toValue: 1.35,
          duration: subworkMs.popUp,
          easing: out,
          useNativeDriver: false,
        }),
        Animated.timing(pop, {
          toValue: 1,
          duration: subworkMs.popDown,
          easing: curve,
          useNativeDriver: false,
        }),
      ]),
    ]);
    a.start(({ finished }) => {
      if (finished) setKind(null);
    });
    return () => a.stop();
  }, [status, reduced, flash, pop]);
  return { flash, pop, kind };
}

// ---- one nested row -----------------------------------------------------------------------------

function timeText(it: SubWork, now: number): string {
  if (it.status === "running") return it.startedAt ? elapsed(it.startedAt, now) : "";
  if (it.status === "attention") return "needs you";
  if (it.status === "idle") return it.kind === "script" ? "stopped" : "";
  if (it.startedAt && it.endedAt) return elapsed(it.startedAt, it.endedAt);
  return "";
}

export function PortChip({ port }: { port: number }) {
  return (
    <View style={s.port}>
      <T v="mono" style={s.portT}>
        {`:${port}`}
      </T>
    </View>
  );
}

export interface ItemRowProps {
  item: SubWork;
  last: boolean;
  nested: boolean;
  /** No tree connector: a flat row for panels. */
  plain?: boolean;
  onOpen?: (item: SubWork) => void;
}

/** Indented child row: kind glyph, label, status, elapsed (ticking while running), port chip. */
export function ItemRow({ item, last, nested, plain, onOpen }: ItemRowProps) {
  const live = item.status === "running";
  const now = useNow(live);
  const settle = useSettle(item.status);
  const press = useCallback(() => onOpen?.(item), [onOpen, item]);
  const failed = item.status === "failed";
  const time = timeText(item, now);
  const flashStyle = useMemo(
    () => [
      s.flash,
      {
        backgroundColor: settle.kind === "failed" ? color.coral : color.mint,
        opacity: settle.flash.interpolate({ inputRange: [0, 1], outputRange: [0, 0.18] }),
      },
    ],
    [settle.flash, settle.kind],
  );
  const popStyle = useMemo(() => ({ transform: [{ scale: settle.pop }] }), [settle.pop]);
  const pulse = usePulse(live);
  const pulseStyle = useMemo(() => ({ opacity: pulse }), [pulse]);
  return (
    <Pressable
      onPress={onOpen ? press : undefined}
      accessibilityLabel={`${KIND_NOUN[item.kind]} ${item.label}, ${item.status}`}
    >
      {({ hovered }) => (
        <View style={[s.item, nested && s.itemNested, hovered && !!onOpen && s.itemHover]}>
          <Animated.View pointerEvents="none" style={flashStyle} />
          {!plain && (
            <View style={s.gutter}>
              <View style={[s.vline, last && s.vlineLast]} />
              <View style={s.tick} />
            </View>
          )}
          <View style={s.itemBody}>
            <View style={s.itemTop}>
              <KindGlyph kind={item.kind} size={12} tint={failed ? color.coral : color.muted} />
              <T numberOfLines={1} style={[s.itemLabel, item.status === "idle" && s.dim]}>
                {item.label}
              </T>
              {item.port !== undefined && <PortChip port={item.port} />}
              {time !== "" && (
                <T v="mono" style={[s.time, live && s.timeLive, failed && s.timeFail]}>
                  {time}
                </T>
              )}
              <Animated.View style={[popStyle, live && pulseStyle]}>
                <StatusGlyph bucket={bucketOfStatus[item.status]} size={6} still />
              </Animated.View>
            </View>
            {plain && !!item.detail && (
              <T numberOfLines={1} style={s.detailT}>
                {item.detail}
              </T>
            )}
            {!!item.activity && (
              <T
                key={item.activity}
                v="mono"
                numberOfLines={1}
                style={[s.activity, live && s.activityLive, failed && s.activityFail]}
              >
                {item.activity}
              </T>
            )}
          </View>
        </View>
      )}
    </Pressable>
  );
}

/** Puts nested items (a Workflow's agents) straight after the item they run under. */
export function nestOrder(items: SubWork[]): Array<{ item: SubWork; nested: boolean }> {
  const ids = new Set(items.map((x) => x.id));
  const top = items.filter((x) => !x.nestedUnder || !ids.has(x.nestedUnder));
  const list: Array<{ item: SubWork; nested: boolean }> = [];
  for (const t of top) {
    list.push({ item: t, nested: false });
    for (const c of items) if (c.nestedUnder === t.id) list.push({ item: c, nested: true });
  }
  return list;
}

/** The nested rows with their tree connector. `max` caps the list with a "+N more" line. */
export function SubWorkTree({
  items,
  onOpen,
  max,
  plain,
}: {
  items: SubWork[];
  onOpen?: (item: SubWork) => void;
  max?: number;
  plain?: boolean;
}) {
  const rows = nestOrder(items);
  const shown = max ? rows.slice(0, max) : rows;
  const more = rows.length - shown.length;
  return (
    <View style={s.tree}>
      {shown.map((r, i) => (
        <ItemRow
          key={r.item.id}
          item={r.item}
          nested={r.nested}
          plain={plain}
          last={i === shown.length - 1 && !more}
          onOpen={onOpen}
        />
      ))}
      {more > 0 && (
        <View style={s.moreRow}>
          <T v="mono" style={s.more}>{`+${more} more`}</T>
        </View>
      )}
    </View>
  );
}

// ---- the session-row indicator ------------------------------------------------------------------

function Beam({ on, tone }: { on: boolean; tone: string }) {
  const v = useLoop01(on, subworkMs.beam, 240);
  const band = useMemo(
    () => [
      s.beam,
      {
        backgroundColor: tone,
        left: v.interpolate({ inputRange: [0, 1], outputRange: ["-45%", "100%"] }),
        opacity: v.interpolate({
          inputRange: [0, 0.15, 0.85, 1],
          outputRange: [0, 0.35, 0.35, 0],
        }),
      },
    ],
    [v, tone],
  );
  if (!on) return null;
  return (
    <View pointerEvents="none" style={s.beamClip}>
      <Animated.View style={band} />
    </View>
  );
}

function Chevron({ open }: { open: boolean }) {
  const v = useRef(new Animated.Value(open ? 1 : 0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) {
      v.setValue(open ? 1 : 0);
      return undefined;
    }
    const a = Animated.timing(v, {
      toValue: open ? 1 : 0,
      duration: subworkMs.collapse,
      easing: curve,
      useNativeDriver: false,
    });
    a.start();
    return () => a.stop();
  }, [open, reduced, v]);
  const st = useMemo(
    () => ({
      transform: [
        { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] }) },
      ],
    }),
    [v],
  );
  return (
    <Animated.View style={st}>
      <ChevronDown size={11} color={color.faint} />
    </Animated.View>
  );
}

const OPEN = { expanded: true };
const SHUT = { expanded: false };
export const expandedState = (open: boolean) => (open ? OPEN : SHUT);

function a11y(items: SubWork[]): string {
  const r = rollup(items);
  const parts = [`${r.total} sub-processes`];
  if (r.running) parts.push(`${r.running} running`);
  if (r.attention) parts.push(`${r.attention} need you`);
  if (r.failed) parts.push(`${r.failed} failed`);
  return parts.join(", ");
}

/** A: count chip. A diamond mark (pulses while running), the count, and a chevron. */
function CountChip({ items, open, onToggle }: IndicatorProps) {
  const shown = visibleItems(items);
  const tone = toneOf(shown);
  const live = tone === "running";
  const pulse = usePulse(live);
  const markStyle = useMemo(
    () => [s.mark, { backgroundColor: statusColor[tone], opacity: pulse }],
    [tone, pulse],
  );
  const box = useMemo(
    () => [s.chip, { backgroundColor: wash[tone], borderColor: statusColor[tone] }],
    [tone],
  );
  const count = useMemo(() => [s.chipN, { color: statusColor[tone] }], [tone]);
  const settle = useSettle(tone);
  const flash = useMemo(
    () => [
      s.flash,
      {
        backgroundColor: settle.kind === "failed" ? color.coral : color.mint,
        opacity: settle.flash.interpolate({ inputRange: [0, 1], outputRange: [0, 0.3] }),
      },
    ],
    [settle.flash, settle.kind],
  );
  return (
    <Pressable
      onPress={onToggle}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={a11y(shown)}
      accessibilityState={expandedState(open)}
    >
      <Cut size={4} style={box}>
        <Beam on={live} tone={statusColor.running} />
        <Animated.View pointerEvents="none" style={flash} />
        <Animated.View style={markStyle} />
        <Num value={shown.length} style={count} duration={subworkMs.collapse} />
        <Chevron open={open} />
      </Cut>
    </Pressable>
  );
}

const MAX_DOTS = 6;

function Dot({
  status,
  pulse,
}: {
  status: SubWorkStatus;
  pulse: Animated.AnimatedInterpolation<number> | number;
}) {
  const settle = useSettle(status);
  const st = useMemo(
    () => [
      s.dot,
      status === "idle" && s.dotIdle,
      { backgroundColor: statusColor[status], opacity: status === "running" ? pulse : 1 },
      { transform: [{ scale: settle.pop }] },
    ],
    [status, pulse, settle.pop],
  );
  return <Animated.View style={st} />;
}

/** B: one small square per item, coloured by its status; running ones breathe together. */
function DotsChip({ items, open, onToggle }: IndicatorProps) {
  const shown = visibleItems(items);
  const pulse = usePulse(shown.some((x) => x.status === "running"));
  const head = shown.slice(0, MAX_DOTS);
  const more = shown.length - head.length;
  return (
    <Pressable
      onPress={onToggle}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={a11y(shown)}
      accessibilityState={expandedState(open)}
    >
      <View style={s.dots}>
        {head.map((x) => (
          <Dot key={x.id} status={x.status} pulse={pulse} />
        ))}
        {more > 0 && <T v="mono" style={s.dotsMore}>{`+${more}`}</T>}
        <Chevron open={open} />
      </View>
    </Pressable>
  );
}

export interface IndicatorProps {
  items: SubWork[];
  variant: SubWorkVariant;
  open: boolean;
  onToggle: () => void;
}

/** The trailing chip in a session row (variants A and B). C has no chip: its rows are the cue. */
export function SubWorkChip(p: IndicatorProps) {
  if (!visibleItems(p.items).length || p.variant === "tree") return null;
  return p.variant === "dots" ? <DotsChip {...p} /> : <CountChip {...p} />;
}

/** The nested rows under a session row: collapsible for A/B, always shown (capped) for C. */
export function SubWorkBody({
  items,
  variant,
  open,
  onOpen,
}: {
  items: SubWork[];
  variant: SubWorkVariant;
  open: boolean;
  onOpen?: (item: SubWork) => void;
}) {
  const shown = visibleItems(items);
  if (!shown.length) return null;
  if (variant === "tree")
    return (
      <View style={s.body}>
        <SubWorkTree items={shown} onOpen={onOpen} max={5} />
      </View>
    );
  return (
    <Collapse open={open}>
      <View style={s.body}>
        <SubWorkTree items={shown} onOpen={onOpen} max={8} />
      </View>
    </Collapse>
  );
}

const s = StyleSheet.create({
  tree: { paddingTop: 2 },
  body: { marginLeft: 18, paddingTop: 4 },
  item: { flexDirection: "row", alignItems: "stretch", minHeight: 24, paddingRight: 2 },
  itemNested: { marginLeft: 14 },
  itemHover: { backgroundColor: color.wash },
  flash: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0 },
  gutter: { width: 16 },
  vline: {
    position: "absolute",
    left: 6,
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: color.line2,
  },
  vlineLast: { bottom: undefined, height: 12 },
  tick: {
    position: "absolute",
    left: 6,
    top: 12,
    width: 8,
    height: 1,
    backgroundColor: color.line2,
  },
  itemBody: { flex: 1, paddingVertical: 3, minWidth: 0 },
  itemTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  itemLabel: { flex: 1, fontSize: 12.5, color: color.text },
  dim: { color: color.faint },
  time: { fontSize: 10.5, color: color.faint, fontVariant: ["tabular-nums"] },
  timeLive: { color: color.cyan2 },
  timeFail: { color: color.coral },
  activity: { marginLeft: 18, marginTop: 1, fontSize: 10.5, color: color.faint },
  activityLive: { color: color.cyan2, ...anim(frames.enter, "220ms", ease) },
  detailT: { marginLeft: 18, marginTop: 1, fontSize: 11.5, color: color.muted },
  activityFail: { color: color.coral },
  port: {
    borderWidth: 1,
    borderColor: color.line2,
    paddingHorizontal: 4,
    backgroundColor: color.wash,
  },
  portT: { fontSize: 10, color: color.muted },
  moreRow: { flexDirection: "row", minHeight: 22, alignItems: "center", paddingLeft: 16 },
  more: { fontSize: 10.5, color: color.faint },
  chip: {
    marginTop: 1,
    marginRight: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    overflow: "hidden",
  },
  chipN: { fontSize: 11 },
  mark: { width: 6, height: 6, transform: [{ rotate: "45deg" }] },
  beamClip: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, overflow: "hidden" },
  beam: { position: "absolute", top: 0, bottom: 0, width: "45%" },
  dots: { flexDirection: "row", alignItems: "center", gap: 3, paddingVertical: 4 },
  dot: { width: 6, height: 6 },
  dotIdle: { opacity: 0.4 },
  dotsMore: { fontSize: 10, color: color.faint, marginLeft: 2 },
});
