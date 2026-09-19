import { describe, expect, it } from "vitest";

import {
  __private__ as confirmDialogInternals,
  getActiveConfirmDialogRequest,
  settleConfirmDialogRequest,
} from "@/utils/confirm-dialog";

import {
  buildWorktreeArchiveConfirmationMessage,
  confirmRiskyWorktreeArchive,
  isWorktreeArchiveRisky,
  buildWorktreeArchiveRiskReasons,
  toWorktreeArchiveRisk,
} from "@/git/worktree-archive-warning";

describe("workspace archive warning for worktree backing", () => {
  it("says only what archiving does when nothing is at risk", () => {
    expect(
      buildWorktreeArchiveConfirmationMessage({
        workspaceName: "feature",
        isDirty: false,
        aheadOfOrigin: 0,
        diffStat: null,
      }),
    ).toBe("This removes the session from the sidebar. To restore it later, open History.");
  });

  it("explains uncommitted line changes", () => {
    expect(
      buildWorktreeArchiveRiskReasons({
        isDirty: true,
        aheadOfOrigin: 0,
        diffStat: { additions: 12, deletions: 1 },
      }),
    ).toEqual(["Uncommitted changes (12 added lines, 1 deleted line)"]);
  });

  it("treats nonzero diff stats as dirty when dirty state is missing", () => {
    expect(
      buildWorktreeArchiveRiskReasons({
        isDirty: undefined,
        aheadOfOrigin: 0,
        diffStat: { additions: 4, deletions: 0 },
      }),
    ).toEqual(["Uncommitted changes (4 added lines)"]);
  });

  it("explains unpushed commits", () => {
    expect(
      buildWorktreeArchiveRiskReasons({
        isDirty: false,
        aheadOfOrigin: 2,
        diffStat: null,
      }),
    ).toEqual(["2 unpushed commits"]);
  });

  it("includes every archive risk in the confirmation copy", () => {
    expect(
      buildWorktreeArchiveConfirmationMessage({
        workspaceName: "risky-feature",
        isDirty: true,
        aheadOfOrigin: 1,
        diffStat: { additions: 1, deletions: 3 },
      }),
    ).toBe(
      "This removes the session from the sidebar. To restore it later, open History.\n\nUncommitted changes (1 added line, 3 deleted lines)\n\n1 unpushed commit",
    );
  });

  it("maps archive workspace fields into the shared worktree risk shape", () => {
    expect(
      toWorktreeArchiveRisk({
        archiveHasUncommittedChanges: true,
        archiveUnpushedCommitCount: 3,
        diffStat: { additions: 2, deletions: 1 },
      }),
    ).toEqual({
      isDirty: true,
      aheadOfOrigin: 3,
      diffStat: { additions: 2, deletions: 1 },
    });
  });
});

describe("confirming a worktree archive", () => {
  it("treats a clean, pushed worktree as no risk at all", () => {
    expect(isWorktreeArchiveRisky({ isDirty: false, aheadOfOrigin: 0, diffStat: null })).toBe(
      false,
    );
  });

  it("treats uncommitted changes and unpushed commits as risk", () => {
    expect(isWorktreeArchiveRisky({ isDirty: true, aheadOfOrigin: 0, diffStat: null })).toBe(true);
    expect(isWorktreeArchiveRisky({ isDirty: false, aheadOfOrigin: 1, diffStat: null })).toBe(true);
  });

  it("archives a clean worktree without asking anything", async () => {
    confirmDialogInternals.reset();

    const confirmed = await confirmRiskyWorktreeArchive({
      workspaceName: "clean-feature",
      isDirty: false,
      aheadOfOrigin: 0,
      diffStat: null,
    });

    expect(confirmed).toBe(true);
    expect(confirmDialogInternals.pendingCount()).toBe(0);
    expect(getActiveConfirmDialogRequest()).toBeNull();
  });

  it("still asks before archiving a worktree that would lose work", async () => {
    confirmDialogInternals.reset();

    const pending = confirmRiskyWorktreeArchive({
      workspaceName: "risky-feature",
      isDirty: true,
      aheadOfOrigin: 2,
      diffStat: null,
    });

    const request = getActiveConfirmDialogRequest();
    expect(request?.input.destructive).toBe(true);
    expect(request?.input.message).toContain("2 unpushed commits");

    settleConfirmDialogRequest(request!.id, false);
    await expect(pending).resolves.toBe(false);
    confirmDialogInternals.reset();
  });
});
