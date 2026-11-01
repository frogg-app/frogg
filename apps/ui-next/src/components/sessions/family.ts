// Parent and child sessions in the session list. A session started by another agent (it carries
// the `frogg.parent-agent-id` label) belongs to its parent: it takes the parent's scope, project
// and host section, and is listed under the parent rather than as a session of its own. Detaching
// removes the label, so a detached session is a root again. A child whose parent is not loaded on
// the same host (archived, or another host's id) is shown as a root too, so nothing disappears.
import { PARENT_AGENT_ID_LABEL } from "@frogg/protocol/agent-labels";
import { bucketOf, type Bucket, type Session } from "../../daemon/types";

/** Most urgent first; the order of the session list's state groups. */
export const BUCKET_RANK: Bucket[] = ["needs", "failed", "review", "working", "idle"];

const MAX_DEPTH = 8;

export const sessionKey = (x: Session) => `${x.hostId ?? ""}:${x.agent.id}`;

export interface Family {
  /** The top of the session's parent chain on its host (itself when it has no loaded parent). */
  rootOf: (x: Session) => Session;
  /** The direct parent when it is loaded on the same host. */
  parentOf: (x: Session) => Session | undefined;
  /** The most urgent state across a root and everything under it. */
  bucketOf: (root: Session) => Bucket;
}

export function buildFamily(pool: readonly Session[]): Family {
  const byKey = new Map(pool.map((x) => [sessionKey(x), x]));
  const parentOf = (x: Session): Session | undefined => {
    const id = x.agent.labels?.[PARENT_AGENT_ID_LABEL];
    if (!id || id === x.agent.id) return undefined;
    return byKey.get(`${x.hostId ?? ""}:${id}`);
  };
  const roots = new Map<Session, Session>();
  const rootOf = (x: Session): Session => {
    const known = roots.get(x);
    if (known) return known;
    let cur = x;
    // Bounded; a session in a parent cycle (a → b → a) is its own root, so none of it is hidden.
    for (let n = 0; n < MAX_DEPTH; n++) {
      const p = parentOf(cur);
      if (!p) break;
      if (p === x) {
        cur = x;
        break;
      }
      cur = p;
    }
    roots.set(x, cur);
    return cur;
  };
  const worst = new Map<Session, number>();
  for (const x of pool) {
    const root = rootOf(x);
    const rank = BUCKET_RANK.indexOf(bucketOf(x.agent));
    const cur = worst.get(root);
    if (cur === undefined || rank < cur) worst.set(root, rank);
  }
  return {
    rootOf,
    parentOf,
    bucketOf: (root) => BUCKET_RANK[worst.get(root) ?? BUCKET_RANK.indexOf(bucketOf(root.agent))],
  };
}

export interface FamilyFilters {
  /** Whether a root belongs to the current scope (chats, a project, all). */
  inScope: (root: Session) => boolean;
  /** Root-level filters: hidden, label. */
  passes: (root: Session) => boolean;
  /** The search, tried on every member: a matching child brings its family into view. */
  matches: (x: Session) => boolean;
}

export interface FamilyRows {
  /** Every session in scope, children included (the status counts). */
  inScope: Session[];
  /** The rows to list: roots whose family passed. */
  roots: Session[];
  /** Keys of another host's children, which are listed indented under their root. */
  nested: Set<string>;
  /** Puts another host's children right after their root in a row list. */
  withKids: (list: Session[]) => Session[];
}

export function familyRows(pool: readonly Session[], fam: Family, f: FamilyFilters): FamilyRows {
  const inScope = pool.filter((x) => f.inScope(fam.rootOf(x)));
  const shown = new Set<Session>();
  for (const x of inScope) {
    const root = fam.rootOf(x);
    if (f.passes(root) && f.matches(x)) shown.add(root);
  }
  // The sub-work strip that lists children reads the active host only, so another host's
  // children follow their root as rows of their own.
  const kids = new Map<Session, Session[]>();
  const nested = new Set<string>();
  for (const x of inScope) {
    const root = fam.rootOf(x);
    if (x === root || !x.hostId || !shown.has(root)) continue;
    kids.set(root, [...(kids.get(root) ?? []), x]);
    nested.add(sessionKey(x));
  }
  const withKids = (list: Session[]) =>
    kids.size ? list.flatMap((x) => [x, ...(kids.get(x) ?? [])]) : list;
  return { inScope, roots: [...shown], nested, withKids };
}
