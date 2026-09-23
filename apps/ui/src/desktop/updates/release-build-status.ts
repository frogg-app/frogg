// The CI job that is still building this platform's installer.
//
// Shown in Settings > Updates when a newer version exists but its download for
// this platform has not been published yet, so "no download yet" becomes "the
// build is 12 of 20 steps in". The shell owns the GitHub Actions requests and
// their cache; this module parses and polls its answer.

import { invokeDesktopCommand } from "@/desktop/electron/invoke";

export type ReleaseBuildState = "queued" | "running" | "succeeded" | "failed";

export interface ReleaseBuildStatus {
  version: string;
  state: ReleaseBuildState;
  jobName: string;
  completedSteps: number;
  totalSteps: number;
  currentStep: string | null;
  startedAt: number | null;
  url: string | null;
}

/** Matches the shell's cache interval; polling faster only re-reads the cache. */
export const RELEASE_BUILD_STATUS_POLL_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function toState(value: unknown): ReleaseBuildState | null {
  return value === "queued" || value === "running" || value === "succeeded" || value === "failed"
    ? value
    : null;
}

export function parseReleaseBuildStatus(raw: unknown): ReleaseBuildStatus | null {
  if (!isRecord(raw)) return null;
  const state = toState(raw.state);
  const jobName = toStringOrNull(raw.jobName);
  const version = toStringOrNull(raw.version);
  if (!state || !jobName || !version) return null;
  const totalSteps = toCount(raw.totalSteps);
  return {
    version,
    state,
    jobName,
    completedSteps: Math.min(toCount(raw.completedSteps), totalSteps),
    totalSteps,
    currentStep: toStringOrNull(raw.currentStep),
    startedAt:
      typeof raw.startedAt === "number" && Number.isFinite(raw.startedAt) && raw.startedAt > 0
        ? raw.startedAt
        : null,
    url: toStringOrNull(raw.url),
  };
}

/** 0..1 for the bar, or `null` while the job is queued and has no steps yet. */
export function releaseBuildFraction(status: ReleaseBuildStatus): number | null {
  if (status.totalSteps <= 0) return null;
  return Math.min(1, status.completedSteps / status.totalSteps);
}

export async function fetchReleaseBuildStatus(version: string): Promise<ReleaseBuildStatus | null> {
  const result = await invokeDesktopCommand<unknown>("get_release_build_status", { version });
  return parseReleaseBuildStatus(result);
}
