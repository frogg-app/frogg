import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { color, glide } from "../theme/tokens";

/**
 * Selection brackets with a slide + lock-on.
 *
 * Every row of a list renders `<Brackets on={selected} />` inside one `<BracketScope>`. The scope
 * remembers which instance holds the selection; when another row turns on it measures the
 * outgoing set's current on-screen box (mid-flight included), starts its own corners there and
 * travels to its row held slightly outside it (`OUT` px, dimmed), then contracts onto the row
 * with a small overshoot at full brightness. Each set is drawn inside its own row, so scrolling,
 * resizes and differing row heights need no bookkeeping. Without a scope, or when the old row
 * can't be measured, the brackets lock on in place. Clearing contracts and fades.
 */

/** Travel to the new row on the shared `glide` curve. */
export const TRAVEL_MS = 170;
/** Contract onto the row with a slight overshoot. */
export const LOCK_MS = 80;
/** Lock on in place (first selection, or the old row isn't measurable). */
export const IN_PLACE_MS = 140;
/** Clear: contract inward and fade. */
export const CLEAR_MS = 120;
/** How far outside the row the corners ride while travelling. */
const OUT = 5;
const TRAVEL_OPACITY = 0.6;

const travelCurve = Easing.bezier(...glide.curve);
const lockCurve = Easing.out(Easing.back(2.2));
const clearCurve = Easing.in(Easing.quad);

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** On-screen box of a view, or null when it isn't laid out. */
function measure(node: View | null, done: (b: Box | null) => void) {
  if (!node) return done(null);
  node.measureInWindow((x, y, w, h) => done(w || h ? { x, y, w, h } : null));
}

interface Holder {
  /** Current on-screen box of the visible corners, or null if not measurable. */
  box: (done: (b: Box | null) => void) => void;
  /** Hide immediately (another row took the selection). */
  hand: () => void;
}

interface Scope {
  current: Holder | null;
}

const ScopeCtx = createContext<Scope | null>(null);

/** One per list: brackets inside slide between rows instead of fading. */
export function BracketScope({ children }: { children: ReactNode }) {
  const scope = useMemo<Scope>(() => ({ current: null }), []);
  return <ScopeCtx.Provider value={scope}>{children}</ScopeCtx.Provider>;
}

let reduce = false;
void AccessibilityInfo.isReduceMotionEnabled()
  .then((r) => {
    reduce = r;
    return r;
  })
  .catch(() => undefined);
AccessibilityInfo.addEventListener?.("reduceMotionChanged", (r) => {
  reduce = r;
});

// Brackets render in a handful of colours and sizes; build each corner set once.
const bracketCache = new Map<string, ViewStyle[]>();
function bracketCorners(c: string, len: number): ViewStyle[] {
  const key = `${c}:${len}`;
  let corners = bracketCache.get(key);
  if (!corners) {
    const b = { position: "absolute" as const, width: len, height: len, borderColor: c };
    const st = StyleSheet.create({
      tl: { ...b, left: 0, top: 0, borderLeftWidth: 1, borderTopWidth: 1 },
      tr: { ...b, right: 0, top: 0, borderRightWidth: 1, borderTopWidth: 1 },
      bl: { ...b, left: 0, bottom: 0, borderLeftWidth: 1, borderBottomWidth: 1 },
      br: { ...b, right: 0, bottom: 0, borderRightWidth: 1, borderBottomWidth: 1 },
    });
    corners = [st.tl, st.tr, st.bl, st.br];
    bracketCache.set(key, corners);
  }
  return corners;
}

const CORNERS = ["tl", "tr", "bl", "br"];

/** Animated.Value whose latest value is readable synchronously (for retargeting mid-flight). */
function useTracked(init: number) {
  return useMemo(() => {
    const v = new Animated.Value(init);
    const last = { n: init };
    v.addListener(({ value }) => {
      last.n = value;
    });
    const set = (n: number) => {
      last.n = n;
      v.setValue(n);
    };
    return { v, last, set };
  }, [init]);
}

/**
 * Corner brackets framing the selected item, the signature of this design.
 * `on` defaults to true so decorative uses (`<Brackets />`) lock on when they mount.
 */
export function Brackets({
  c = color.cyan2,
  len = 8,
  on = true,
}: {
  c?: string;
  len?: number;
  on?: boolean;
}) {
  const scope = useContext(ScopeCtx);
  const corners = bracketCorners(c, len);
  const anchor = useRef<View>(null);
  const l = useTracked(0);
  const t = useTracked(0);
  const r = useTracked(0);
  const b = useTracked(0);
  const op = useTracked(0);
  const anim = useRef<Animated.CompositeAnimation | null>(null);

  const holder = useMemo<Holder>(
    () => ({
      box: (done) => {
        if (op.last.n <= 0.01) return done(null);
        measure(anchor.current, (m) =>
          done(
            m && {
              x: m.x + l.last.n,
              y: m.y + t.last.n,
              w: m.w - l.last.n - r.last.n,
              h: m.h - t.last.n - b.last.n,
            },
          ),
        );
      },
      hand: () => {
        anim.current?.stop();
        op.set(0);
      },
    }),
    [l, t, r, b, op],
  );

  useLayoutEffect(() => {
    const stop = () => anim.current?.stop();
    const all = [l, t, r, b];
    const run = (a: Animated.CompositeAnimation) => {
      stop();
      anim.current = a;
      a.start();
    };
    const to_ = (v: { v: Animated.Value }, n: number, ms: number, easing: (x: number) => number) =>
      Animated.timing(v.v, { toValue: n, duration: ms, easing, useNativeDriver: false });
    const clear = () => {
      if (reduce || op.last.n <= 0.01) {
        stop();
        op.set(0);
        return;
      }
      run(
        Animated.parallel([
          ...all.map((v) => to_(v, 2, CLEAR_MS, clearCurve)),
          to_(op, 0, CLEAR_MS, clearCurve),
        ]),
      );
    };
    const lock = (ms = LOCK_MS) =>
      Animated.parallel([
        ...all.map((v) => to_(v, 0, ms, lockCurve)),
        to_(op, 1, ms, Easing.linear),
      ]);

    if (!on) {
      if (!scope) return clear();
      // A sibling turning on in this same commit takes over (and hides us once it has measured
      // our box); only when nobody has by the end of the commit is the selection cleared.
      let live = true;
      queueMicrotask(() => {
        if (!live || scope.current !== holder) return;
        scope.current = null;
        clear();
      });
      return () => {
        live = false;
      };
    }

    const prev = scope?.current;
    if (scope) scope.current = holder;
    if (reduce) {
      stop();
      all.forEach((v) => v.set(0));
      op.set(1);
      prev?.hand();
      return;
    }
    // In-place lock-on: appear just outside the row, then contract onto it.
    const inPlace = () => {
      all.forEach((v) => v.set(-OUT));
      op.set(0);
      run(lock(IN_PLACE_MS));
    };
    if (!prev || prev === holder) {
      inPlace();
      return;
    }
    // Hold invisible until both boxes are measured, then travel from the old box.
    const go = (from: Box | null, to: Box | null) => {
      if (scope?.current !== holder) return;
      if (!from || !to) return inPlace();
      l.set(from.x - to.x);
      t.set(from.y - to.y);
      r.set(to.x + to.w - (from.x + from.w));
      b.set(to.y + to.h - (from.y + from.h));
      op.set(TRAVEL_OPACITY);
      run(
        Animated.sequence([
          Animated.parallel(all.map((v) => to_(v, -OUT, TRAVEL_MS, travelCurve))),
          lock(),
        ]),
      );
    };
    stop();
    op.set(0);
    prev.box((from) => {
      prev.hand();
      measure(anchor.current, (to) => go(from, to));
    });
  }, [on, scope, holder, l, t, r, b, op]);

  const animated = useMemo(
    () => ({ left: l.v, top: t.v, right: r.v, bottom: b.v, opacity: op.v }),
    [l, t, r, b, op],
  );

  useEffect(
    () => () => {
      anim.current?.stop();
      if (scope?.current === holder) scope.current = null;
    },
    [scope, holder],
  );

  return (
    <View ref={anchor} collapsable={false} pointerEvents="none" style={s.anchor}>
      <Animated.View pointerEvents="none" style={[s.set, animated]}>
        {corners.map((st, n) => (
          <View key={CORNERS[n]} style={st} />
        ))}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  anchor: { ...StyleSheet.absoluteFillObject, zIndex: 2 },
  set: { position: "absolute" },
});
