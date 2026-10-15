import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import type { TimelineEntry } from "../../daemon/types";
import { usePrefs } from "../../prefs";
import { color } from "../../theme/tokens";
import { Markdown } from "../Markdown";
import { T } from "../Text";
import { ToolCall } from "../ToolCall";
import { Compaction } from "./SessionState";
import { RevealMarkdown } from "./TextReveal";
import { UserMessage } from "./UserMessage";

/** Stable React keys for timeline rows: the item's own id where it has one, else its sequence. */
export function keyedEntries(entries: TimelineEntry[]): Array<{ key: string; e: TimelineEntry }> {
  const seen = new Map<string, number>();
  return entries.map((e) => {
    const it = e.item;
    let base = `${e.seqStart}:${it.type}`;
    if (it.type === "tool_call") base = `tool:${it.callId}`;
    else if ((it.type === "assistant_message" || it.type === "user_message") && it.messageId)
      base = `${it.type}:${it.messageId}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { key: n ? `${base}#${n}` : base, e };
  });
}

function Todo({ items }: { items: Array<{ text: string; completed: boolean; id?: string }> }) {
  const keyed = useMemo(() => items.map((t, n) => ({ ...t, key: t.id ?? `todo${n}` })), [items]);
  return (
    <View style={s.todo}>
      {keyed.map((t) => (
        <T key={t.key} v="mono" style={t.completed ? s.todoDone : s.todoOpen}>
          {t.completed ? "■" : "□"} {t.text}
        </T>
      ))}
    </View>
  );
}

function Reply({ text, streaming }: { text: string; streaming: boolean }) {
  const mode = usePrefs((p) => p.textReveal);
  if (mode === "none") return <Markdown text={text} />;
  return <RevealMarkdown text={text} mode={mode} streaming={streaming} />;
}

/** One timeline row: a message, reasoning, a tool call, a compaction, an error or a todo list. */
export function TimelineItem({
  e,
  provider,
  streaming,
}: {
  e: TimelineEntry;
  provider: string;
  streaming: boolean;
}) {
  const it = e.item;
  switch (it.type) {
    case "user_message":
      return <UserMessage text={it.text} />;
    case "assistant_message":
      return (
        <View style={s.reply}>
          <View style={s.replyHead}>
            <View style={s.diamond} />
            <T style={s.replyWho}>{provider}</T>
          </View>
          <Reply text={it.text} streaming={streaming} />
        </View>
      );
    case "reasoning":
      return (
        <T numberOfLines={3} style={s.reasoning}>
          {it.text}
        </T>
      );
    case "tool_call":
      return <ToolCall item={it} />;
    case "compaction":
      return <Compaction item={it} />;
    case "error":
      return (
        <T v="mono" style={s.error}>
          {it.message}
        </T>
      );
    case "todo":
      return <Todo items={it.items} />;
    default:
      return null;
  }
}

const s = StyleSheet.create({
  reply: { marginTop: 18 },
  replyHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  diamond: {
    width: 6,
    height: 6,
    backgroundColor: color.cyan2,
    transform: [{ rotate: "45deg" }],
  },
  replyWho: { fontSize: 12.5, color: color.muted, fontWeight: "500" },
  reasoning: { marginTop: 12, color: color.faint, fontStyle: "italic" },
  error: { color: color.coral, marginTop: 12 },
  todo: {
    marginTop: 8,
    gap: 4,
    backgroundColor: color.panel,
    borderWidth: 1,
    borderColor: color.line,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  todoOpen: { color: color.text },
  todoDone: { color: color.faint },
});
