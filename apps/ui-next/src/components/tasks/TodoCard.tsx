import { ChevronLeft, ChevronRight, Bot } from "lucide-react-native";
import { useCallback } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useDaemon } from "../../daemon/store";
import {
  openTodo,
  setTodoStatus,
  STATUSES,
  useTodos,
  type Todo,
  type TodoPriority,
  type TodoStatus,
} from "../../daemon/todos";
import { color, ease, web } from "../../theme/tokens";
import { Brackets } from "../Brackets";
import { Cut } from "../Cut";
import { T } from "../Text";
import { toastError } from "../toast/store";

/** Column tints. Green is kept for finished work only. */
export const STATUS_TINT: Record<TodoStatus, string> = {
  backlog: color.faint,
  ready: color.cyan,
  claimed: color.violet,
  in_progress: color.cyan2,
  review: color.amber,
  done: color.mint,
  blocked: color.coral,
};

export const PRIORITY_TINT: Record<TodoPriority, string> = {
  low: color.faint,
  medium: color.muted,
  high: color.amber,
  urgent: color.coral,
};

const tintCache = new Map<string, { t: object; d: object }>();
export function tintStyle(tint: string): { t: object; d: object } {
  let st = tintCache.get(tint);
  if (!st) {
    st = StyleSheet.create({ t: { color: tint }, d: { backgroundColor: tint } });
    tintCache.set(tint, st);
  }
  return st;
}

/** Who holds the item: the claiming session's title when this client knows it. */
export function useClaimLabel(
  todo: Todo,
): { text: string; stale: boolean; agentId: string } | null {
  const claim = todo.claims[0];
  const title = useDaemon((s) => (claim ? s.sessions[claim.agentId]?.agent.title : undefined));
  if (!claim) return null;
  const more = todo.claims.length > 1 ? ` +${todo.claims.length - 1}` : "";
  return {
    text: `${title || claim.agentId.slice(0, 8)}${more}`,
    stale: claim.stale,
    agentId: claim.agentId,
  };
}

/** One to-do as a card: list rows and board columns share it. Press opens the detail sheet. */
export function TodoCard({
  projectId,
  todo,
  projectName,
  move,
}: {
  projectId: string;
  todo: Todo;
  /** Shown when the list spans projects. */
  projectName?: string;
  /** Board only: arrows to step the card to the neighbouring column. */
  move?: boolean;
}) {
  const on = useTodos((s) => s.open?.todoId === todo.id && s.open.projectId === projectId);
  const claim = useClaimLabel(todo);
  const press = useCallback(() => openTodo(projectId, todo.id), [projectId, todo.id]);
  const at = STATUSES.findIndex((x) => x.value === todo.status);
  const step = useCallback(
    (by: number) => {
      const next = STATUSES[at + by];
      if (!next) return;
      setTodoStatus(projectId, todo.id, next.value).catch((e: unknown) =>
        toastError(`Couldn't move “${todo.title}”`, e),
      );
    },
    [at, projectId, todo.id, todo.title],
  );
  const back = useCallback(() => step(-1), [step]);
  const fwd = useCallback(() => step(1), [step]);
  const pri = tintStyle(PRIORITY_TINT[todo.priority]);
  return (
    <Pressable onPress={press} accessibilityRole="button" accessibilityLabel={todo.title}>
      {({ hovered }) => (
        <Cut size={8} style={[s.card, hovered && s.hover, on && s.on]}>
          <Brackets on={on} />
          <View style={s.top}>
            <View style={[s.pri, pri.d]} />
            <T style={s.title} numberOfLines={2}>
              {todo.title}
            </T>
          </View>
          {!!todo.description && (
            <T style={s.desc} numberOfLines={2}>
              {todo.description.replace(/^#+\s*/gm, "").replace(/\s+/g, " ")}
            </T>
          )}
          <View style={s.meta}>
            <T v="mono" style={[s.metaT, pri.t]}>
              {todo.priority}
            </T>
            {todo.category && (
              <T v="mono" style={s.metaT}>
                · {todo.category}
              </T>
            )}
            {projectName && (
              <T v="mono" style={s.metaT} numberOfLines={1}>
                · {projectName}
              </T>
            )}
          </View>
          {claim && (
            <View style={s.claim}>
              <Bot size={11} color={claim.stale ? color.faint : color.violet} />
              <T v="mono" style={[s.metaT, claim.stale && s.stale]} numberOfLines={1}>
                {claim.text}
                {claim.stale ? " · agent stopped" : ""}
              </T>
            </View>
          )}
          {todo.lastProgress && (
            <T v="mono" style={s.note} numberOfLines={1}>
              {todo.lastProgress.note}
            </T>
          )}
          {move && (
            <View style={[s.moves, hovered ? s.movesOn : s.movesOff]}>
              <Pressable
                onPress={back}
                disabled={at <= 0}
                accessibilityLabel="Move to previous column"
                style={s.moveBtn}
              >
                <ChevronLeft size={13} color={at <= 0 ? color.line2 : color.muted} />
              </Pressable>
              <Pressable
                onPress={fwd}
                disabled={at >= STATUSES.length - 1}
                accessibilityLabel="Move to next column"
                style={s.moveBtn}
              >
                <ChevronRight
                  size={13}
                  color={at >= STATUSES.length - 1 ? color.line2 : color.muted}
                />
              </Pressable>
            </View>
          )}
        </Cut>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    padding: 12,
    gap: 6,
    backgroundColor: color.panel,
    ...web({ transition: `background-color 140ms ${ease}` }),
  },
  hover: { backgroundColor: color.raise },
  on: { backgroundColor: color.cyanWash },
  top: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  pri: { width: 6, height: 6, marginTop: 6, transform: [{ rotate: "45deg" }] },
  title: { flex: 1, fontSize: 13, lineHeight: 18 },
  desc: { fontSize: 12, lineHeight: 17, color: color.muted, paddingLeft: 14 },
  meta: { flexDirection: "row", gap: 4, paddingLeft: 14, flexWrap: "wrap" },
  metaT: { fontSize: 10.5, color: color.faint, flexShrink: 1 },
  claim: { flexDirection: "row", alignItems: "center", gap: 5, paddingLeft: 14 },
  stale: { color: color.faint },
  note: { fontSize: 10.5, color: color.muted, paddingLeft: 14 },
  moves: {
    position: "absolute",
    right: 6,
    top: 6,
    flexDirection: "row",
    backgroundColor: color.raise,
    ...web({ transition: `opacity 140ms ${ease}` }),
  },
  movesOn: { opacity: 1 },
  movesOff: { opacity: 0 },
  moveBtn: { padding: 4 },
});
