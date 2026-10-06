import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, Copy, Loader, Scissors } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { connect } from "../../daemon/store";
import { bucketOf, type Agent, type Bucket, type TimelineItem } from "../../daemon/types";
import { color, stateMotion, stateMs, stateWash, web } from "../../theme/tokens";
import { useUi } from "../../ui-store";
import { Button } from "../Button";
import { Markdown } from "../Markdown";
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
  let trim: ReactNode;
  if (variant === "edge")
    trim = <View pointerEvents="none" style={[s.bar, k.bg, live && m.drawY]} />;
  else if (variant === "banner")
    trim = (
      <View pointerEvents="none" style={[s.top, s.trimTrack, live && m.drawX]}>
        <View style={[s.trimFill, k.bg]} />
      </View>
    );
  else
    trim = (
      <View pointerEvents="none" style={[s.corners, live && m.corner]}>
        <View style={[s.cTL, k.line]} />
        <View style={[s.cBR, k.line]} />
      </View>
    );
  return (
    <View style={[s.wrap, live && m.rise]}>
      <View style={[s.card, s[variant], k.wash, glow]}>
        <View pointerEvents="none" style={[s.flash, flash]} />
        {trim}
        <View style={[s.body, variant === "edge" && s.bodyEdge]}>
          {head}
          {children}
        </View>
      </View>
    </View>
  );
}

/** Durable turn outcomes stay in the conversation, independent of transient toasts. */
export function SessionState({
  agent,
  online,
  variant = DEFAULT_STATE_VARIANT,
}: {
  agent: Agent;
  online: boolean;
  variant?: StateVariant;
}) {
  const bucket = bucketOf(agent);
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
      {running && live && <View style={[s.beam, m.beam]} />}
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
    <View style={[s.cut, live && m.rise]}>
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
      {cut?.summary && fold.mounted && (
        <View style={[s.summary, live && (fold.closing ? m.fold : m.unfold)]}>
          <Markdown text={cut.summary} />
        </View>
      )}
    </View>
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
