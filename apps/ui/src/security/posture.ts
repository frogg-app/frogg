import {
  SECURITY_FINDING_IDS,
  SECURITY_FIX_ACTIONS,
  type SecurityFinding,
  type SecurityFindingId,
  type SecurityFixAction,
} from "@frogg/protocol/messages";
import type { DaemonServerInfo } from "@/stores/session-store";

export type SecuritySeverity = "critical" | "warning";

/** A finding as the UI renders it. Unknown ids and actions fall back to generic copy. */
export interface SecurityFindingView {
  id: string;
  knownId: SecurityFindingId | null;
  severity: SecuritySeverity;
  fixAction: SecurityFixAction | null;
}

export interface SecurityPostureView {
  findings: readonly SecurityFindingView[];
  /** The worst severity present, or null when there is nothing to show. */
  severity: SecuritySeverity | null;
}

export const EMPTY_SECURITY_POSTURE: SecurityPostureView = {
  findings: [],
  severity: null,
};

function isKnown<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value);
}

export function toFindingView(finding: SecurityFinding): SecurityFindingView {
  return {
    id: finding.id,
    knownId: isKnown(SECURITY_FINDING_IDS, finding.id) ? finding.id : null,
    // Anything the app does not know is shown as a warning, never dropped.
    severity: finding.severity === "critical" ? "critical" : "warning",
    fixAction: isKnown(SECURITY_FIX_ACTIONS, finding.fixAction) ? finding.fixAction : null,
  };
}

/**
 * The findings this connection should surface. Only owners receive
 * `server_info.security`, and only daemons advertising
 * `features.securityPosture` send it, so an older daemon, an operator and a
 * viewer all get nothing.
 */
export function readSecurityPosture(
  serverInfo: Pick<DaemonServerInfo, "features" | "callerRole" | "security"> | null | undefined,
): SecurityPostureView {
  if (serverInfo?.features?.securityPosture !== true) return EMPTY_SECURITY_POSTURE;
  if (serverInfo.callerRole && serverInfo.callerRole !== "owner") return EMPTY_SECURITY_POSTURE;
  const raw = serverInfo.security?.findings ?? [];
  if (raw.length === 0) return EMPTY_SECURITY_POSTURE;
  const findings = raw.map(toFindingView);
  const severity = findings.some((finding) => finding.severity === "critical")
    ? "critical"
    : "warning";
  return { findings, severity };
}
