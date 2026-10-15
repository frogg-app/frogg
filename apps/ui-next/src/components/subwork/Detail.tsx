import { ArrowLeft, ListTodo } from "lucide-react-native";
import { useCallback, useEffect, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import {
  closeDetail,
  loadSubTimeline,
  subTimelineKey,
  useNow,
  useSubWork,
  useSubWorkStore,
} from "../../daemon/subwork";
import { openTodo, useTodos } from "../../daemon/todos";
import { useDaemon } from "../../daemon/store";
import { color, motion } from "../../theme/tokens";
import { useUi } from "../../ui-store";
import { keyedEntries, TimelineItem } from "../chat/TimelineItem";
import { TimelineLoading } from "../chat/TimelineLoading";
import { useBottomAnchor } from "../chat/useBottomAnchor";
import { StatusGlyph } from "../StatusGlyph";
import { T } from "../Text";
import { linkedTodo, subagentIdOf } from "./hooks";
import { KIND_NOUN, type SubWork, type SubWorkStatus } from "./model";
import { bucketOfStatus, KindGlyph, PortChip, statusColor, timeText } from "./views";

const STATUS_TEXT: Record<SubWorkStatus, string> = {
  running: "Running",
  attention: "Waiting on you",
  failed: "Failed",
  done: "Finished",
  idle: "Stopped",
};

const statusStyle = StyleSheet.create(
  Object.fromEntries(Object.entries(statusColor).map(([k, c]) => [k, { color: c, fontSize: 12 }])),
);

/**
 * One sub-work item in its parent's chat pane: what it is, its live status and run time, a link
 * back to the conversation (and to its to-do when it claimed one), and for a provider subagent its
 * own activity, streamed while it runs.
 */
export function SubWorkDetail({
  parentId,
  itemId,
  provider,
}: {
  parentId: string;
  itemId: string;
  /** The parent's provider label, for reply headers. */
  provider: string;
}) {
  const { items } = useSubWork(parentId);
  const item = items.find((x) => x.id === itemId);
  const parentTitle = useDaemon((s) => s.sessions[parentId]?.agent.title) || "conversation";
  const back = useCallback(() => closeDetail(parentId), [parentId]);
  return (
    <View style={s.root}>
      <Pressable onPress={back} accessibilityRole="link" style={s.back}>
        {({ hovered }) => (
          <View style={s.backRow}>
            <ArrowLeft size={14} color={hovered ? color.text : color.cyan2} />
            <T numberOfLines={1} style={[s.backT, hovered && s.backHover]}>
              {`Back to ${parentTitle}`}
            </T>
          </View>
        )}
      </Pressable>
      {item ? (
        <Body item={item} parentId={parentId} provider={provider} />
      ) : (
        <T v="label" style={s.gone}>
          this item has finished and left the list
        </T>
      )}
    </View>
  );
}

function Body({ item, parentId, provider }: { item: SubWork; parentId: string; provider: string }) {
  const live = item.status === "running";
  const now = useNow(live);
  const time = timeText(item, now);
  const subId = subagentIdOf(item);
  // Re-read the link whenever the loaded to-dos change.
  useTodos((st) => st.items);
  const todo = linkedTodo(item);
  const goTodo = useCallback(() => {
    if (!todo) return;
    openTodo(todo.projectId, todo.todo.id);
    useUi.getState().setTool("tasks");
  }, [todo]);
  return (
    <>
      <View style={s.head}>
        <View style={s.kindRow}>
          <KindGlyph kind={item.kind} size={12} tint={color.faint} />
          <T v="label">{KIND_NOUN[item.kind]}</T>
        </View>
        <T numberOfLines={2} style={s.title}>
          {item.label}
        </T>
        <View style={s.statusRow}>
          <StatusGlyph bucket={bucketOfStatus[item.status]} size={7} />
          <T style={statusStyle[item.status]}>{STATUS_TEXT[item.status]}</T>
          {time !== "" && (
            <T v="mono" style={s.time}>
              {time}
            </T>
          )}
          {item.port !== undefined && <PortChip port={item.port} />}
        </View>
        {!!item.detail && <T style={s.detail}>{item.detail}</T>}
        {!!item.activity && (
          <T key={item.activity} v="mono" numberOfLines={1} style={[s.activity, live && s.live]}>
            {item.activity}
          </T>
        )}
        {todo && (
          <Pressable onPress={goTodo} accessibilityRole="link" style={s.todo}>
            <ListTodo size={13} color={color.cyan2} />
            <T numberOfLines={1} style={s.todoT}>{`To-do · ${todo.todo.title}`}</T>
          </Pressable>
        )}
      </View>
      {subId ? (
        <Activity parentId={parentId} subagentId={subId} provider={provider} running={live} />
      ) : (
        <T v="label" style={s.gone}>
          no activity stream for a {KIND_NOUN[item.kind]}
        </T>
      )}
    </>
  );
}

/** A subagent's own timeline, loaded on open and kept live by the subagent update stream. */
function Activity({
  parentId,
  subagentId,
  provider,
  running,
}: {
  parentId: string;
  subagentId: string;
  provider: string;
  running: boolean;
}) {
  const conn = useDaemon((s) => s.conn);
  const online = conn === "online";
  const tl = useSubWorkStore((s) => s.subTimelines[subTimelineKey(parentId, subagentId)]);
  const anchor = useBottomAnchor();
  useEffect(() => {
    if (online) void loadSubTimeline(parentId, subagentId);
  }, [parentId, subagentId, online]);
  const rows = useMemo(() => (tl?.entries ? keyedEntries(tl.entries) : null), [tl?.entries]);
  return (
    <ScrollView
      ref={anchor.ref}
      style={s.scroll}
      contentContainerStyle={s.body}
      onScroll={anchor.onScroll}
      onLayout={anchor.onLayout}
      onContentSizeChange={anchor.onContentSizeChange}
      scrollEventThrottle={anchor.scrollEventThrottle}
    >
      {!rows && <TimelineLoading connecting={!online} label="Loading subagent activity" />}
      {!!tl?.error && (
        <T v="mono" style={s.error}>
          {tl.error}
        </T>
      )}
      {rows?.length === 0 && !tl?.error && (
        <T v="label" style={s.gone}>
          no activity yet
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
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, ...motion.enter },
  back: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
    backgroundColor: color.panel,
  },
  backRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  backT: { fontSize: 12, color: color.cyan2, flexShrink: 1 },
  backHover: { color: color.text },
  head: {
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
    gap: 6,
    maxWidth: 860,
    width: "100%",
    alignSelf: "center",
  },
  kindRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 16, color: color.text, fontWeight: "500" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  time: { fontSize: 11.5, color: color.muted, fontVariant: ["tabular-nums"] },
  detail: { fontSize: 13, color: color.muted },
  activity: { fontSize: 11.5, color: color.faint, ...motion.fade },
  live: { color: color.cyan2 },
  todo: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  todoT: { fontSize: 12, color: color.cyan2 },
  scroll: { flex: 1 },
  body: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    maxWidth: 860,
    width: "100%",
    alignSelf: "center",
  },
  gone: { textAlign: "center", marginTop: 32 },
  error: { color: color.coral, marginTop: 12, fontSize: 12 },
});
