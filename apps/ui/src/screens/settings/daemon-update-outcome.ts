import type { DaemonUpdateGetStatusResponse } from "@frogg/protocol/messages";

type StatusPayload = DaemonUpdateGetStatusResponse["payload"];

/**
 * The outcome to show for the last self-update. A failed or rolled-back
 * attempt at the version the daemon is running now has since applied (the
 * port freed up, the host was restarted); older daemons still report
 * the stale failure, so the client reconciles too.
 */
export function effectiveLastUpdateResult(
  status: Pick<StatusPayload, "lastResult" | "currentVersion"> | null | undefined,
): StatusPayload["lastResult"] {
  const last = status?.lastResult ?? null;
  if (!last || last.status === "applied" || last.to !== status?.currentVersion) return last;
  return { ...last, status: "applied", reason: null };
}
