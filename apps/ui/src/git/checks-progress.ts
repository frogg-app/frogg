/**
 * How far through a CI run a change request is, reduced to the one number a progress
 * ring can draw.
 *
 * This is deliberately *measured* rather than estimated: the fraction is the share of
 * check runs that have reported back, not a guess against a previous run's duration.
 * A ring drawn from an estimate stalls at 100% or overshoots, and the user reads it as
 * broken; a ring drawn from completed checks only ever moves when something real
 * finished.
 *
 * Skipped and cancelled checks classify as `ignored` and count as finished — they will
 * never report anything further, so leaving them in the remainder would park the ring
 * short of full for the rest of the run.
 */
import { classifyCheck, type PresentableCheck } from "@/git/check-presentation";

export interface ChecksProgress {
  /** Every check in the run, finished or not. */
  total: number;
  /** Checks that have reported a terminal result. */
  completed: number;
  /** Completed share of the run, 0..1. Zero checks reads as 0 rather than NaN. */
  fraction: number;
  /** True while at least one check is still in flight. */
  running: boolean;
}

export const EMPTY_CHECKS_PROGRESS: ChecksProgress = {
  total: 0,
  completed: 0,
  fraction: 0,
  running: false,
};

function buildProgress(total: number, completed: number): ChecksProgress {
  return {
    total,
    completed,
    fraction: total === 0 ? 0 : completed / total,
    running: completed < total,
  };
}

export function summarizeChecksProgress(
  checks: readonly PresentableCheck[] | null | undefined,
): ChecksProgress {
  if (!checks || checks.length === 0) {
    return EMPTY_CHECKS_PROGRESS;
  }
  const completed = checks.filter((check) => classifyCheck(check) !== "pending").length;
  return buildProgress(checks.length, completed);
}

/**
 * Rolls several runs into one ring — a project's ring covers every workspace under it,
 * so a project with two branches building shows one bar across both runs rather than
 * flickering between them.
 */
export function mergeChecksProgress(runs: readonly ChecksProgress[]): ChecksProgress {
  let total = 0;
  let completed = 0;
  for (const run of runs) {
    total += run.total;
    completed += run.completed;
  }
  return total === 0 ? EMPTY_CHECKS_PROGRESS : buildProgress(total, completed);
}
