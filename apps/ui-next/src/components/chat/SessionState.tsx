import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { connect } from "../../daemon/store";
import { bucketOf, type Agent, type TimelineItem } from "../../daemon/types";
import { color } from "../../theme/tokens";
import { useUi } from "../../ui-store";
import { copyText } from "../shell/copy";
import { toast, toastError } from "../toast/store";
import { Button } from "../Button";
import { Markdown } from "../Markdown";
import { StatusGlyph } from "../StatusGlyph";
import { T } from "../Text";

/** Durable turn outcomes stay in the conversation, independent of transient toasts. */
export function SessionState({ agent, online }: { agent: Agent; online: boolean }) {
  const bucket = bucketOf(agent);
  const reconnect = useCallback(() => {
    void connect();
  }, []);
  const review = useCallback(() => useUi.getState().setTool("scm"), []);
  if (!online)
    return (
      <View style={s.card}>
        <StatusGlyph bucket="idle" size={8} still />
        <View style={s.text}>
          <T style={s.title}>Host offline</T>
          <T style={s.detail}>
            Showing the last received conversation. Reconnect before sending a message.
          </T>
        </View>
        <Button label="Reconnect" onPress={reconnect} />
      </View>
    );
  if (bucket !== "review" && bucket !== "failed") return null;
  return (
    <View style={s.card}>
      <StatusGlyph bucket={bucket} size={8} still />
      <View style={s.text}>
        <T style={s.title}>{bucket === "review" ? "Ready to review" : "Session failed"}</T>
        <T style={s.detail}>
          {bucket === "review"
            ? "Review the changes or send a follow-up below."
            : agent.lastError ||
              "The agent stopped with an error. Send a message below to continue."}
        </T>
      </View>
      {bucket === "review" && <Button label="Review changes" onPress={review} />}
    </View>
  );
}

export function Compaction({ item }: { item: Extract<TimelineItem, { type: "compaction" }> }) {
  const [expanded, setExpanded] = useState(false);
  const expandedState = useMemo(() => ({ expanded }), [expanded]);
  const toggle = useCallback(() => setExpanded((v) => !v), []);
  const copyPrevious = useCallback(() => {
    if (!item.cleanCut?.previousSessionId) return;
    void copyText(item.cleanCut.previousSessionId).then((ok) => {
      if (ok) return toast({ title: "Copied previous conversation ID" });
      return toastError("Could not copy", "Clipboard is unavailable");
    });
  }, [item.cleanCut?.previousSessionId]);
  const meta: string[] = [];
  if (item.cleanCut?.previousContextTokens != null)
    meta.push(`${item.cleanCut.previousContextTokens.toLocaleString()} previous context tokens`);
  if (item.cleanCut?.summaryModel) meta.push(item.cleanCut.summaryModel);
  if (item.cleanCut?.summaryUsage?.totalCostUsd != null)
    meta.push(`$${item.cleanCut.summaryUsage.totalCostUsd.toFixed(2)}`);
  if (item.cleanCut?.reason === "cold-cache") meta.push("Cache had expired");
  const cutting = item.status === "loading";
  let label = cutting ? "Compacting context…" : "Context compacted";
  if (item.cleanCut)
    label = cutting ? "Making a clean cut…" : "Clean cut · continuing from a summary";
  return (
    <View style={s.marker}>
      <T v="mono" style={s.detail}>
        {label}
      </T>
      {meta.length > 0 && <T style={s.detail}>{meta.join(" · ")}</T>}
      {item.cleanCut?.previousSessionId && (
        <Button label="Copy previous conversation ID" onPress={copyPrevious} />
      )}
      {item.cleanCut?.summary && (
        <>
          <Pressable onPress={toggle} accessibilityRole="button" accessibilityState={expandedState}>
            <T style={s.link}>{expanded ? "Hide summary" : "View summary"}</T>
          </Pressable>
          {expanded && <Markdown text={item.cleanCut.summary} />}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    marginTop: 18,
    borderTopWidth: 1,
    borderTopColor: color.line,
    paddingTop: 14,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
  },
  text: { flex: 1, minWidth: 160 },
  title: { fontSize: 13, fontWeight: "600" },
  detail: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  marker: {
    marginTop: 18,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: color.line,
    gap: 8,
  },
  link: { color: color.cyan2, fontSize: 12 },
});
