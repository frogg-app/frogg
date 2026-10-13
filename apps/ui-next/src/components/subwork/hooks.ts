import { createContext, useCallback, useContext } from "react";
import { setExpanded, useSubWork, useSubWorkStore, type UseSubWork } from "../../daemon/subwork";
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

/** Opens what a sub-work row stands for: a child session, or the parent's Tasks panel. */
export function openSubWork(sessionId: string, item: SubWork): void {
  const ui = useUi.getState();
  if (item.kind === "child-session" && item.openId) {
    ui.select(item.openId);
    return;
  }
  ui.select(sessionId);
  ui.setTool("tasks");
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
