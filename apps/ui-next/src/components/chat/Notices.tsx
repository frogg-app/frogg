import { isPromptCacheCold } from "@frogg/protocol/prompt-cache";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useConfig } from "../../daemon/config";
import type { Agent } from "../../daemon/types";
import { color, motion, stateMotion, web } from "../../theme/tokens";
import { reducedMotion } from "../presence";
import { StatusGlyph } from "../StatusGlyph";
import { T } from "../Text";
import { toastError } from "../toast/store";
import { cancelAutoResume, cleanCut, hasFeature } from "./actions";
import { dropQueued, sendQueued, useCutQueue } from "./cutQueue";
import { CUT, runSessionOp, useSessionOp } from "./sessionOps";

function useNow(active: boolean, everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs]);
  return now;
}

function clock(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function kTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

/**
 * Strips above the composer input: a running move/clean cut (with elapsed time), a message queued
 * behind it, a lapsed prompt cache, a pending auto-resume.
 */
export function ComposerNotices({ agent }: { agent: Agent }) {
  const op = useSessionOp(agent.id);
  const queued = useCutQueue((st) => st[agent.id]);
  const settings = useConfig((st) => (st.config as { cleanCut?: unknown } | null)?.cleanCut);
  const resume = agent.autoResume ?? null;
  const now = useNow(true, resume || op ? 1000 : 30_000);
  const lastTurn = agent.lastUsageAt ?? agent.lastUserMessageAt ?? null;
  const cold =
    !op &&
    agent.status !== "running" &&
    !!agent.lastUserMessageAt &&
    isPromptCacheCold({
      provider: agent.provider,
      lastTurnAt: lastTurn ? Date.parse(lastTurn) : null,
      now,
      settings: settings as never,
    }) === true;
  const tokens = (agent.lastUsage as { contextWindowUsedTokens?: number } | undefined)
    ?.contextWindowUsedTokens;
  const canCut = hasFeature("agentCleanCut");
  const doCut = useCallback(() => {
    runSessionOp(agent.id, CUT, () => cleanCut(agent.id));
  }, [agent.id]);
  const cancel = useCallback(() => {
    cancelAutoResume(agent.id).catch((e) => toastError("Could not cancel auto-resume", e));
  }, [agent.id]);
  const drop = useCallback(() => dropQueued(agent.id), [agent.id]);
  const sendNow = useCallback(() => {
    sendQueued(agent.id).catch((e) => toastError("Message not sent", e));
  }, [agent.id]);
  if (!cold && !resume && !op && !queued) return null;
  return (
    <View style={s.list}>
      {op && <Progress label={op.label} elapsed={now - op.startedAt} />}
      {queued && <QueuedNote queued={queued} onDrop={drop} onSend={sendNow} />}
      {cold && (
        <View style={[s.note, s.warn]}>
          <StatusGlyph bucket="needs" size={7} still />
          <T style={s.warnT}>
            Cache expired: sending re-bills{" "}
            <T style={s.b}>
              {tokens ? `${kTokens(tokens)} input tokens` : "the whole conversation"}
            </T>
          </T>
          {canCut && <Link label="Clean cut instead" onPress={doCut} />}
        </View>
      )}
      {resume && (
        <View style={s.note}>
          <StatusGlyph bucket="working" size={7} />
          <T style={s.t}>
            Usage limit reached · auto-resume in{" "}
            <T style={s.b}>{clock(Date.parse(resume.resumeAt) - now)}</T>
          </T>
          <Link label="Cancel auto-resume" onPress={cancel} />
        </View>
      )}
    </View>
  );
}

/** The running operation: what it is doing, how long it has run, and a beam while it works. */
function Progress({ label, elapsed }: { label: string; elapsed: number }) {
  const live = !reducedMotion();
  return (
    <View style={[s.note, s.progress, s.enter]} accessibilityLiveRegion="polite">
      <StatusGlyph bucket="working" size={7} />
      <T style={s.t}>{label}…</T>
      <T v="mono" style={s.clock}>
        {clock(elapsed)}
      </T>
      <T style={s.hint}>Anything you send now waits for it</T>
      <View style={s.track}>{live && <View style={[s.beam, stateMotion.beam]} />}</View>
    </View>
  );
}

/** A message held until the operation finishes; after a failure, the user decides. */
function QueuedNote({
  queued,
  onDrop,
  onSend,
}: {
  queued: { text: string; attachments: unknown[]; state: "waiting" | "failed" };
  onDrop: () => void;
  onSend: () => void;
}) {
  const failed = queued.state === "failed";
  const extra = queued.attachments.length;
  const preview = queued.text.replace(/\s+/g, " ").trim() || (extra ? "Attachments" : "");
  return (
    <View style={[s.note, failed && s.warn, s.enter]}>
      <StatusGlyph bucket={failed ? "needs" : "idle"} size={7} still />
      <T style={failed ? s.warnT : s.t}>{failed ? "Not sent, the operation failed" : "Queued"}</T>
      <T style={s.preview} numberOfLines={1}>
        {preview}
        {extra && queued.text.trim()
          ? ` · ${extra === 1 ? "1 attachment" : `${extra} attachments`}`
          : ""}
      </T>
      {failed && <Link label="Send now" onPress={onSend} />}
      <Link label={failed ? "Discard" : "Cancel"} onPress={onDrop} />
    </View>
  );
}

function Link({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6}>
      {({ hovered }) => <T style={[s.link, hovered && s.linkH]}>{label}</T>}
    </Pressable>
  );
}

const s = StyleSheet.create({
  list: { gap: 4, marginBottom: 8 },
  enter: motion.enter,
  note: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: `${color.cyan}0f`,
  },
  warn: { backgroundColor: `${color.amber}14` },
  progress: { overflow: "hidden" },
  clock: { fontSize: 11.5, color: color.text },
  hint: { fontSize: 11.5, color: color.faint, flexShrink: 1 },
  preview: { fontSize: 12.5, color: color.text, flex: 1, minWidth: 60 },
  track: { position: "absolute", left: 0, right: 0, bottom: 0, height: 2, overflow: "hidden" },
  beam: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: "25%",
    ...web({ backgroundImage: `linear-gradient(90deg, transparent, ${color.cyan2}, transparent)` }),
  },
  t: { fontSize: 12.5, color: color.muted },
  warnT: { fontSize: 12.5, color: color.amber },
  b: { fontWeight: "700", color: color.text },
  link: { fontSize: 12, color: color.muted },
  linkH: { color: color.text },
});
