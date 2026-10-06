import { isPromptCacheCold } from "@frogg/protocol/prompt-cache";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useConfig } from "../../daemon/config";
import type { Agent } from "../../daemon/types";
import { color } from "../../theme/tokens";
import { StatusGlyph } from "../StatusGlyph";
import { T } from "../Text";
import { toast, toastError } from "../toast/store";
import { cancelAutoResume, cleanCut, hasFeature } from "./actions";

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

/** Strips above the composer input: a lapsed prompt cache, a pending auto-resume. */
export function ComposerNotices({ agent }: { agent: Agent }) {
  const settings = useConfig((st) => (st.config as { cleanCut?: unknown } | null)?.cleanCut);
  const resume = agent.autoResume ?? null;
  const now = useNow(true, resume ? 1000 : 30_000);
  const lastTurn = agent.lastUsageAt ?? agent.lastUserMessageAt ?? null;
  const cold =
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
    toast({ title: "Clean cut started", detail: "Summarising the conversation", kind: "info" });
    cleanCut(agent.id).then(
      () => toast({ title: "Clean cut done", detail: "The next message starts from the summary" }),
      (e) => toastError("Clean cut failed", e),
    );
  }, [agent.id]);
  const cancel = useCallback(() => {
    cancelAutoResume(agent.id).catch((e) => toastError("Could not cancel auto-resume", e));
  }, [agent.id]);
  if (!cold && !resume) return null;
  return (
    <View style={s.list}>
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

function Link({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6}>
      {({ hovered }) => <T style={[s.link, hovered && s.linkH]}>{label}</T>}
    </Pressable>
  );
}

const s = StyleSheet.create({
  list: { gap: 4, marginBottom: 8 },
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
  t: { fontSize: 12.5, color: color.muted },
  warnT: { fontSize: 12.5, color: color.amber },
  b: { fontWeight: "700", color: color.text },
  link: { fontSize: 12, color: color.muted },
  linkH: { color: color.text },
});
