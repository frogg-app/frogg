import { Check, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Polygon } from "react-native-svg";
import { useDaemon } from "../../daemon/store";
import { bucketOf, type Bucket } from "../../daemon/types";
import { useFormFactor } from "../../theme/layout";
import { color, glide, toastMotion, toastMs, web } from "../../theme/tokens";
import { usePrefs } from "../../prefs";
import { useUi } from "../../ui-store";
import { Cut } from "../Cut";
import { isNative, NativeDrain, NativeEnter, type Pose } from "../nativeMotion";
import { StatusGlyph } from "../StatusGlyph";
import { T } from "../Text";
import {
  dismissToast,
  pauseToasts,
  resumeToasts,
  toast,
  toastsAnimate,
  useToasts,
  type Toast,
  type ToastKind,
  type ToastVariant,
} from "./store";

const glyph: Record<Exclude<ToastKind, "ok">, Bucket> = {
  done: "review",
  error: "failed",
  needs: "needs",
  info: "working",
};

const KIND: Record<ToastKind, { c: string; tag: string }> = {
  ok: { c: color.mint, tag: "OK" },
  done: { c: color.mint, tag: "DONE" },
  error: { c: color.coral, tag: "ERROR" },
  needs: { c: color.amber, tag: "NEEDS YOU" },
  info: { c: color.cyan, tag: "INFO" },
};

/** Per-kind tint styles, built once. */
const tint = Object.fromEntries(
  Object.entries(KIND).map(([k, { c }]) => [
    k,
    StyleSheet.create({
      fg: { color: c },
      bg: { backgroundColor: c },
      line: { borderColor: c },
    }),
  ]),
) as Record<ToastKind, { fg: object; bg: object; line: object }>;

const curve = Easing.bezier(...glide.curve);
const GAP = 8;
const NONE = {};

/**
 * Bottom-right stack of transient toasts (bottom, full width on phones). Also turns session
 * status changes on sessions you are not looking at into toasts. Mount once, above the shell.
 * `variant` overrides the store's (the lab switches the store; the shell uses the default).
 */
export function ToastHost({ variant }: { variant?: ToastVariant }) {
  const toasts = useToasts((st) => st.toasts);
  const paused = useToasts((st) => st.paused);
  const chosen = useToasts((st) => st.variant);
  const pref = usePrefs((st) => st.toastStyle);
  const phone = useFormFactor() === "phone";
  const insets = useSafeAreaInsets();
  useSessionToasts();
  const pad = useMemo(() => ({ bottom: phone ? insets.bottom + 72 : 36 }), [phone, insets.bottom]);
  if (toasts.length === 0) return null;
  return (
    <View
      style={[s.box, phone ? s.phone : s.wide, pad]}
      pointerEvents="box-none"
      onPointerEnter={pauseToasts}
      onPointerLeave={resumeToasts}
    >
      {toasts.map((t) => (
        <Slot key={t.id} t={t} phone={phone} variant={variant ?? chosen ?? pref} paused={paused} />
      ))}
    </View>
  );
}

interface RowProps {
  t: Toast;
  phone: boolean;
  variant: ToastVariant;
  paused: boolean;
}

/**
 * The toast's place in the stack. Its height opens on arrival and closes on exit over
 * `toastMs.reflow` on the glide curve, so the rest of the stack slides rather than jumps.
 */
function Slot(props: RowProps) {
  const { t } = props;
  const h = useRef(new Animated.Value(0)).current;
  const natural = useRef(0);
  const [measured, setMeasured] = useState(false);
  const live = toastsAnimate();
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const nh = e.nativeEvent.layout.height;
      if (nh === natural.current || t.leaving) return;
      const first = natural.current === 0;
      natural.current = nh;
      if (first && live) {
        Animated.timing(h, {
          toValue: nh,
          duration: toastMs.reflow,
          easing: curve,
          useNativeDriver: false,
        }).start();
      } else h.setValue(nh);
      setMeasured(true);
    },
    [h, live, t.leaving],
  );
  useEffect(() => {
    if (!t.leaving || !live) return;
    Animated.timing(h, {
      toValue: 0,
      duration: toastMs.reflow,
      easing: curve,
      useNativeDriver: false,
    }).start();
  }, [t.leaving, live, h]);
  const slotH = useMemo(() => ({ height: h }), [h]);
  return (
    <Animated.View
      style={[s.slot, measured ? slotH : live && s.unmeasured]}
      testID={`toast-${t.id}`}
    >
      <View style={s.inner} onLayout={onLayout}>
        <Card {...props} live={live} />
      </View>
    </Animated.View>
  );
}

function Card({ t, phone, variant, paused, live }: RowProps & { live: boolean }) {
  const close = useCallback(() => dismissToast(t.id), [t.id]);
  const act = useCallback(() => {
    dismissToast(t.id);
    t.action?.onPress();
  }, [t]);
  let move: object = NONE;
  if (live) {
    if (t.leaving) move = phone ? m.outDown : m.outSide;
    else move = phone ? m.inUp : m.inSide;
  }
  let drain: ReactNode = null;
  if (!t.sticky && isNative)
    drain = live ? (
      <NativeDrain ms={toastMs.life} paused={paused} style={[s.drain, tint[t.kind].bg]} />
    ) : (
      <View pointerEvents="none" style={[s.drain, tint[t.kind].bg]} />
    );
  else if (!t.sticky)
    drain = (
      <View
        pointerEvents="none"
        style={[s.drain, tint[t.kind].bg, live && m.drain, paused && s.held]}
      />
    );
  const mover = { move, live, phone, leaving: !!t.leaving };
  const parts = { t, close, act, drain, snap: live && !t.leaving, mover };
  if (variant === "hud") return <Hud {...parts} />;
  if (variant === "facet") return <Facet {...parts} />;
  return <Bracket {...parts} />;
}

interface Parts {
  t: Toast;
  close: () => void;
  act: () => void;
  drain: ReactNode;
  snap: boolean;
  mover: MoverProps;
}

interface MoverProps {
  move: object;
  live: boolean;
  phone: boolean;
  leaving: boolean;
}

const SIDE_IN: Pose = { opacity: 0, x: 28 };
const SIDE_OUT: Pose = { opacity: 0, x: 24 };
const UP_IN: Pose = { opacity: 0, y: 18 };
const UP_OUT: Pose = { opacity: 0, y: 12 };
const SNAP: Pose = { opacity: 0, scale: 1.9 };

/** Card enter/exit: CSS keyframes on web, native-driver slide + fade elsewhere. */
function Mover({
  move,
  live,
  phone,
  leaving,
  style,
  children,
}: MoverProps & { style?: object | object[]; children: ReactNode }) {
  if (!isNative) return <View style={[style, move]}>{children}</View>;
  return (
    <NativeEnter
      on={live}
      from={phone ? UP_IN : SIDE_IN}
      exit={phone ? UP_OUT : SIDE_OUT}
      leaving={leaving}
      ms={toastMs.in}
      exitMs={toastMs.out}
      style={style}
    >
      {children}
    </NativeEnter>
  );
}

/** Corner marks / gem: scale-and-fade snap `cornerDelay` after the card lands. */
function Snapper({ on, style, children }: { on: boolean; style: object; children: ReactNode }) {
  if (!isNative)
    return (
      <View pointerEvents="none" style={[style, on && m.corner]}>
        {children}
      </View>
    );
  return (
    <NativeEnter
      on={on}
      from={SNAP}
      ms={160}
      delay={toastMs.cornerDelay}
      pointerEvents="none"
      style={style}
    >
      {children}
    </NativeEnter>
  );
}

function Icon({ kind }: { kind: ToastKind }) {
  if (kind === "ok") return <Check size={12} color={color.mint} />;
  return <StatusGlyph bucket={glyph[kind]} size={7} still />;
}

function Close({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityLabel="Dismiss" style={s.x}>
      <X size={12} color={color.faint} />
    </Pressable>
  );
}

function Body({ t, mono }: { t: Toast; mono?: boolean }) {
  return (
    <>
      <T style={s.title} numberOfLines={3}>
        {t.title}
      </T>
      {t.detail && (
        <T v={mono ? "mono" : "body"} style={[s.detail, mono && s.detailMono]} numberOfLines={4}>
          {t.detail}
        </T>
      )}
    </>
  );
}

// ---- A: chamfered card, kind bracket corners, edge bar, mono tag ----

function Bracket({ t, close, act, drain, snap, mover }: Parts) {
  const k = tint[t.kind];
  return (
    <Mover {...mover}>
      <Cut size={10} flip style={[s.card, s.cardA]}>
        <View style={[s.edge, k.bg]} />
        <Snapper on={snap} style={s.corners}>
          <View style={[s.cTL, k.line]} />
          <View style={[s.cBR, k.line]} />
        </Snapper>
        <View style={s.bodyA}>
          <View style={s.head}>
            <Icon kind={t.kind} />
            <T v="label" style={[s.tag, k.fg]}>
              {KIND[t.kind].tag}
            </T>
            <View style={s.spacer} />
            <Close onPress={close} />
          </View>
          <Body t={t} />
          {t.action && (
            <Pressable onPress={act} hitSlop={6} style={s.actA}>
              <T style={[s.actT, k.fg]}>{t.action.label} →</T>
            </Pressable>
          )}
        </View>
        {drain}
      </Cut>
    </Mover>
  );
}

// ---- B: HUD frame, corner ticks, mono header, grid texture ----

const pad2 = (n: number) => String(n).padStart(2, "0");
function clock(at: number) {
  const d = new Date(at);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function Hud({ t, close, act, drain, snap, mover }: Parts) {
  const k = tint[t.kind];
  return (
    <Mover {...mover} style={[s.card, s.hud]}>
      <Snapper on={snap} style={s.ticks}>
        <View style={[s.tTL, k.line]} />
        <View style={s.tTR} />
        <View style={s.tBL} />
        <View style={s.tBR} />
      </Snapper>
      <View style={s.hudHead}>
        <View style={[s.dot, k.bg]} />
        <T v="mono" style={[s.hudTag, k.fg]}>
          {KIND[t.kind].tag}
        </T>
        <T v="mono" style={s.hudMeta} numberOfLines={1}>
          {clock(t.at)} · {t.source ?? t.id}
        </T>
        <View style={s.spacer} />
        <Close onPress={close} />
      </View>
      <View style={s.rule} />
      <View style={s.bodyB}>
        <Body t={t} mono />
        {t.action && (
          <Pressable onPress={act} hitSlop={6} style={s.actB}>
            <T v="mono" style={[s.actBT, k.fg]}>
              [ {t.action.label.toUpperCase()} ]
            </T>
          </Pressable>
        )}
      </View>
      {drain}
    </Mover>
  );
}

// ---- C: faceted, triangle mesh at the leading edge, gem glyph ----

/** Triangle strip after the frogg.dev hero mesh: denser and brighter at the outer edge. */
const MESH: { p: string; o: number }[] = [
  { p: "0,0 14,0 0,12", o: 0.55 },
  { p: "14,0 0,12 16,18", o: 0.32 },
  { p: "14,0 30,0 16,18", o: 0.2 },
  { p: "30,0 16,18 36,14", o: 0.1 },
  { p: "0,12 16,18 0,30", o: 0.42 },
  { p: "16,18 0,30 18,34", o: 0.24 },
  { p: "16,18 36,14 18,34", o: 0.12 },
  { p: "0,30 18,34 0,48", o: 0.5 },
  { p: "18,34 0,48 14,52", o: 0.28 },
  { p: "18,34 36,40 14,52", o: 0.1 },
  { p: "0,48 14,52 0,64", o: 0.38 },
  { p: "14,52 0,64 22,64", o: 0.18 },
];

function Mesh({ c }: { c: string }) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 40 64" preserveAspectRatio="none">
      {MESH.map((m) => (
        <Polygon key={m.p} points={m.p} fill={c} opacity={m.o} />
      ))}
    </Svg>
  );
}

function Gem({ c }: { c: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24">
      <Polygon points="12,1 22,7 22,17 12,23 2,17 2,7" fill={c} />
      <Polygon points="12,1 22,7 12,12" fill="#ffffff" opacity={0.32} />
      <Polygon points="2,17 12,12 12,23" fill="#000000" opacity={0.3} />
    </Svg>
  );
}

function Facet({ t, close, act, drain, snap, mover }: Parts) {
  const k = tint[t.kind];
  const c = KIND[t.kind].c;
  return (
    <Mover {...mover}>
      <Cut size={10} flip style={[s.card, s.cardC]}>
        <View pointerEvents="none" style={s.mesh}>
          <Mesh c={c} />
        </View>
        <Snapper on={snap} style={s.gem}>
          <Gem c={c} />
        </Snapper>
        <View style={s.bodyC}>
          <Body t={t} />
          <View style={s.footC}>
            <T v="label" style={[s.tagC, k.fg]}>
              {KIND[t.kind].tag}
            </T>
            {t.action && (
              <Pressable onPress={act} hitSlop={6}>
                <T style={[s.actT, k.fg]}>{t.action.label} →</T>
              </Pressable>
            )}
          </View>
        </View>
        <Close onPress={close} />
        {drain}
      </Cut>
    </Mover>
  );
}

const verdict: Partial<Record<Bucket, { kind: ToastKind; text: string }>> = {
  review: { kind: "done", text: "is ready" },
  failed: { kind: "error", text: "failed" },
  needs: { kind: "needs", text: "needs you" },
};

/** Status transitions on background sessions become toasts with an Open action. */
function useSessionToasts() {
  const sessions = useDaemon((st) => st.sessions);
  const url = useDaemon((st) => st.url);
  const seen = useRef<Map<string, Bucket> | null>(null);
  const host = useRef(url);
  useEffect(() => {
    if (host.current !== url || !seen.current) {
      // First sight of a host's sessions is a baseline, not news.
      host.current = url;
      seen.current = null;
    }
    const next = new Map<string, Bucket>();
    for (const sess of Object.values(sessions)) {
      const b = bucketOf(sess.agent);
      next.set(sess.agent.id, b);
      const was = seen.current?.get(sess.agent.id);
      if (!seen.current || was === undefined || was === b) continue;
      const v = verdict[b];
      if (!v || useUi.getState().selected === sess.agent.id) continue;
      const id = sess.agent.id;
      toast({
        title: `${sess.agent.title || "Untitled session"} ${v.text}`,
        detail: sess.agent.lastError ?? undefined,
        kind: v.kind,
        source: id.slice(0, 8),
        action: { label: "Open", onPress: () => openSession(id) },
      });
    }
    seen.current = next;
  }, [sessions, url]);
}

function openSession(id: string) {
  const ui = useUi.getState();
  ui.setTool("sessions");
  ui.select(id);
}

const tick = { position: "absolute" as const, width: 6, height: 6, borderColor: color.muted };
const corner = { position: "absolute" as const, width: 9, height: 9 };

// RN-web only compiles `animationKeyframes` that go through StyleSheet.create.
const m = StyleSheet.create({
  inSide: toastMotion.inSide,
  inUp: toastMotion.inUp,
  outSide: toastMotion.outSide,
  outDown: toastMotion.outDown,
  corner: toastMotion.corner,
  drain: toastMotion.drain,
});

const s = StyleSheet.create({
  box: { position: "absolute", zIndex: 50 },
  wide: { right: 16, width: 380 },
  phone: { left: 10, right: 10 },
  slot: { ...web({ overflow: "visible" }) },
  // Holds no space until measured, so the stack does not jump for a frame before gliding.
  unmeasured: { height: 0 },
  inner: { paddingTop: GAP },
  card: { ...web({ boxShadow: `0 14px 34px ${color.scrim}` }) },
  spacer: { flex: 1 },
  x: { padding: 2 },
  title: { fontSize: 13, fontWeight: "500", lineHeight: 18 },
  detail: { fontSize: 11.5, color: color.faint, marginTop: 3, lineHeight: 16 },
  detailMono: { fontSize: 11, color: color.muted },
  actT: { fontSize: 12.5, fontWeight: "500" },
  drain: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 1.5,
    opacity: 0.85,
    ...web({ transformOrigin: "left center" }),
  },
  held: { ...web({ animationPlayState: "paused" }) },

  // A
  cardA: { backgroundColor: color.raise, borderWidth: 1, borderColor: color.line2 },
  edge: { position: "absolute", left: 0, top: 10, bottom: 10, width: 2 },
  corners: { ...StyleSheet.absoluteFillObject },
  cTL: { ...corner, left: -1, top: -1, borderLeftWidth: 1.5, borderTopWidth: 1.5 },
  cBR: { ...corner, right: -1, bottom: -1, borderRightWidth: 1.5, borderBottomWidth: 1.5 },
  bodyA: { paddingLeft: 16, paddingRight: 12, paddingTop: 9, paddingBottom: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 5 },
  tag: { fontSize: 9.5, letterSpacing: 1.6 },
  actA: { alignSelf: "flex-start", marginTop: 8 },

  // B
  hud: {
    backgroundColor: color.panel,
    borderWidth: 1,
    borderColor: color.line2,
    ...web({
      backgroundImage: [
        "repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 3px)",
        "linear-gradient(rgba(37,181,200,0.05) 1px, transparent 1px)",
        "linear-gradient(90deg, rgba(37,181,200,0.05) 1px, transparent 1px)",
      ].join(", "),
      backgroundSize: "100% 3px, 16px 16px, 16px 16px",
    }),
  },
  ticks: { position: "absolute", left: -4, right: -4, top: -4, bottom: -4 },
  tTL: { ...tick, left: 0, top: 0, borderLeftWidth: 1, borderTopWidth: 1 },
  tTR: { ...tick, right: 0, top: 0, borderRightWidth: 1, borderTopWidth: 1 },
  tBL: { ...tick, left: 0, bottom: 0, borderLeftWidth: 1, borderBottomWidth: 1 },
  tBR: { ...tick, right: 0, bottom: 0, borderRightWidth: 1, borderBottomWidth: 1 },
  hudHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  dot: { width: 5, height: 5 },
  hudTag: { fontSize: 10.5, letterSpacing: 1.2, fontWeight: "600" },
  hudMeta: { fontSize: 10.5, color: color.faint, flexShrink: 1 },
  rule: { height: 1, backgroundColor: color.line },
  bodyB: { paddingHorizontal: 12, paddingTop: 9, paddingBottom: 12 },
  actB: { alignSelf: "flex-start", marginTop: 8 },
  actBT: { fontSize: 11, letterSpacing: 1 },

  // C
  cardC: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: color.raise,
    borderWidth: 1,
    borderColor: color.line2,
    paddingRight: 12,
  },
  mesh: { position: "absolute", left: 0, top: 0, bottom: 0, width: 46 },
  gem: { width: 46, paddingLeft: 12, paddingTop: 12 },
  bodyC: { flex: 1, paddingTop: 10, paddingBottom: 12, paddingRight: 8 },
  footC: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 7 },
  tagC: { fontSize: 9.5, letterSpacing: 1.6 },
});
