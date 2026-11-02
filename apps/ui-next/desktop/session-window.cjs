// Popped-out session windows (#90): a second BrowserWindow on the same app origin, so it shares
// the saved hosts and pairing keys, routed to one session on one host.

/** Agent and host ids are short opaque tokens; anything else is refused before it reaches a URL. */
const ID = /^[\w.:-]{1,200}$/;

/** The validated `{ sessionId, hostId }` from the renderer, or null. */
function parseSessionWindowRequest(input) {
  if (!input || typeof input !== "object") return null;
  const { sessionId, hostId } = input;
  if (typeof sessionId !== "string" || !ID.test(sessionId)) return null;
  if (hostId !== undefined && hostId !== null && (typeof hostId !== "string" || !ID.test(hostId)))
    return null;
  return { sessionId, hostId: hostId ?? null };
}

/** Query entries that route the UI to the popped-out session. */
function sessionWindowQuery({ sessionId, hostId }) {
  return hostId ? { popout: sessionId, host: hostId } : { popout: sessionId };
}

/** One window per host and session: popping the same one out again focuses it. */
const sessionWindowKey = ({ sessionId, hostId }) => `${hostId ?? ""}/${sessionId}`;

module.exports = { parseSessionWindowRequest, sessionWindowQuery, sessionWindowKey };
