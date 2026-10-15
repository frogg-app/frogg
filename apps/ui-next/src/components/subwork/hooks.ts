import { createContext, useCallback, useContext } from "react";
import {
  closeDetail,
  openDetail,
  setExpanded,
  useSubWork,
  useSubWorkStore,
  type UseSubWork,
} from "../../daemon/subwork";
import { openTodo, useTodos, type ScopedTodo } from "../../daemon/todos";
import { usePrefs } from "../../prefs";
import { useUi } from "../../ui-store";
import { needsAttention, type SubWork } from "./model";
import type { SubWorkVariant } from "./views";

/** Pins the row indicator variant (the lab shows all three side by side); null follows the pref. */
export const VariantOverride = createContext<SubWorkVariant | null>(null);

export interface RowSubWork extends UseSubWork {
  variant: SubWorkVariant;
  open: boolean;
  toggle: () => void;
  onOpen: (item: SubWork) => void;
}

/** The provider's own id for a subagent row (`sub:<id>`), else null. */
export const subagentIdOf = (item: SubWork): string | null =>
  item.kind === "subagent" && item.id.startsWith("sub:") ? item.id.slice(4) : null;

/** A loaded to-do this item's agent has claimed, if any. */
export function linkedTodo(item: SubWork): ScopedTodo | null {
  const ids = new Set([subagentIdOf(item), item.openId].filter((x): x is string => !!x));
  if (!ids.size) return null;
  for (const [projectId, list] of Object.entries(useTodos.getState().items))
    for (const todo of list ?? [])
      if (todo.claims.some((c) => ids.has(c.agentId))) return { projectId, todo };
  return null;
}

// Details belong to their parent's pane: selecting any other session drops them.
useUi.subscribe((st, prev) => {
  if (st.selected !== prev.selected) closeDetail(undefined, st.selected);
});

/**
 * Opens what a sub-work row stands for: a child session or a terminal as itself, a subagent linked
 * to a to-do as that to-do in Tasks, anything else as its details in the parent's chat pane.
 */
export function openSubWork(sessionId: string, item: SubWork): void {
  const ui = useUi.getState();
  if (item.kind === "child-session" && item.openId) {
    ui.select(item.openId);
    return;
  }
  const todo = linkedTodo(item);
  if (todo) {
    openTodo(todo.projectId, todo.todo.id);
    ui.setTool("tasks");
    return;
  }
  if ((item.kind === "terminal" || item.kind === "script") && item.openId) {
    ui.setTool("terminals");
    ui.openTerminal(item.openId);
    return;
  }
  ui.select(sessionId);
  openDetail(sessionId, item.id);
}

/**
 * Sub-work for one session-list row. Idle sessions do not trigger any RPC; the row appears once
 * its session is working (or the open one), then keeps what was loaded. Open by default only when
 * something waits on you or failed; the user's own choice wins and is remembered.
 */
export function useRowSubWork(sessionId: string, working: boolean): RowSubWork {
  const sub = useSubWork(sessionId, working);
  const pref = usePrefs((s) => s.subworkStyle);
  const variant = useContext(VariantOverride) ?? pref;
  const chosen = useSubWorkStore((s) => s.expanded[sessionId]);
  const auto = needsAttention(sub.counts);
  const open = chosen ?? auto;
  const toggle = useCallback(() => setExpanded(sessionId, !open), [sessionId, open]);
  const onOpen = useCallback((item: SubWork) => openSubWork(sessionId, item), [sessionId]);
  return { ...sub, variant, open, toggle, onOpen };
}
