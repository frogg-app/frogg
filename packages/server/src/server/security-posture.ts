import type {
  SecurityFinding,
  SecurityFindingId,
  SecurityFindingSeverity,
  SecurityFixAction,
  SecurityPosture,
} from "@frogg/protocol/messages";

import { isLoopbackIp } from "./access-policy.js";
import type { ListenTarget } from "./listen-target.js";

/** The brand manifest's daemon defaults (`brand.daemon`) the posture compares against. */
export interface SecurityPostureBrandDefaults {
  bind: "all" | "loopback";
  trustLan: boolean;
  claimMode: boolean;
}

export interface SecurityPostureInput {
  /** Effective values, after env and config.json overrides. */
  claimMode: boolean;
  /** Effective LAN trust (already false whenever claim mode is on). */
  trustLan: boolean;
  hasPassword: boolean;
  /** A device is paired, the claim latch is set, or a password is set. */
  claimed: boolean;
  listenTarget: ListenTarget | null;
  brand: SecurityPostureBrandDefaults;
  /** Finding ids the owner marked as intended (`daemon.security.acknowledgedFindings`). */
  acknowledged?: ReadonlySet<string>;
}

/** A TCP listener on anything other than loopback is reachable from the network. */
export function isExposedListenTarget(target: ListenTarget | null): boolean {
  if (!target || target.type !== "tcp") return false;
  const host = target.host.replace(/^\[|\]$/g, "");
  return host !== "localhost" && !isLoopbackIp(host);
}

function finding(
  id: SecurityFindingId,
  severity: SecurityFindingSeverity,
  fixAction: SecurityFixAction,
): SecurityFinding {
  return { id, severity, fixAction };
}

/**
 * Compare the daemon's effective access settings with what its brand manifest
 * ships. Divergence findings are relative to the brand, so a brand that opts
 * into an open posture gets no divergence warnings; core never checks the
 * brand's name.
 */
export function computeSecurityPosture(input: SecurityPostureInput): SecurityPosture {
  const findings: SecurityFinding[] = [];
  const exposed = isExposedListenTarget(input.listenTarget);

  if (input.claimMode && !input.claimed) {
    findings.push(finding("unclaimed", exposed ? "critical" : "warning", "claim"));
  }
  // Only a listener reachable off loopback is exposed. Trusted LAN widens who
  // may connect without credentials, but a loopback-only bind never sees LAN peers.
  if (exposed && !input.hasPassword && !input.claimMode) {
    findings.push(finding("exposed_without_password", "critical", "set_password"));
  }
  if (input.trustLan && !input.brand.trustLan) {
    findings.push(finding("trust_lan_diverges", "warning", "disable_trust_lan"));
  }
  if (exposed && input.brand.bind === "loopback") {
    findings.push(finding("bind_diverges", "warning", "bind_loopback"));
  }
  if (!input.claimMode && input.brand.claimMode) {
    findings.push(finding("claim_mode_diverges", "warning", "enable_claim_mode"));
  }
  return splitAcknowledged(findings, input.acknowledged);
}

/** Only warnings can be marked intended; a critical finding stays until it is fixed. */
export function isAcknowledgeable(item: SecurityFinding): boolean {
  return item.severity === "warning";
}

/**
 * Apply an owner's "this is intended" (or its undo) to the acknowledged set and
 * return the ids to persist. Refuses to acknowledge a finding that is critical now.
 */
export function updateAcknowledgedFindings(input: {
  acknowledged: Set<string>;
  current: SecurityPosture;
  findingId: string;
  acknowledge: boolean;
}): string[] {
  if (input.acknowledge) {
    const current = input.current.findings.find((item) => item.id === input.findingId);
    if (current && !isAcknowledgeable(current)) {
      throw new Error("A critical finding cannot be marked as intended; fix it instead");
    }
    input.acknowledged.add(input.findingId);
  } else {
    input.acknowledged.delete(input.findingId);
  }
  return [...input.acknowledged].sort();
}

function splitAcknowledged(
  findings: SecurityFinding[],
  acknowledged: ReadonlySet<string> | undefined,
): SecurityPosture {
  if (!acknowledged || acknowledged.size === 0) return { findings };
  const active: SecurityFinding[] = [];
  const intended: SecurityFinding[] = [];
  for (const item of findings) {
    (isAcknowledgeable(item) && acknowledged.has(item.id) ? intended : active).push(item);
  }
  return intended.length > 0 ? { findings: active, acknowledged: intended } : { findings };
}
