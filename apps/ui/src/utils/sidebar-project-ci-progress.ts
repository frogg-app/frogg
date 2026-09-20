import type { SidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";
import {
  EMPTY_CHECKS_PROGRESS,
  mergeChecksProgress,
  summarizeChecksProgress,
  type ChecksProgress,
} from "@/git/checks-progress";

/**
 * A project's CI as one ring: every open change request under it, rolled together.
 *
 * Only open change requests count. A merged or closed one's checks are history — its
 * ring would be complete anyway, but including them would let a long-dead branch dilute
 * the fraction of the run the user is actually watching.
 *
 * The check data already rides on the workspace descriptors the daemon pushes, so this
 * is a pure reduction over state the sidebar holds — no extra fetch per project.
 */
export function selectProjectChecksProgress(
  workspaces: readonly (SidebarWorkspaceEntry | null | undefined)[],
): ChecksProgress {
  const runs = workspaces.flatMap((workspace) => {
    const hint = workspace?.prHint;
    if (!hint || hint.state !== "open" || !hint.checks) {
      return [];
    }
    const progress = summarizeChecksProgress(hint.checks);
    return progress.total === 0 ? [] : [progress];
  });
  return runs.length === 0 ? EMPTY_CHECKS_PROGRESS : mergeChecksProgress(runs);
}
