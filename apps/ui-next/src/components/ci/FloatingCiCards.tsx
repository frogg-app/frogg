// Small draggable cards for the checkout's live CI runs, floating over the chat. The run's
// progress is a ring drawn round the whole card border; a failed run closes the ring in coral.
import { X } from "lucide-react-native";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { alpha, color, ease, font, web } from "../../theme/tokens";
import { useUi } from "../../ui-store";
import { T } from "../Text";
import {
  cardFace,
  dismissCiCard,
  isRunActive,
  moveCiCard,
  useCiRunWatch,
  useFloatingCi,
  useWatchedRuns,
  visibleRuns,
  type CardTone,
} from "./floating";
import { openCiRun, useNow, type CiRun } from "./model";

export const CARD_W = 212;
export const CARD_H = 40;
const R = 9;
const STROKE = 2;
const GAP = 8;
/** Movement under this many px is a tap, not a drag. */
const SLOP = 4;

/** Length of the rounded-rect stroke the ring runs along. */
const PERIMETER = 2 * (CARD_W - STROKE + (CARD_H - STROKE)) - 8 * R + 2 * Math.PI * R;

const tint: Record<CardTone, string> = {
  run: color.cyan,
  ok: color.mint,
  fail: color.coral,
  cancel: color.faint,
};

/** Mounts the watch for `cwd` and floats its cards, stacked up from the bottom right. */
export function FloatingCiCards({ cwd }: { cwd: string }) {
  useCiRunWatch(cwd);
  const runs = useWatchedRuns(cwd);
  const dismissed = useFloatingCi((st) => st.dismissed);
  const shown = useMemo(() => visibleRuns(runs, dismissed).slice(0, 4), [runs, dismissed]);
  if (!shown.length) return null;
  return (
    <View style={s.layer} pointerEvents="box-none">
      {shown.map((run, i) => (
        <Card key={run.id} run={run} slot={i} />
      ))}
    </View>
  );
}

const Card = memo(function Card({ run, slot }: { run: CiRun; slot: number }) {
  const now = useNow(isRunActive(run), 1000);
  const face = cardFace(run, now);
  const saved = useFloatingCi((st) => st.offset[run.id]);
  const start = useRef(saved ?? { x: 0, y: 0 });
  start.current = saved ?? { x: 0, y: 0 };
  const pan = useRef(new Animated.ValueXY(start.current)).current;
  const [dragging, setDragging] = useState(false);
  const sx = saved?.x ?? 0;
  const sy = saved?.y ?? 0;
  useEffect(() => {
    if (!dragging) pan.setValue({ x: sx, y: sy });
  }, [pan, sx, sy, dragging]);
  const open = useCallback(() => {
    useUi.getState().setTool("prs");
    openCiRun(run.id);
  }, [run.id]);
  const dismiss = useCallback(() => dismissCiCard(run.id), [run.id]);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > SLOP,
        onPanResponderGrant: () => setDragging(true),
        onPanResponderMove: (_, g) =>
          pan.setValue({ x: start.current.x + g.dx, y: start.current.y + g.dy }),
        onPanResponderRelease: (_, g) => {
          moveCiCard(run.id, start.current.x + g.dx, start.current.y + g.dy);
          setDragging(false);
        },
        onPanResponderTerminate: () => setDragging(false),
      }),
    [pan, run.id],
  );
  const ring = tint[face.tone];
  const place = useMemo(
    () => [s.card, { bottom: slot * (CARD_H + GAP) }, dragging && s.lifted],
    [slot, dragging],
  );
  return (
    <Animated.View
      {...responder.panHandlers}
      style={[place, { transform: [...pan.getTranslateTransform(), ...(dragging ? LIFT : [])] }]}
      accessibilityLabel={`${face.title}, ${face.sub}`}
    >
      <Svg width={CARD_W} height={CARD_H} style={s.ring} pointerEvents="none">
        <Rect {...RECT} stroke={face.tone === "run" ? color.line2 : ring} />
        {face.tone === "run" && (
          <Rect
            {...RECT}
            stroke={ring}
            strokeLinecap="round"
            strokeDasharray={`${face.progress * PERIMETER} ${PERIMETER}`}
          />
        )}
      </Svg>
      <View style={s.in}>
        <View style={s.grip} accessibilityLabel="Drag">
          {GRIP.map((k) => (
            <View key={k} style={s.dot} />
          ))}
        </View>
        <Pressable onPress={open} style={s.text} accessibilityRole="button">
          <T numberOfLines={1} style={s.title}>
            {face.title}
          </T>
          <T numberOfLines={1} style={s.sub}>
            {face.sub}
          </T>
        </Pressable>
        {face.pct && <T style={[s.pct, { color: ring }]}>{face.pct}</T>}
        <Pressable
          onPress={dismiss}
          hitSlop={6}
          accessibilityLabel="Hide this CI card"
          style={s.press}
        >
          {({ hovered }) => (
            <View style={[s.x, hovered && s.xHover]}>
              <X size={12} color={hovered ? color.text : color.faint} />
            </View>
          )}
        </Pressable>
      </View>
    </Animated.View>
  );
});

const RECT = {
  x: STROKE / 2,
  y: STROKE / 2,
  width: CARD_W - STROKE,
  height: CARD_H - STROKE,
  rx: R,
  fill: "none",
  strokeWidth: STROKE,
} as const;
const GRIP = [0, 1, 2, 3, 4, 5];
const LIFT = [{ rotate: "-2deg" }, { scale: 1.03 }];

const s = StyleSheet.create({
  layer: { position: "absolute", right: 10, bottom: 10, width: CARD_W, zIndex: 30 },
  card: {
    position: "absolute",
    right: 0,
    width: CARD_W,
    height: CARD_H,
    borderRadius: R + 1,
    backgroundColor: alpha(color.raise, 0.94),
    shadowColor: color.shadow,
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    ...web({
      boxShadow: `0 8px 24px ${alpha(color.shadow, 0.5)}`,
      transition: `box-shadow 180ms ${ease}, opacity 180ms ease-out`,
      cursor: "grab",
      userSelect: "none",
    }),
  },
  lifted: {
    opacity: 0.95,
    shadowOpacity: 0.6,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 16 },
    ...web({ boxShadow: `0 16px 40px ${alpha(color.shadow, 0.6)}`, cursor: "grabbing" }),
  },
  ring: { position: "absolute", left: 0, top: 0 },
  in: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 6,
    paddingRight: 8,
    // Text sits a touch low so the ring on the top edge has room to breathe.
    paddingTop: 3,
  },
  grip: { width: 8, flexDirection: "row", flexWrap: "wrap", gap: 2, opacity: 0.7 },
  dot: { width: 2, height: 2, borderRadius: 1, backgroundColor: color.faint },
  text: { flex: 1, minWidth: 0, ...web({ cursor: "pointer" }) },
  title: { fontSize: 11, lineHeight: 13, color: color.text },
  sub: { fontFamily: font.mono, fontSize: 9, lineHeight: 12, marginTop: 1, color: color.muted },
  pct: { fontFamily: font.mono, fontSize: 9 },
  press: { ...web({ outlineStyle: "none" }) },
  x: {
    width: 18,
    height: 18,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    ...web({ transition: "background-color 120ms ease-out" }),
  },
  xHover: { backgroundColor: color.wash },
});
