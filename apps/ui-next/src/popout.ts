// A popped-out session window (desktop only): the shell opens a second window on the same origin
// with `?popout=<session id>&host=<host id>`. That window shows only that session's chat, on the
// same saved hosts and pairing as the main window.

export interface PopoutRoute {
  session: string;
  host: string | null;
}

const KEY = "frogg.next.popout";

/** Parses the window's query; also used by tests. */
export function parsePopout(search: string): PopoutRoute | null {
  const q = new URLSearchParams(search);
  const session = q.get("popout")?.trim();
  if (!session) return null;
  return { session, host: q.get("host")?.trim() || null };
}

/** Read once and kept in this window's sessionStorage: in-app navigation drops the query. */
function readPopout(): PopoutRoute | null {
  if (typeof location === "undefined") return null;
  const store = typeof sessionStorage === "undefined" ? null : sessionStorage;
  const asked = parsePopout(location.search);
  if (asked) {
    store?.setItem(KEY, JSON.stringify(asked));
    return asked;
  }
  try {
    const kept = store?.getItem(KEY);
    return kept ? (JSON.parse(kept) as PopoutRoute) : null;
  } catch {
    return null;
  }
}

export const popout: PopoutRoute | null = readPopout();
