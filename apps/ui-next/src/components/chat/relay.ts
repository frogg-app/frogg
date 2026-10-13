// Messages one agent sends another arrive as user messages with a sender prefix, written by
// the sending agent:
//   From Google Suite agent (cf989ce): …
//   From the "Frogg Plugin: Google Suite" agent (cf989ce, worktree ~/.frogg/worktrees/…): …

export interface Relay {
  /** Sender's name as written, without quotes. */
  name: string;
  /** Short agent id (a prefix of the sender's id). */
  id: string;
  /** Anything after the id inside the parentheses, e.g. "worktree ~/…". */
  where: string | null;
  /** The message without the prefix. */
  body: string;
}

const RELAY =
  /^From (?:the )?(?:"([^"\n]+)"|“([^”\n]+)”|'([^'\n]+)'|([^\n()]+?)) agent \(([\w-]{4,})(?:,\s*([^)\n]*))?\):[ \t]*\n?/;

export function parseRelay(text: string): Relay | null {
  const m = RELAY.exec(text.trimStart());
  if (!m) return null;
  const name = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim();
  if (!name) return null;
  return {
    name,
    id: m[5],
    where: m[6]?.trim() || null,
    body: text.trimStart().slice(m[0].length),
  };
}

/** The session whose id starts with the relay's short id, when exactly one does. */
export function resolveSender(id: string, ids: Iterable<string>): string | null {
  const want = id.toLowerCase();
  let hit: string | null = null;
  for (const x of ids) {
    if (!x.toLowerCase().startsWith(want)) continue;
    if (hit) return null;
    hit = x;
  }
  return hit;
}
