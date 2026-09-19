import type { DaemonClientErrorInfo } from "@frogg/client/internal/daemon-client";
import { i18n } from "@/i18n/i18next";

/**
 * The host's last connection error as the UI shows it: failures the client
 * reports with a structured code render as translated copy; anything else is
 * the raw transport text.
 */
export function describeHostConnectionError(
  snapshot:
    | { lastError: string | null; lastErrorInfo?: DaemonClientErrorInfo | null }
    | null
    | undefined,
): string | null {
  const info = snapshot?.lastErrorInfo ?? null;
  if (info?.code === "server_identity_mismatch") {
    return i18n.t("settings.host.connectionErrors.serverIdentityMismatch", {
      expectedServerId: info.expectedServerId,
      actualServerId: info.actualServerId,
    });
  }
  const raw = snapshot?.lastError?.trim() ?? "";
  return raw.length > 0 ? raw : null;
}
