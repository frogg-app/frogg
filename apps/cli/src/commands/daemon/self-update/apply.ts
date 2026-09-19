import {
  appendSelfUpdateLog,
  readCurrentVersion,
  setCurrentVersion,
  writeLastUpdate,
  writePreviousVersion,
  type LastUpdateRecord,
} from "./layout.js";
import type { ServiceManager } from "./service.js";
import { waitForDaemonVersion, type DaemonProbe, type VerifyResult } from "./verify.js";

/**
 * The supervisor step, run by the detached `frogg daemon self-update --apply`
 * process: flip `current`, restart, verify; on failure flip back to
 * `previous`, restart, verify again. Whatever happens ends in
 * `last-update.json` so the daemon and the CLI can report it afterwards.
 */
export interface ApplyPlan {
  installDir: string;
  version: string;
  previous: string | null;
  httpBase: string | null;
  verifyTimeoutMs?: number;
}

export interface ApplyDependencies {
  service: ServiceManager;
  probe?: DaemonProbe;
  log?: (line: string) => void;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export type ApplyOutcome = LastUpdateRecord;

async function restartAndVerify(
  plan: ApplyPlan,
  deps: ApplyDependencies,
  version: string,
  log: (line: string) => void,
): Promise<VerifyResult> {
  try {
    await deps.service.restart();
  } catch (error) {
    return {
      ok: false,
      kind: "not_running",
      reason: `restart failed: ${error instanceof Error ? error.message : error}`,
    };
  }
  if (!plan.httpBase) {
    log(`no TCP listen address to verify; assuming ${version} is up`);
    return { ok: true, elapsedMs: 0 };
  }
  return waitForDaemonVersion(
    {
      httpBase: plan.httpBase,
      expectedVersion: version,
      timeoutMs: plan.verifyTimeoutMs,
      isRunning: () => deps.service.isRunning(),
      sleep: deps.sleep,
    },
    deps.probe,
  );
}

async function retireConflicts(
  deps: ApplyDependencies,
  log: (line: string) => void,
  force: boolean,
): Promise<number> {
  if (!deps.service.retireConflictingServices) return 0;
  try {
    const retired = await deps.service.retireConflictingServices({ force });
    if (retired.length > 0) log(`retired competing services: ${retired.join(", ")}`);
    return retired.length;
  } catch (error) {
    log(`could not retire competing services: ${error instanceof Error ? error.message : error}`);
    return 0;
  }
}

function restorePrevious(
  plan: ApplyPlan,
  previous: string,
  log: (line: string) => void,
): "restored" | "failed" {
  try {
    setCurrentVersion(plan.installDir, previous);
    log(`restored current -> ${previous}`);
    return "restored";
  } catch (error) {
    log(`could not restore ${previous}: ${error instanceof Error ? error.message : error}`);
    return "failed";
  }
}

/**
 * Another daemon still owns the port, so the new bundle was never tested.
 * Waiting on a rollback verify is pointless (the same foreign daemon answers
 * for any version), but keeping an unverified bundle as `current` could strand
 * the host on a broken release once the port frees up. Put the version that
 * was demonstrably running back without waiting; it binds as soon as the other
 * daemon stops, and auto-update retries later. Returns what was kept.
 */
async function restoreBehindForeignListener(
  plan: ApplyPlan,
  deps: ApplyDependencies,
  previous: string | null,
  log: (line: string) => void,
): Promise<string> {
  if (
    !previous ||
    previous === plan.version ||
    restorePrevious(plan, previous, log) !== "restored"
  ) {
    return `kept ${plan.version} installed (the port is held by another daemon)`;
  }
  try {
    await deps.service.restart();
  } catch (error) {
    log(`restart into ${previous} failed: ${error instanceof Error ? error.message : error}`);
  }
  return `restored ${previous} without verifying it (the port is held by another daemon)`;
}

export async function applyUpdate(plan: ApplyPlan, deps: ApplyDependencies): Promise<ApplyOutcome> {
  const log = deps.log ?? ((line: string) => appendSelfUpdateLog(plan.installDir, line));
  const now = deps.now ?? (() => new Date());
  const finish = (record: ApplyOutcome): ApplyOutcome => {
    writeLastUpdate(plan.installDir, record);
    log(
      `${record.status}: ${record.from ?? "?"} -> ${record.to}${
        record.reason ? ` (${record.reason})` : ""
      }`,
    );
    return record;
  };

  const from = readCurrentVersion(plan.installDir);
  const previous = plan.previous ?? from;
  log(
    `applying ${plan.version} (current ${from ?? "none"}, previous ${
      previous ?? "none"
    }, service ${deps.service.kind})`,
  );

  try {
    if (from !== plan.version) {
      writePreviousVersion(plan.installDir, previous);
      setCurrentVersion(plan.installDir, plan.version);
    }
  } catch (error) {
    return finish({
      from,
      to: plan.version,
      status: "failed",
      reason: `could not switch current: ${error instanceof Error ? error.message : error}`,
      at: now().toISOString(),
    });
  }

  await retireConflicts(deps, log, false);
  log(`restarting daemon into ${plan.version}`);
  let verified = await restartAndVerify(plan, deps, plan.version, log);
  if (!verified.ok && verified.kind === "foreign_listener") {
    log(`update to ${plan.version} blocked: ${verified.reason}`);
    if ((await retireConflicts(deps, log, true)) > 0) {
      log(`restarting daemon into ${plan.version} after retiring the competing service`);
      verified = await restartAndVerify(plan, deps, plan.version, log);
    }
  }
  if (!verified.ok && verified.kind === "foreign_listener") {
    const kept = await restoreBehindForeignListener(plan, deps, previous, log);
    return finish({
      from,
      to: plan.version,
      status: "failed",
      reason: `${verified.reason}; ${kept}`,
      at: now().toISOString(),
    });
  }
  if (verified.ok) {
    // A retained execution service may still load code from any older release.
    log(
      "retained installed versions for independent execution; remove only after stopping all execution",
    );
    return finish({
      from,
      to: plan.version,
      status: "applied",
      reason: null,
      at: now().toISOString(),
    });
  }

  log(`update to ${plan.version} failed: ${verified.reason}`);
  if (!previous || previous === plan.version) {
    return finish({
      from,
      to: plan.version,
      status: "failed",
      reason: `${verified.reason}; no previous version to roll back to`,
      at: now().toISOString(),
    });
  }

  log(`rolling back to ${previous}`);
  try {
    setCurrentVersion(plan.installDir, previous);
  } catch (error) {
    return finish({
      from,
      to: plan.version,
      status: "failed",
      reason: `${verified.reason}; rollback could not switch current: ${
        error instanceof Error ? error.message : error
      }`,
      at: now().toISOString(),
    });
  }
  const rolledBack = await restartAndVerify(plan, deps, previous, log);
  if (rolledBack.ok) {
    return finish({
      from,
      to: plan.version,
      status: "rolled_back",
      reason: verified.reason,
      at: now().toISOString(),
    });
  }
  return finish({
    from,
    to: plan.version,
    status: "failed",
    reason: `${verified.reason}; rollback to ${previous} also failed: ${rolledBack.reason}`,
    at: now().toISOString(),
  });
}
