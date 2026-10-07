import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Copy, Loader, Scissors } from "lucide-react-native";
import { Animated, Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { connect } from "../../daemon/store";
import { bucketOf, type Agent, type Bucket, type TimelineItem } from "../../daemon/types";
import { color, stateMotion, stateMs, stateWash, web } from "../../theme/tokens";
import { usePrefs } from "../../prefs";
import { useUi } from "../../ui-store";
import { Button } from "../Button";
import { Markdown } from "../Markdown";
import {
  Beam,
  isNative,
  NativeEnter,
  nativeEase,
  nativeMotionOn,
  NativePulse,
  type Pose,
} from "../nativeMotion";
import { reducedMotion, usePresence } from "../presence";
import { copyText } from "../shell/copy";
import { StatusGlyph } from "../StatusGlyph";
import { T } from "../Text";
import { toast, toastError } from "../toast/store";

/**
 * Visual treatment (lab compares them; the app uses the default):
 * - `edge`: kind wash + 3px leading edge bar + mono tag. Default: loudest at a glance in a
 *   scrolling timeline (the bar is visible from the corner of the eye), costs no extra height,
 *   and the left bar matches the toast and rail selection language.
 * - `bracket`: raised card with kind bracket corners and a mono tag header.
 * - `banner`: full-width wash with a 2px top trim, tag and title on one line.
 */
export type StateVariant = "edge" | "bracket" | "banner";
export const DEFAULT_STATE_VARIANT: StateVariant = "edge";

type Kind = "review" | "failed" | "offline";
const KIND: Record<Kind, { c: string; wash: string; tag: string; glyph: Bucket }> = {
  review: { c: color.mint, wash: stateWash.mint, tag: "READY", glyph: "review" },
  failed: { c: color.coral, wash: stateWash.coral, tag: "FAILED", glyph: "failed" },
  offline: { c: color.amber, wash: stateWash.amber, tag: "OFFLINE", glyph: "idle" },
};
const tint = Object.fromEntries(
  Object.entries(KIND).map(([k, { c, wash }]) => [
    k,
    StyleSheet.create({
      fg: { color: c },
      bg: { backgroundColor: c },
      line: { borderColor: c },
      wash: { backgroundColor: wash },
    }),
  ]),
) as Record<Kind, { fg: object; bg: object; line: object; wash: object }>;

const none = {};

const RISE: Pose = { opacity: 0, y: 8 };
const DRAW_X: Pose = { scaleX: 0 };
const DRAW_Y: Pose = { scaleY: 0 };
const SNAP: Pose = { opacity: 0, scale: 1.06 };

/** Fade + rise on mount: CSS keyframes on web, native-driver on device. */
function Rise({ live, style, children }: { live: boolean; style: object; children: ReactNode }) {
  if (!isNative) return <View style={[style, live && m.rise]}>{children}</View>;
  return (
    <NativeEnter on={live} from={RISE} ms={stateMs.in} style={style}>
      {children}
    </NativeEnter>
  );
}

/** Trim that draws in `trimDelay` after the card lands (bar, top rule or corner marks). */
function Trim({ variant, live, kind }: { variant: StateVariant; live: boolean; kind: Kind }) {
  const k = tint[kind];
  if (variant === "edge") {
    if (isNative)
      return (
        <NativeEnter
          on={live}
          from={DRAW_Y}
          anchor="start-y"
          ms={stateMs.trim}
          delay={stateMs.trimDelay}
          pointerEvents="none"
          style={[s.bar, k.bg]}
        />
      );
    return <View pointerEvents="none" style={[s.bar, k.bg, live && m.drawY]} />;
  }
  if (variant === "banner") {
    if (isNative)
      return (
        <NativeEnter
          on={live}
          from={DRAW_X}
          anchor="start-x"
          ms={stateMs.trim}
          delay={stateMs.trimDelay}
          pointerEvents="none"
          style={[s.top, s.trimTrack]}
        >
          <View style={[s.trimFill, k.bg]} />
        </NativeEnter>
      );
    return (
      <View pointerEvents="none" style={[s.top, s.trimTrack, live && m.drawX]}>
        <View style={[s.trimFill, k.bg]} />
      </View>
    );
  }
  const marks = (
    <>
      <View style={[s.cTL, k.line]} />
      <View style={[s.cBR, k.line]} />
    </>
  );
  if (isNative)
    return (
      <NativeEnter
        on={live}
        from={SNAP}
        ms={160}
        delay={stateMs.trimDelay}
        pointerEvents="none"
        style={s.corners}
      >
        {marks}
      </NativeEnter>
    );
  return (
    <View pointerEvents="none" style={[s.corners, live && m.corner]}>
      {marks}
    </View>
  );
}

/** Card frame for the end-of-timeline states. */
function Frame({
  kind,
  variant,
  children,
}: {
  kind: Kind;
  variant: StateVariant;
  children: ReactNode;
}) {
  const k = tint[kind];
  const live = useMemo(() => !reducedMotion(), []);
  const flash = live && kind === "failed" ? m.flash : none;
  const glow = live && kind === "review" ? m.glow : none;
  const head = (
    <View style={s.head}>
      <StatusGlyph bucket={KIND[kind].glyph} size={9} still />
      <T v="mono" style={[s.tag, k.fg]}>
        {KIND[kind].tag}
      </T>
    </View>
  );
  return (
    <Rise live={live} style={s.wrap}>
      <View style={[s.card, s[variant], k.wash, glow]}>
        <View pointerEvents="none" style={[s.flash, flash]} />
        {isNative && live && kind === "failed" && (
          <NativePulse peak={0.3} ms={stateMs.flash} delay={80} style={k.bg} />
        )}
        {isNative && live && kind === "review" && (
          <NativePulse peak={0.16} rise={315} ms={stateMs.glow} delay={80} style={s.glowRing} />
        )}
        <Trim variant={variant} live={live} kind={kind} />
        <View style={[s.body, variant === "edge" && s.bodyEdge]}>
          {head}
          {children}
        </View>
      </View>
    </Rise>
  );
}

const SAMPLE: Record<Kind, { title: string; detail: string; mono?: boolean }> = {
  review: { title: "Ready to review", detail: "Review the changes or send a follow-up below." },
  failed: {
    title: "Session failed",
    detail: "Error: provider exited with code 1",
    mono: true,
  },
  offline: {
    title: "Host offline",
    detail: "Showing the last received conversation. Reconnect before sending a message.",
  },
};

/** The real state card around static sample copy (Settings preview); remount replays entry. */
export function StatePreview({ kind }: { kind: Kind }) {
  const variant = usePrefs((st) => st.stateStyle);
  const x = SAMPLE[kind];
  return (
    <Frame kind={kind} variant={variant}>
      <Row title={x.title} detail={x.detail} mono={x.mono} />
    </Frame>
  );
}

/** Durable turn outcomes stay in the conversation, independent of transient toasts. */
export function SessionState({
  agent,
  online,
  variant: override,
}: {
  agent: Agent;
  online: boolean;
  variant?: StateVariant;
}) {
  const bucket = bucketOf(agent);
  const pref = usePrefs((st) => st.stateStyle);
  const variant = override ?? pref;
  const reconnect = useCallback(() => {
    void connect();
  }, []);
  const review = useCallback(() => useUi.getState().setTool("scm"), []);
  if (!online)
    return (
      <Frame kind="offline" variant={variant}>
        <Row
          title="Host offline"
          detail="Showing the last received conversation. Reconnect before sending a message."
        >
          <Button label="Reconnect" kind="primary" onPress={reconnect} />
        </Row>
      </Frame>
    );
  if (bucket === "review")
    return (
      <Frame kind="review" variant={variant}>
        <Row title="Ready to review" detail="Review the changes or send a follow-up below.">
          <Button label="Review changes" kind="primary" onPress={review} />
        </Row>
      </Frame>
    );
  if (bucket !== "failed") return null;
  return (
    <Frame kind="failed" variant={variant}>
      <Row
        title="Session failed"
        detail={
          agent.lastError || "The agent stopped with an error. Send a message below to continue."
        }
        mono={!!agent.lastError}
      />
    </Frame>
  );
}

function Row({
  title,
  detail,
  mono,
  children,
}: {
  title: string;
  detail: string;
  mono?: boolean;
  children?: ReactNode;
}) {
  return (
    <View style={s.row}>
      <View style={s.text}>
        <T style={s.title}>{title}</T>
        <T v={mono ? "mono" : "body"} style={[s.detail, mono && s.detailMono]}>
          {detail}
        </T>
      </View>
      {children}
    </View>
  );
}

const ktok = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));

function compactionLabel(item: Extract<TimelineItem, { type: "compaction" }>): string {
  if (item.status === "loading") return "Compacting context…";
  if (item.trigger === "auto") return "Context automatically compacted";
  if (item.trigger === "manual") return "Context manually compacted";
  if (item.preTokens) return `Context compacted (${ktok(item.preTokens)} tokens)`;
  return "Context compacted";
}

type Cut = NonNullable<Extract<TimelineItem, { type: "compaction" }>["cleanCut"]>;

function cutMeta(cut: Cut): string[] {
  const meta: string[] = [];
  if (cut.provider && cut.previousProvider && cut.provider !== cut.previousProvider)
    meta.push(`${cut.previousProvider} → ${cut.provider}`);
  if (cut.previousContextTokens) meta.push(`Replaced ${ktok(cut.previousContextTokens)} context`);
  const u = cut.summaryUsage;
  if (u) {
    const io = `Summary ${ktok(u.inputTokens ?? 0)} in / ${ktok(u.outputTokens ?? 0)} out`;
    meta.push(u.totalCostUsd != null ? `${io} · $${u.totalCostUsd.toFixed(2)}` : io);
  }
  return meta;
}

/** A solid cut line across the timeline (ported from apps/ui's CompactionMarker / CleanCutMarker). */
function CutLine({ tone, running }: { tone: "amber" | "plain"; running: boolean }) {
  const live = useMemo(() => !reducedMotion(), []);
  return (
    <View style={[s.cutLine, tone === "amber" ? s.cutAmber : s.cutPlain, running && s.cutRun]}>
      {running && live && isNative && <Beam color={color.cyan2} />}
      {running && live && !isNative && <View style={[s.beam, m.beam]} />}
    </View>
  );
}

/** Compaction / clean-cut divider: line, glyph + label, line; clean cuts add meta and summary. */
export function Compaction({ item }: { item: Extract<TimelineItem, { type: "compaction" }> }) {
  const [expanded, setExpanded] = useState(false);
  const fold = usePresence(expanded, stateMs.fold - 40);
  const expandedState = useMemo(() => ({ expanded }), [expanded]);
  const toggle = useCallback(() => setExpanded((v) => !v), []);
  const cut = item.cleanCut;
  const copyPrevious = useCallback(() => {
    if (!cut?.previousSessionId) return;
    void copyText(cut.previousSessionId).then((ok) => {
      if (ok) return toast({ title: "Conversation ID copied" });
      return toastError("Could not copy", "Clipboard is unavailable");
    });
  }, [cut?.previousSessionId]);
  const live = useMemo(() => !reducedMotion(), []);
  const running = item.status === "loading";
  const amber = !!cut;
  let title = compactionLabel(item);
  if (cut)
    title =
      cut.reason === "cold-cache"
        ? "Clean cut: cache expired, new conversation"
        : "Clean cut: new conversation";
  if (cut && running) title = "Making a clean cut…";
  const meta = cut ? cutMeta(cut) : [];
  const Glyph = running ? Loader : Scissors;
  return (
    <Rise live={live} style={s.cut}>
      <View style={s.divider}>
        <CutLine tone={amber ? "amber" : "plain"} running={running} />
        <View style={s.cutLabel}>
          <Glyph size={13} color={amber ? color.amber : color.muted} />
          <T v="mono" style={[s.cutTitle, amber && s.cutTitleAmber]}>
            {title}
          </T>
        </View>
        <CutLine tone={amber ? "amber" : "plain"} running={running} />
      </View>
      {cut && !running && (
        <View style={s.meta}>
          {meta.map((t) => (
            <T key={t} style={s.metaText}>
              {t}
            </T>
          ))}
          {cut.previousSessionId && (
            <Pressable
              onPress={copyPrevious}
              accessibilityRole="button"
              hitSlop={6}
              style={s.metaBtn}
            >
              <Copy size={12} color={color.muted} />
              <T style={s.metaText}>Copy previous conversation ID</T>
            </Pressable>
          )}
          {cut.summary && (
            <Pressable
              onPress={toggle}
              accessibilityRole="button"
              accessibilityState={expandedState}
              hitSlop={6}
              style={s.metaBtn}
            >
              <View style={[s.chev, expanded && s.chevOpen]}>
                <ChevronRight size={12} color={color.muted} />
              </View>
              <T style={s.metaText}>
                {cut.summaryModel
                  ? `Summary sent to the agent (${cut.summaryModel})`
                  : "Summary sent to the agent"}
              </T>
            </Pressable>
          )}
        </View>
      )}
      {cut?.summary && isNative && (
        <Unfold open={expanded}>
          <Markdown text={cut.summary} />
        </Unfold>
      )}
      {cut?.summary && !isNative && fold.mounted && (
        <View style={[s.summary, live && (fold.closing ? m.fold : m.unfold)]}>
          <Markdown text={cut.summary} />
        </View>
      )}
    </Rise>
  );
}

/** Native summary unfold/fold: height and opacity on the JS driver (height cannot be native). */
function Unfold({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [full, setFull] = useState(0);
  const p = useRef(new Animated.Value(0)).current;
  const onLayout = useCallback((e: LayoutChangeEvent) => setFull(e.nativeEvent.layout.height), []);
  useEffect(() => {
    if (open) setMounted(true);
    if (!nativeMotionOn()) {
      p.setValue(open ? 1 : 0);
      if (!open) setMounted(false);
      return undefined;
    }
    if (open && !full) return undefined;
    const a = Animated.timing(p, {
      toValue: open ? 1 : 0,
      duration: open ? stateMs.fold : stateMs.fold - 40,
      easing: open ? nativeEase.out : nativeEase.exit,
      useNativeDriver: false,
    });
    a.start(({ finished }) => {
      if (finished && !open) setMounted(false);
    });
    return () => a.stop();
  }, [open, full, p]);
  const clip = useMemo(
    () =>
      full
        ? { height: p.interpolate({ inputRange: [0, 1], outputRange: [0, full] }), opacity: p }
        : { opacity: p },
    [p, full],
  );
  if (!mounted) return null;
  return (
    <Animated.View style={[s.unfold, clip]}>
      <View style={s.summary} onLayout={onLayout}>
        {children}
      </View>
    </Animated.View>
  );
}

const corner = { position: "absolute" as const, width: 10, height: 10 };

// RN-web only compiles `animationKeyframes` that go through StyleSheet.create.
const m = StyleSheet.create({
  rise: stateMotion.rise,
  drawX: { ...stateMotion.drawX, ...web({ transformOrigin: "left center" }) },
  drawY: { ...stateMotion.drawY, ...web({ transformOrigin: "center top" }) },
  corner: stateMotion.corner,
  flash: stateMotion.flash,
  glow: stateMotion.glow,
  beam: stateMotion.beam,
  unfold: { ...stateMotion.unfold, ...web({ overflow: "hidden" }) },
  fold: { ...stateMotion.fold, ...web({ overflow: "hidden" }) },
});

const s = StyleSheet.create({
  wrap: { marginTop: 18 },
  card: { position: "relative", overflow: "hidden" },
  edge: {},
  bar: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3 },
  bracket: { borderWidth: 1, borderColor: color.line2, overflow: "visible" },
  banner: { borderBottomWidth: 1, borderBottomColor: color.line },
  flash: { ...StyleSheet.absoluteFillObject },
  body: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12, gap: 6 },
  bodyEdge: { paddingLeft: 17 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  tag: { fontSize: 10, letterSpacing: 1.6, fontWeight: "600" },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
  text: { flex: 1, minWidth: 180 },
  title: { fontSize: 14, fontWeight: "600", color: color.text },
  detail: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: 2 },
  detailMono: { fontSize: 11.5, color: color.text },
  cut: { marginTop: 18, paddingVertical: 14, gap: 8 },
  divider: { flexDirection: "row", alignItems: "center", gap: 12 },
  cutLine: { flex: 1, height: 2, overflow: "hidden" },
  cutAmber: { backgroundColor: color.amber, opacity: 0.6 },
  cutPlain: { backgroundColor: color.line2, height: 1 },
  cutRun: { height: 2, opacity: 1 },
  cutLabel: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  cutTitle: { fontSize: 12, color: color.muted, letterSpacing: 0.3 },
  cutTitleAmber: { color: color.amber, fontWeight: "600" },
  meta: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    columnGap: 16,
    rowGap: 4,
  },
  metaBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 12, color: color.muted },
  chev: { ...web({ transition: `transform ${stateMs.fold}ms` }) },
  chevOpen: { transform: [{ rotate: "90deg" }] },
  unfold: { marginTop: 4, overflow: "hidden" },
  glowRing: { backgroundColor: color.mint, borderWidth: 1, borderColor: color.mint },
  summary: {
    marginTop: 4,
    padding: 12,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.panel,
  },
  top: { position: "absolute", left: 0, right: 0, top: 0, height: 2 },
  trimTrack: { overflow: "hidden" },
  trimFill: { ...StyleSheet.absoluteFillObject },
  beam: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: "25%",
    ...web({ backgroundImage: `linear-gradient(90deg, transparent, ${color.cyan2}, transparent)` }),
  },
  corners: { ...StyleSheet.absoluteFillObject },
  cTL: { ...corner, left: -1, top: -1, borderLeftWidth: 2, borderTopWidth: 2 },
  cBR: { ...corner, right: -1, bottom: -1, borderRightWidth: 2, borderBottomWidth: 2 },
});
