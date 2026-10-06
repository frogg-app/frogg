import { Archive, ArrowLeft } from "lucide-react-native";
import { useEffect, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { archiveSession, cancelTurn, openTimeline, send, setAgentMode, setAgentModel, useDaemon } from "../daemon/store";
import type { Agent } from "../daemon/types";
import { useConfig, loadConfig } from "../daemon/config";
import { Select } from "./Select";
import { bucketOf, type Session, type TimelineEntry } from "../daemon/types";
import { color, motion } from "../theme/tokens";
import { providerLabel } from "../util";
import { Composer } from "./Composer";
import { PermissionCard } from "./PermissionCard";
import { ToolCall } from "./ToolCall";
import { Markdown } from "./Markdown";
import { bucketColor, StatusGlyph } from "./StatusGlyph";
import { T } from "./Text";

const bucketText = { needs: "Needs you", failed: "Failed", review: "Ready to review", working: "Working", idle: "Idle" };

export function Chat({ session, onBack }: { session: Session; onBack?: () => void }) {
  const a = session.agent;
  const entries = useDaemon((s) => s.timelines[a.id]);
  const scroll = useRef<ScrollView>(null);
  useEffect(() => {
    void openTimeline(a.id);
  }, [a.id]);
  const bucket = bucketOf(a);
  const branch = session.project?.checkout.isGit ? session.project.checkout.currentBranch : null;
  const model = a.runtimeInfo?.model ?? a.model;
  return (
    <View style={{ flex: 1, backgroundColor: color.bg2 }}>
      <View style={s.head}>
        <T v="mono" numberOfLines={1} style={{ fontSize: 11 }}>
          {[session.project?.projectName, branch].filter(Boolean).join(" / ")}
        </T>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 3 }}>
          {onBack && (
            <Pressable onPress={onBack} hitSlop={10} accessibilityLabel="Back"><ArrowLeft size={18} color={color.text} /></Pressable>
          )}
          <T v="display" numberOfLines={1} style={{ fontSize: 19, flex: 1 }}>{a.title || "Untitled session"}</T>
          <Pressable onPress={() => void archiveSession(a.id)} accessibilityLabel="Archive session" hitSlop={8}>
            {({ hovered }) => <Archive size={16} color={hovered ? color.text : color.faint} />}
          </Pressable>
        </View>
        <View style={s.sub}>
          <StatusGlyph bucket={bucket} size={7} />
          <T style={{ color: bucketColor[bucket], fontSize: 12 }}>{bucketText[bucket]}</T>
          <T style={s.dot}>·</T>
          <T style={s.subT}>{providerLabel(a.provider)}</T>
          {model && (<><T style={s.dot}>·</T><T style={s.subT}>{model}</T></>)}
        </View>
      </View>
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={s.body}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
      >
        {!entries && <T v="label" style={{ textAlign: "center", marginTop: 40 }}>loading timeline…</T>}
        {entries?.length === 0 && a.status !== "running" && (
          <T v="label" style={{ textAlign: "center", marginTop: 40 }}>no messages yet · say what to do below</T>
        )}
        {entries?.map((e, i) => <Item key={`${e.seqStart}-${i}`} e={e} provider={providerLabel(a.provider)} />)}
        {a.pendingPermissions.map((p) => <PermissionCard key={p.id} agentId={a.id} p={p} />)}
        {a.status === "running" && <Thinking entries={entries} waiting={a.pendingPermissions.length > 0} />}
      </ScrollView>
      <View style={s.composer}>
        <Composer
          placeholder={`Message ${providerLabel(a.provider)} — @ files, / commands`}
          chips={onBack ? [] : [providerLabel(a.provider)]}
          controls={<AgentControls agent={a} />}
          onSend={(t) => void send(a.id, t)}
          onStop={a.status === "running" ? () => void cancelTurn(a.id) : undefined}
          compact={!!onBack}
        />
      </View>
    </View>
  );
}

/** What the agent is doing right now, as a shimmering label; static amber when it is waiting on you. */
function Thinking({ entries, waiting }: { entries: TimelineEntry[] | undefined; waiting: boolean }) {
  const last = entries?.[entries.length - 1]?.item;
  const label = waiting
    ? "Waiting for you"
    : last?.type === "tool_call" && last.status === "running"
      ? { shell: "Running a command", read: "Reading files", edit: "Editing", write: "Writing", search: "Searching", fetch: "Fetching", sub_agent: "Running a subagent" }[last.detail.type as string] ?? `Using ${last.name}`
      : last?.type === "assistant_message"
        ? "Writing"
        : "Thinking";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16 }}>
      {waiting ? <StatusGlyph bucket="needs" size={7} /> : <StatusGlyph bucket="working" size={8} />}
      <T v="mono" style={[{ fontSize: 12.5 }, waiting ? { color: color.amber } : [motion.shimmerText, motion.shimmerRun]]}>{label}</T>
    </View>
  );
}

function Item({ e, provider }: { e: TimelineEntry; provider: string }) {
  const it = e.item;
  switch (it.type) {
    case "user_message":
      return (
        <View style={s.user}>
          <T style={{ fontSize: 14.5, lineHeight: 22 }}>{it.text}</T>
        </View>
      );
    case "assistant_message":
      return (
        <View style={{ marginTop: 18 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <View style={{ width: 6, height: 6, backgroundColor: color.cyan2, transform: [{ rotate: "45deg" }] }} />
            <T style={{ fontSize: 12.5, color: color.muted, fontWeight: "500" }}>{provider}</T>
          </View>
          <Markdown text={it.text} />
        </View>
      );
    case "reasoning":
      return <T numberOfLines={3} style={{ marginTop: 12, color: color.faint, fontStyle: "italic" }}>{it.text}</T>;
    case "tool_call":
      return <ToolCall item={it} />;
    case "error":
      return <T v="mono" style={{ color: color.coral, marginTop: 12 }}>{it.message}</T>;
    case "todo":
      return (
        <View style={[s.tool, { flexDirection: "column", alignItems: "flex-start", gap: 4 }]}>
          {it.items.map((t, i) => (
            <T key={i} v="mono" style={{ color: t.completed ? color.faint : color.text }}>{t.completed ? "■" : "□"} {t.text}</T>
          ))}
        </View>
      );
    default:
      return null;
  }
}

const s = StyleSheet.create({
  head: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: color.line },
  sub: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  subT: { fontSize: 12, color: color.muted },
  dot: { color: color.faint, fontSize: 12 },
  body: { paddingHorizontal: 24, paddingVertical: 18, maxWidth: 860, width: "100%", alignSelf: "center" },
  user: { alignSelf: "flex-end", maxWidth: "85%", marginTop: 14, backgroundColor: color.raise, borderLeftWidth: 2, borderLeftColor: color.cyan2, paddingHorizontal: 14, paddingVertical: 10 },
  tool: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, backgroundColor: color.panel, borderWidth: 1, borderColor: color.line, paddingHorizontal: 12, paddingVertical: 8 },
  composer: { paddingHorizontal: 16, paddingBottom: 14, paddingTop: 6, maxWidth: 892, width: "100%", alignSelf: "center" },
});

/** Model and mode pickers for a live session, fed by the host's provider snapshot. */
function AgentControls({ agent }: { agent: Agent }) {
  const providers = useConfig((s) => s.providers);
  useEffect(() => {
    if (!providers) void loadConfig();
  }, [providers]);
  const entry = providers?.entries.find((p) => p.provider === agent.provider);
  const model = agent.runtimeInfo?.model ?? agent.model;
  const models = entry?.models ?? [];
  return (
    <>
      <Select
        chip mono up width="auto" menuWidth={240}
        value={model ?? null}
        placeholder={model ?? "default model"}
        options={models.map((m) => ({ value: m.id, label: m.label, hint: m.description }))}
        onChange={(v) => void setAgentModel(agent.id, v)}
      />
      {agent.availableModes.length > 0 && (
        <Select
          chip up width="auto" menuWidth={240}
          value={agent.currentModeId}
          options={agent.availableModes.map((m) => ({ value: m.id, label: m.label, hint: m.description }))}
          onChange={(v) => void setAgentMode(agent.id, v)}
        />
      )}
    </>
  );
}
