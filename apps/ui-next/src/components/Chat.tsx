import { PARENT_AGENT_ID_LABEL } from "@frogg/protocol/agent-labels";
import { ArrowLeft, CornerLeftUp } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSubWorkStore } from "../daemon/subwork";
import { useViewers } from "../daemon/viewers";
import { cancelTurn, openTimeline, useDaemon } from "../daemon/store";
import { bucketOf, type Agent, type Session, type TimelineEntry } from "../daemon/types";
import { color, motion } from "../theme/tokens";
import { useUi } from "../ui-store";
import { providerLabel } from "../util";
import { AccountChip } from "./chat/AccountChip";
import { AgentControls } from "./chat/AgentControls";
import { ContextMeter } from "./chat/ContextMeter";
import { ProviderChip } from "./chat/ProviderChip";
import { ComposerNotices } from "./chat/Notices";
import { SessionMenu } from "./chat/SessionMenu";
import { SessionState } from "./chat/SessionState";
import { headerTitle } from "./chat/title";
import {
  cleanCut,
  forkDrafts,
  hasFeature,
  listCommands,
  sendWithAttachments,
  type Attachment,
} from "./chat/actions";
import { queueMessage, setQueueSender } from "./chat/cutQueue";
import { CUT, runSessionOp, useSessionOps } from "./chat/sessionOps";
import { useBottomAnchor } from "./chat/useBottomAnchor";
import { SubWorkDetail } from "./subwork/Detail";
import { SubWorkStrip } from "./subwork/Strip";
import { toastError } from "./toast/store";
import { Composer, type CutSend } from "./Composer";
import { ImageRoot } from "./markdown/HostImage";
import { PermissionCard } from "./PermissionCard";
import { bucketColor, StatusGlyph } from "./StatusGlyph";
import { T } from "./Text";
import { RevealHeading } from "./chat/TextReveal";
import { keyedEntries, TimelineItem } from "./chat/TimelineItem";
import { TimelineLoading } from "./chat/TimelineLoading";
import { Viewers } from "./chat/Viewers";

// The provider chip is live (ProviderChip), not a static composer chip.
const NO_CHIPS: string[] = [];

// Messages held behind a clean cut go out through the same path as a typed one.
setQueueSender(sendWithAttachments);

const busy = (agentId: string) => !!useSessionOps.getState()[agentId];

/** Why the scissors send cannot cut now, or null. */
function cutBlocked(entries: TimelineEntry[] | undefined, running: boolean): string | null {
  if (running) return "Wait for the turn to finish to make a clean cut";
  if (!entries?.some((e) => e.item.type === "user_message")) return "Nothing to summarise yet";
  return null;
}

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
      // A move or clean cut is rewriting the conversation: hold the message until it lands.
      if (busy(a.id)) queueMessage(a.id, t, attachments);
      else await sendWithAttachments(a.id, t, attachments);
      forkDrafts.delete(a.id);
    },
    [a.id],
  );
  const blocked = useMemo(() => cutBlocked(entries, running), [entries, running]);
  const canCut = online && hasFeature("agentCleanCut");
  const cut = useMemo<CutSend | undefined>(() => {
    if (!canCut) return undefined;
    return {
      blocked,
      onSend: (t, attachments) => {
        queueMessage(a.id, t, attachments);
        forkDrafts.delete(a.id);
        // Already cutting (from the menu or the cache notice): the message just waits for it.
        if (!busy(a.id)) runSessionOp(a.id, CUT, () => cleanCut(a.id));
      },
    };
  }, [a.id, blocked, canCut]);
  const commands = useCallback(() => listCommands(a.id), [a.id]);
  const shellEscape = useMemo(
    () => (online && hasFeature("agentShellEscape") ? { cwd: a.cwd } : undefined),
    [online, a.cwd],
  );
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
        <View style={s.crumbRow}>
          <T v="mono" numberOfLines={1} style={s.crumb}>
            {[session.project?.projectName, branch].filter(Boolean).join(" / ")}
          </T>
          <ParentLink agent={a} />
        </View>
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
      {/* Relative image paths resolve from the session's folder, in details as in the timeline. */}
      <ImageRoot.Provider value={a.cwd}>
        {detail ? (
          <SubWorkDetail key={detail} parentId={a.id} itemId={detail} provider={provider} />
        ) : (
          <>
            <SubWorkStrip sessionId={a.id} />
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
                cut={cut}
                shellEscape={shellEscape}
              >
                <ProviderChip agent={a} compact={!!onBack} />
                <AgentControls agent={a} />
                <AccountChip agent={a} />
                <ContextMeter agent={a} />
              </Composer>
            </View>
          </>
        )}
      </ImageRoot.Provider>
    </View>
  );
}

/** A subagent's way back: names the session that started it and opens it. */
function ParentLink({ agent }: { agent: Agent }) {
  const parentId = agent.labels?.[PARENT_AGENT_ID_LABEL];
  const title = useDaemon((st) =>
    parentId ? (st.sessions[parentId]?.agent.title ?? null) : undefined,
  );
  const open = useCallback(() => {
    if (parentId) useUi.getState().select(parentId);
  }, [parentId]);
  // Not loaded here (archived, or another host's id): nothing to open.
  if (!parentId || title === undefined) return null;
  return (
    <Pressable
      onPress={open}
      accessibilityRole="link"
      accessibilityLabel={`Subagent of ${title || "a session"}, open it`}
      hitSlop={6}
      style={s.parent}
    >
      {({ hovered }) => (
        <>
          <CornerLeftUp size={11} color={hovered ? color.text : color.violet} />
          <T numberOfLines={1} style={[s.parentT, hovered && s.parentHover]}>
            Subagent of {title || "Untitled session"}
          </T>
        </>
      )}
    </Pressable>
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

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg2 },
  head: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  crumbRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  crumb: { fontSize: 11, flexShrink: 1 },
  parent: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1, minWidth: 0 },
  parentT: { fontSize: 11.5, color: color.muted, flexShrink: 1 },
  parentHover: { color: color.text },
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
