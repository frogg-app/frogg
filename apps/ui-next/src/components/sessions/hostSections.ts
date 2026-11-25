// "Separate by host": splits the session list's groups into one section per host, outermost, with
// the chosen grouping nested inside. A row's host is its own hostId (the active host's sessions
// carry none); subagent rows share their parent's host, so they stay under the parent.
import type { Session } from "../../daemon/types";

export interface HostSection<G extends { key: string; list: Session[] }> {
  /** Host id; the active host's sessions are keyed by its id too. */
  key: string;
  name: string;
  count: number;
  groups: G[];
}

export function splitByHost<G extends { key: string; list: Session[] }>(
  groups: readonly G[],
  activeId: string | null,
  nameOf: (hostId: string) => string,
): Array<HostSection<G>> {
  const out = new Map<string, HostSection<G>>();
  for (const g of groups) {
    const parts = new Map<string, Session[]>();
    for (const x of g.list) {
      const id = x.hostId ?? activeId ?? "";
      const list = parts.get(id);
      if (list) list.push(x);
      else parts.set(id, [x]);
    }
    for (const [id, list] of parts) {
      let sec = out.get(id);
      if (!sec) {
        sec = { key: id, name: nameOf(id), count: 0, groups: [] };
        out.set(id, sec);
      }
      sec.groups.push({ ...g, key: `${id}|${g.key}`, list });
      sec.count += list.length;
    }
  }
  // The active host first, then the rest by name.
  return [...out.values()].sort((a, b) => {
    if (a.key === activeId) return -1;
    if (b.key === activeId) return 1;
    return a.name.localeCompare(b.name);
  });
}
