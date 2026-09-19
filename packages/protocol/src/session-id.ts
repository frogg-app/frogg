/**
 * Short, human-quotable session IDs.
 *
 * Every agent already has a UUID, and every provider subagent is already unique under
 * `parentAgentId\0subagentId`. What neither gives you is something a person can read out,
 * type, or paste into a message. A session ID is that short form: `s_` plus eight Crockford
 * base32 characters over 40 bits.
 *
 * These are DERIVED, never stored. There is no wire field and no persistence: every surface
 * calls the same helper on the same input and gets the same string back. That is the whole
 * point — an ID that needs a lookup table is just another identifier to keep in sync.
 *
 * Crockford base32 is what makes it quotable: no `I`, `L`, `O` or `U`, so there is no
 * 1/I/l or 0/O confusion to resolve over a voice call, and matching is case-insensitive
 * with the ambiguous glyphs folded back onto the digits they look like.
 *
 * Pure and dependency-free on purpose: this runs in the daemon, in the Expo client on
 * every platform, and in tests, so it cannot reach for `node:crypto`.
 */

/** Crockford base32: the digits and uppercase letters minus `I`, `L`, `O` and `U`. */
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Bytes of entropy in a session ID. 5 bytes is 40 bits, which is exactly 8 base32 chars. */
const SESSION_ID_BYTES = 5;

/** The `s_` marks a string as a session ID so it is never mistaken for a branch or a name. */
export const SESSION_ID_PREFIX = "s_";

/** Characters after the prefix. */
export const SESSION_ID_LENGTH = 8;

/**
 * An agent (or subagent) paired with the session ID derived from it. Resolution works over
 * these rather than over raw agent IDs because a subagent's session ID comes from a
 * composite key that a single agent ID cannot reproduce.
 */
export interface SessionIdCandidate {
  /** The agent's UUID, or the subagent's own id. Matched when the user pastes a full UUID. */
  agentId: string;
  /** The derived `s_…` session ID. */
  sessionId: string;
}

export type SessionIdResolution =
  | { kind: "match"; candidate: SessionIdCandidate }
  /** A prefix that fits more than one session. Never guessed: the caller must disambiguate. */
  | { kind: "ambiguous"; candidates: SessionIdCandidate[] }
  | { kind: "not-found" };

function encodeCrockford(bytes: readonly number[]): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | (byte & 0xff);
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD_ALPHABET[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    out += CROCKFORD_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

/** The 32 hex digits of a UUID, or `null` when the input is not one. */
function uuidHexDigits(input: string): string | null {
  const hex = input.trim().replace(/-/g, "").toLowerCase();
  if (hex.length !== 32) return null;
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return hex;
}

/**
 * FNV-1a, run with four different offset bases to produce the five bytes.
 *
 * A session ID is a display handle, not a security boundary, so a fast non-cryptographic
 * hash is the right tool; what matters is that it is stable across platforms and spreads
 * inputs evenly enough that 40 bits of space is not wasted.
 */
function hashToBytes(input: string, byteCount: number): number[] {
  const seeds = [0x811c9dc5, 0x01000193, 0x9dc5811c, 0xdeadbeef];
  const words: number[] = [];
  for (const seed of seeds) {
    let hash = seed >>> 0;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index) & 0xff;
      hash = Math.imul(hash, 0x01000193) >>> 0;
      hash ^= (input.charCodeAt(index) >>> 8) & 0xff;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    words.push(hash >>> 0);
  }

  const bytes: number[] = [];
  for (const word of words) {
    bytes.push((word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff);
  }
  return bytes.slice(0, byteCount);
}

function formatSessionId(bytes: readonly number[]): string {
  return SESSION_ID_PREFIX + encodeCrockford(bytes).slice(0, SESSION_ID_LENGTH);
}

/**
 * The session ID for an agent.
 *
 * A UUID is already uniformly random, so the first five bytes are taken as-is rather than
 * hashed — the ID stays a visible slice of the identifier it names. Anything that is not a
 * UUID (a legacy or synthetic id) is hashed instead, so every agent still gets an ID.
 */
export function toSessionId(agentId: string): string {
  const hex = uuidHexDigits(agentId);
  if (!hex) {
    return formatSessionId(hashToBytes(agentId.trim(), SESSION_ID_BYTES));
  }
  const bytes: number[] = [];
  for (let index = 0; index < SESSION_ID_BYTES; index += 1) {
    bytes.push(Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
  }
  return formatSessionId(bytes);
}

/**
 * The session ID for a provider subagent.
 *
 * Subagent ids are only unique under their parent, so the ID is derived from the same
 * `parentAgentId\0subagentId` composite key the subagent store is keyed by. A subagent
 * therefore has an identity of its own while still attached to its parent, and two
 * subagents that happen to share a provider-assigned id under different parents do not
 * collide.
 */
export function toSubagentSessionId(parentAgentId: string, subagentId: string): string {
  const key = `${parentAgentId.trim()}\u0000${subagentId.trim()}`;
  return formatSessionId(hashToBytes(key, SESSION_ID_BYTES));
}

/**
 * Fold a user-typed session ID onto its canonical characters: case-insensitive, with the
 * glyphs Crockford omits mapped to the digits they are mistaken for.
 */
function normalizeSessionIdInput(input: string): string {
  return input.trim().replace(/^s_/i, "").toUpperCase().replace(/[IL]/g, "1").replace(/O/g, "0");
}

function normalizeSessionId(sessionId: string): string {
  return sessionId.slice(SESSION_ID_PREFIX.length).toUpperCase();
}

/**
 * Resolve user input to a session.
 *
 * Accepts a full agent UUID, a full `s_…` session ID, or any unambiguous prefix of one.
 * An input that fits several sessions returns `ambiguous` with all of them rather than
 * picking one: silently acting on the wrong session is worse than asking again.
 */
export function resolveSessionId(
  input: string,
  candidates: readonly SessionIdCandidate[],
): SessionIdResolution {
  const raw = input.trim();
  if (raw.length === 0) {
    return { kind: "not-found" };
  }

  // A full UUID names exactly one agent, so it is checked before any prefix logic.
  const hex = uuidHexDigits(raw);
  if (hex) {
    const match = candidates.find(
      (candidate) => uuidHexDigits(candidate.agentId) === hex || candidate.agentId === raw,
    );
    return match ? { kind: "match", candidate: match } : { kind: "not-found" };
  }

  const normalized = normalizeSessionIdInput(raw);
  if (normalized.length === 0) {
    return { kind: "not-found" };
  }

  const exact = candidates.filter(
    (candidate) => normalizeSessionId(candidate.sessionId) === normalized,
  );
  if (exact.length === 1) {
    return { kind: "match", candidate: exact[0] as SessionIdCandidate };
  }
  if (exact.length > 1) {
    return { kind: "ambiguous", candidates: exact };
  }

  const prefixed = candidates.filter((candidate) =>
    normalizeSessionId(candidate.sessionId).startsWith(normalized),
  );
  if (prefixed.length === 1) {
    return { kind: "match", candidate: prefixed[0] as SessionIdCandidate };
  }
  if (prefixed.length > 1) {
    return { kind: "ambiguous", candidates: prefixed };
  }
  return { kind: "not-found" };
}
