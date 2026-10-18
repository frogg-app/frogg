import { ArrowLeft } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { loadConfig, useConfig } from "../daemon/config";
import { useSubWorkStore } from "../daemon/subwork";
import { useViewers } from "../daemon/viewers";
import { cancelTurn, openTimeline, setAgentMode, setAgentModel, useDaemon } from "../daemon/store";
import { bucketOf, type Agent, type Session, type TimelineEntry } from "../daemon/types";
import { color, motion } from "../theme/tokens";
import { providerLabel } from "../util";
import { AccountChip } from "./chat/AccountChip";
import { ContextMeter } from "./chat/ContextMeter";
import { ProviderChip } from "./chat/ProviderChip";
import { ComposerNotices } from "./chat/Notices";
import { SessionMenu } from "./chat/SessionMenu";
import { SessionState } from "./chat/SessionState";
import { headerTitle } from "./chat/title";
import { forkDrafts, listCommands, sendWithAttachments, type Attachment } from "./chat/actions";
import { useBottomAnchor } from "./chat/useBottomAnchor";
import { SubWorkDetail } from "./subwork/Detail";
import { SubWorkStrip } from "./subwork/Strip";
import { toastError } from "./toast/store";
import { Composer } from "./Composer";
import { ImageRoot } from "./markdown/HostImage";
import { PermissionCard } from "./PermissionCard";
import { Select } from "./Select";
import { bucketColor, StatusGlyph } from "./StatusGlyph";
import { T } from "./Text";
import { RevealHeading } from "./chat/TextReveal";
import { keyedEntries, TimelineItem } from "./chat/TimelineItem";
import { TimelineLoading } from "./chat/TimelineLoading";
import { Viewers } from "./chat/Viewers";

// The provider chip is live (ProviderChip), not a static composer chip.
const NO_CHIPS: string[] = [];

const bucketText = {
  needs: "Needs you",
  failed: "Failed",
  review: "Ready to review",
  working: "Working",
  idle: "Idle",
};

const bucketTextStyle = StyleSheet.create(
  Object.fromEntries(Object.entries(bucketColor).map(([b, c]) => [b, { color: c, fontSize: 12 }])),
);

export function Chat({ session, onBack }: { session: Session; onBack?: () => void }) {
  const a = session.agent;
  const conn = useDaemon((st) => st.conn);
  const entries = useDaemon((st) => st.timelines[a.id]);
  const anchor = useBottomAnchor();
  const detail = useSubWorkStore((st) => st.detail[a.id]);
  const [typing, setTyping] = useState(false);
  const viewers = useViewers(a.id, typing ? "typing" : "viewing");
  const here = useMemo(() => <Viewers viewers={viewers} />, [viewers]);
  // Loads on open, and again once the host is back: a timeline opened while connecting has none.
  const online = conn === "online";
  useEffect(() => {
    if (!online) return;
    void openTimeline(a.id).catch((e) => toastError("Could not load conversation", e));
  }, [a.id, online]);
  const rows = useMemo(() => (entries ? keyedEntries(entries) : null), [entries]);
  const bucket = bucketOf(a);
  const branch = session.project?.checkout.isGit ? session.project.checkout.currentBranch : null;
  const model = a.runtimeInfo?.model ?? a.model;
  const provider = providerLabel(a.provider);
  const running = a.status === "running";
  const onSend = useCallback(
    async (t: string, attachments: Attachment[]) => {
      await sendWithAttachments(a.id, t, attachments);
      forkDrafts.delete(a.id);
    },
    [a.id],
  );
  const commands = useCallback(() => listCommands(a.id), [a.id]);
  const initialAttachments = useMemo(() => {
    const draft = forkDrafts.get(a.id);
    return draft ? [draft] : [];
  }, [a.id]);
  const stop = useCallback(() => {
    void cancelTurn(a.id).catch((e) => toastError("Could not stop", e));
  }, [a.id]);
  const notices = useMemo(() => <ComposerNotices agent={a} />, [a]);
  const title = useMemo(
    () => headerTitle(a.title || "Untitled session", entries),
    [a.title, entries],
  );
  return (
    <View style={s.root}>
      <View style={s.head}>
        <T v="mono" numberOfLines={1} style={s.crumb}>
          {[session.project?.projectName, branch].filter(Boolean).join(" / ")}
        </T>
        <View style={s.titleRow}>
          {onBack && (
            <Pressable onPress={onBack} hitSlop={10} accessibilityLabel="Back">
              <ArrowLeft size={18} color={color.text} />
            </Pressable>
          )}
          <RevealHeading key={`title-${a.id}`} text={title} numberOfLines={1} style={s.title} />
          <SessionMenu key={a.id} session={session} onArchived={onBack} />
        </View>
        <View style={s.sub}>
          <StatusGlyph bucket={bucket} size={7} />
          <T style={bucketTextStyle[bucket]}>{bucketText[bucket]}</T>
          <T style={s.dot}>·</T>
          <T style={s.subT}>{provider}</T>
          {model && (
            <T style={s.subT}>
              <T style={s.dot}>· </T>
              {model}
            </T>
          )}
        </View>
      </View>
      {detail ? (
        <SubWorkDetail key={detail} parentId={a.id} itemId={detail} provider={provider} />
      ) : (
        <>
          <SubWorkStrip sessionId={a.id} />
          <ImageRoot.Provider value={a.cwd}>
            <ScrollView
              ref={anchor.ref}
              style={s.scroll}
              contentContainerStyle={s.body}
              onScroll={anchor.onScroll}
              onLayout={anchor.onLayout}
              onContentSizeChange={anchor.onContentSizeChange}
              scrollEventThrottle={anchor.scrollEventThrottle}
            >
              {!rows && <TimelineLoading connecting={!online} />}
              {rows?.length === 0 && !running && (
                <T v="label" style={s.empty}>
                  no messages yet · say what to do below
                </T>
              )}
              {rows?.map((r) => (
                <TimelineItem
                  key={r.key}
                  e={r.e}
                  provider={provider}
                  streaming={running && r === rows[rows.length - 1]}
                />
              ))}
              {a.pendingPermissions.map((p) => (
                <PermissionCard key={p.id} agentId={a.id} p={p} />
              ))}
              <SessionState agent={a} online={conn === "online"} />
              {running && conn === "online" && (
                <Thinking entries={entries} waiting={a.pendingPermissions.length > 0} />
              )}
            </ScrollView>
          </ImageRoot.Provider>
          <View style={s.composer}>
            <Composer
              key={a.id}
              attach
              disabled={conn !== "online"}
              loadCommands={commands}
              initialAttachments={initialAttachments}
              notices={notices}
              placeholder={`Message ${provider} — / commands`}
              chips={NO_CHIPS}
              onSend={onSend}
              onStop={running ? stop : undefined}
              compact={!!onBack}
              expandable
              sizeKey={a.id}
              onTyping={setTyping}
              above={here}
            >
              <ProviderChip agent={a} compact={!!onBack} />
              <AgentControls agent={a} />
              <AccountChip agent={a} />
              <ContextMeter agent={a} />
            </Composer>
          </View>
        </>
      )}
    </View>
  );
}

const TOOL_VERB: Record<string, string> = {
  shell: "Running a command",
  read: "Reading files",
  edit: "Editing",
  write: "Writing",
  search: "Searching",
  fetch: "Fetching",
  sub_agent: "Running a subagent",
};

function activity(entries: TimelineEntry[] | undefined, waiting: boolean): string {
  if (waiting) return "Waiting for you";
  const last = entries?.[entries.length - 1]?.item;
  if (last?.type === "tool_call" && last.status === "running")
    return TOOL_VERB[last.detail.type] ?? `Using ${last.name}`;
  return last?.type === "assistant_message" ? "Writing" : "Thinking";
}

/** What the agent is doing right now, as a shimmering label; static amber when it is waiting on you. */
function Thinking({
  entries,
  waiting,
}: {
  entries: TimelineEntry[] | undefined;
  waiting: boolean;
}) {
  return (
    <View style={s.thinking}>
      {waiting ? (
        <StatusGlyph bucket="needs" size={7} />
      ) : (
        <StatusGlyph bucket="working" size={8} />
      )}
      <T v="mono" style={waiting ? s.waiting : s.shimmer}>
        {activity(entries, waiting)}
      </T>
    </View>
  );
}

/** Model and mode pickers for a live session, fed by the host's provider snapshot. */
function AgentControls({ agent }: { agent: Agent }) {
  const providers = useConfig((st) => st.providers);
  useEffect(() => {
    if (!providers) void loadConfig();
  }, [providers]);
  const model = agent.runtimeInfo?.model ?? agent.model;
  const models = useMemo(
    () =>
      (providers?.entries.find((p) => p.provider === agent.provider)?.models ?? []).map((m) => ({
        value: m.id,
        label: m.label,
        hint: m.description,
      })),
    [providers, agent.provider],
  );
  const modes = useMemo(
    () =>
      agent.availableModes.map((m) => ({
        value: m.id,
        label: m.label,
        hint: m.description,
      })),
    [agent.availableModes],
  );
  const pickModel = useCallback(
    (v: string) =>
      void setAgentModel(agent.id, v).catch((e) => toastError("Could not change model", e)),
    [agent.id],
  );
  const pickMode = useCallback(
    (v: string) =>
      void setAgentMode(agent.id, v).catch((e) => toastError("Could not change mode", e)),
    [agent.id],
  );
  return (
    <>
      <Select
        label="Model"
        chip
        mono
        up
        width="auto"
        menuWidth={240}
        value={model ?? null}
        placeholder={model ?? "default model"}
        options={models}
        onChange={pickModel}
      />
      {modes.length > 0 && (
        <Select
          label="Mode"
          chip
          up
          width="auto"
          menuWidth={240}
          value={agent.currentModeId}
          options={modes}
          onChange={pickMode}
        />
      )}
    </>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg2 },
  head: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  crumb: { fontSize: 11 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 3,
  },
  title: { fontSize: 19, flex: 1 },
  sub: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  subT: { fontSize: 12, color: color.muted },
  dot: { color: color.faint, fontSize: 12 },
  scroll: { flex: 1 },
  body: {
    paddingHorizontal: 24,
    paddingVertical: 18,
    maxWidth: 860,
    width: "100%",
    alignSelf: "center",
  },
  empty: { textAlign: "center", marginTop: 40 },
  thinking: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
  },
  waiting: { fontSize: 12.5, color: color.amber },
  shimmer: { fontSize: 12.5, ...motion.shimmerText, ...motion.shimmerRun },
  composer: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    paddingTop: 6,
    maxWidth: 892,
    width: "100%",
    alignSelf: "center",
  },
});
