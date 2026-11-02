// The Sessions list with terminals merged in (Settings › Files, editor & terminal): one group per
// host, its sessions first, then its terminals. Opt-in; off, terminals keep their own tool.
import { useCallback, useEffect, useMemo } from "react";
import { useHosts } from "../../daemon/hosts";
import type { Session } from "../../daemon/types";
import {
  killTerminal,
  killTerminalOnHost,
  openTerminalOnHost,
  refreshFleetTerminals,
  refreshHostTerminals,
  type TerminalInfo,
  useFleetTerminals,
  useTerminals,
} from "../../daemon/terminals";
import { useUi } from "../../ui-store";
import { TerminalRow } from "../TerminalsPanel";

/** How often terminal lists refresh while the merged list is on screen. */
const REFRESH_MS = 5000;

export interface HostGroup {
  key: string;
  label: string;
  hostId: string | null;
  list: Session[];
}

/**
 * Sessions grouped by host: the active host first (its sessions carry no `hostId`), then the
 * others in saved order. A host with terminals but no session still gets a group.
 */
export function groupByHost(
  sessions: readonly Session[],
  hosts: ReadonlyArray<{ id: string; name: string }>,
  activeId: string | null,
  withTerminals: ReadonlySet<string>,
): HostGroup[] {
  const nameOf = (id: string | null) => hosts.find((h) => h.id === id)?.name ?? "This host";
  const order = [activeId, ...hosts.map((h) => h.id).filter((id) => id !== activeId)];
  const groups: HostGroup[] = [];
  for (const id of order) {
    const list = sessions.filter((x) => (x.hostId ?? activeId) === id);
    if (!list.length && !(id && withTerminals.has(id))) continue;
    groups.push({ key: `host:${id ?? "active"}`, label: nameOf(id), hostId: id, list });
  }
  return groups;
}

/** Keeps the active and other hosts' terminal lists fresh while `on`. */
export function useMergedTerminals(on: boolean): Record<string, TerminalInfo[]> {
  const activeId = useHosts((h) => h.activeId);
  const own = useTerminals((t) => t.all);
  const fleet = useFleetTerminals();
  useEffect(() => {
    if (!on) return;
    const tick = () => {
      void refreshHostTerminals().catch(() => undefined);
      void refreshFleetTerminals();
    };
    tick();
    const timer = setInterval(tick, REFRESH_MS);
    return () => clearInterval(timer);
  }, [on, activeId]);
  return useMemo(
    () => (activeId ? { ...fleet, [activeId]: own ?? [] } : fleet),
    [fleet, own, activeId],
  );
}

/** A host's terminals under its sessions; opening one on another host switches to it. */
export function HostTerminals({
  hostId,
  list,
  needle,
}: {
  hostId: string | null;
  list: TerminalInfo[];
  needle: string;
}) {
  const active = useHosts((h) => h.activeId === hostId);
  const openId = useUi((u) => (u.sessionsPane === "terminal" ? u.terminalId : null));
  const open = useCallback(
    (id: string) => {
      const show = () => useUi.getState().openSessionTerminal(id);
      if (active || !hostId) show();
      else void openTerminalOnHost(hostId, show);
    },
    [active, hostId],
  );
  const kill = useCallback(
    (id: string) => (active || !hostId ? killTerminal(id) : killTerminalOnHost(hostId, id)),
    [active, hostId],
  );
  const shown = needle
    ? list.filter((t) => `${t.title ?? ""} ${t.name}`.toLowerCase().includes(needle))
    : list;
  return shown.map((t) => (
    <TerminalRow key={t.id} t={t} on={active && t.id === openId} onOpen={open} onKill={kill} />
  ));
}
