import { type Forge, forgeFromRemoteUrl, getForgePresentation } from "@/git/forge";
import type { DesktopOpenTarget, OpenDesktopTargetInput } from "@/workspace/desktop-open-targets";
import {
  type ResolvedWorkspaceFilePaths,
  resolveWorkspaceFilePaths,
  type WorkspaceFileLocation,
} from "@/workspace/file-open";

interface CheckoutStatusForOpenTarget {
  isGit: boolean;
  remoteUrl?: string | null;
  currentBranch?: string | null;
}

export interface PlannedDesktopOpenTarget {
  source: "desktop";
  id: string;
  label: string;
  editorId: string;
  icon: DesktopOpenTarget["icon"];
  openInput: OpenDesktopTargetInput;
}

export interface PlannedForgeOpenTarget {
  source: "forge";
  forge: Forge;
  id: Forge;
  label: string;
  url: string;
}

export type PlannedWorkspaceOpenTarget = PlannedDesktopOpenTarget | PlannedForgeOpenTarget;

export interface PlanWorkspaceOpenTargetsInput {
  workspaceDirectory: string;
  directoryPath?: string | null;
  activeFile?: WorkspaceFileLocation | null;
  resolvedActiveFile?: ResolvedWorkspaceFilePaths | null;
  desktopTargets: readonly DesktopOpenTarget[];
  canUseDesktopBridge: boolean;
  isLocalExecution: boolean;
  checkoutStatus?: CheckoutStatusForOpenTarget | null;
  forge?: Forge | null;
}

function resolveActiveFileForOpenTargets(
  input: Pick<
    PlanWorkspaceOpenTargetsInput,
    "activeFile" | "resolvedActiveFile" | "workspaceDirectory"
  >,
): ResolvedWorkspaceFilePaths | null {
  if (input.resolvedActiveFile !== undefined) {
    return input.resolvedActiveFile;
  }
  return input.activeFile
    ? resolveWorkspaceFilePaths({
        path: input.activeFile.path,
        workspaceRoot: input.workspaceDirectory,
      })
    : null;
}

function planDesktopOpenTargets(input: {
  workspaceDirectory: string;
  directoryPath?: string | null;
  activeFile?: WorkspaceFileLocation | null;
  resolvedFile: ResolvedWorkspaceFilePaths | null;
  desktopTargets: readonly DesktopOpenTarget[];
  canUseDesktopBridge: boolean;
  isLocalExecution: boolean;
}): PlannedDesktopOpenTarget[] {
  if (!input.canUseDesktopBridge || !input.isLocalExecution) {
    return [];
  }

  const resolvedDirectory =
    input.directoryPath === undefined || input.directoryPath === null
      ? null
      : resolveWorkspaceFilePaths({
          path: input.directoryPath,
          workspaceRoot: input.workspaceDirectory,
        });
  if (input.directoryPath !== undefined && input.directoryPath !== null) {
    if (!resolvedDirectory?.relativePath) {
      return [];
    }
  }
  const workspacePath = resolvedDirectory?.absolutePath ?? input.workspaceDirectory;

  return input.desktopTargets.map((target) => {
    if (!input.resolvedFile) {
      return {
        source: "desktop",
        id: target.id,
        label: target.label,
        editorId: target.id,
        icon: target.icon,
        openInput: { editorId: target.id, workspacePath },
      };
    }
    return {
      source: "desktop",
      id: target.id,
      label: target.label,
      editorId: target.id,
      icon: target.icon,
      openInput: {
        editorId: target.id,
        workspacePath,
        filePath: input.resolvedFile.absolutePath,
        ...(input.activeFile?.lineStart ? { line: input.activeFile.lineStart } : {}),
      },
    };
  });
}

/**
 * The remote target opens the repo's home page rather than the checked-out branch: a
 * local branch may never have been pushed, and a 404 is worse than landing on the repo.
 */
function planForgeOpenTarget(input: {
  checkoutStatus?: CheckoutStatusForOpenTarget | null;
  forge?: Forge | null;
}): PlannedForgeOpenTarget | null {
  if (!input.checkoutStatus?.isGit) {
    return null;
  }
  const forge = input.forge ?? forgeFromRemoteUrl(input.checkoutStatus.remoteUrl) ?? null;
  if (!forge) {
    return null;
  }
  const url = getForgePresentation(forge).buildRepoUrl?.(input.checkoutStatus.remoteUrl) ?? null;
  if (!url) {
    return null;
  }
  return {
    source: "forge",
    forge,
    id: forge,
    label: getForgePresentation(forge).brandLabel,
    url,
  };
}

export function planWorkspaceOpenTargets(
  input: PlanWorkspaceOpenTargetsInput,
): PlannedWorkspaceOpenTarget[] {
  const resolvedFile = resolveActiveFileForOpenTargets(input);
  const desktopTargets = planDesktopOpenTargets({ ...input, resolvedFile });
  const forgeTarget = planForgeOpenTarget(input);
  return forgeTarget ? [...desktopTargets, forgeTarget] : desktopTargets;
}
