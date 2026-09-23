/**
 * Version probing and comparison for provider CLIs.
 *
 * Provider `--version` output is not standardised — some print a bare semver,
 * others decorate it ("1.2.3 (Claude Code)") — so the version is extracted
 * rather than parsed strictly.
 */

import { createProviderEnvSpec } from "../../server/agent/provider-launch-config.js";
import { execCommand } from "../../utils/spawn.js";

const VERSION_PROBE_TIMEOUT_MS = 10_000;

export function extractVersion(output: string): string | null {
  const match = output.match(/\b(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?\b/);
  return match ? match[0] : null;
}

function parseParts(value: string): { numbers: number[]; prerelease: string | null } | null {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null,
  };
}

/** Returns >0 when `left` is newer, <0 when older, 0 when equal or uncomparable. */
export function compareVersions(left: string, right: string): number {
  const leftParts = parseParts(left);
  const rightParts = parseParts(right);
  if (!leftParts || !rightParts) return 0;
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts.numbers[index] - rightParts.numbers[index];
    if (difference !== 0) return difference;
  }
  // A release outranks any prerelease of the same version.
  if (leftParts.prerelease === rightParts.prerelease) return 0;
  if (leftParts.prerelease === null) return 1;
  if (rightParts.prerelease === null) return -1;
  return leftParts.prerelease < rightParts.prerelease ? -1 : 1;
}

export function isNewerVersion(candidate: string | null, current: string | null): boolean {
  if (!candidate) return false;
  if (!current) return true;
  return compareVersions(candidate, current) > 0;
}

export interface ProbeVersionResult {
  version: string | null;
  error?: string;
}

export async function probeInstalledVersion(
  command: string,
  args: string[],
  signal?: AbortSignal,
): Promise<ProbeVersionResult> {
  try {
    const { stdout, stderr } = await execCommand(command, args, {
      ...createProviderEnvSpec(),
      timeout: VERSION_PROBE_TIMEOUT_MS,
      signal,
    });
    const version = extractVersion(stdout) ?? extractVersion(stderr);
    return version ? { version } : { version: null, error: "Version output not recognised" };
  } catch (error) {
    return { version: null, error: error instanceof Error ? error.message : String(error) };
  }
}
