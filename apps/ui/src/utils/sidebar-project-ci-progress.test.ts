import { describe, expect, it } from "vitest";
import type { SidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";
import type { PrHint } from "@/git/pr-hint";
import { selectProjectChecksProgress } from "./sidebar-project-ci-progress";

function entry(prHint: PrHint | null): SidebarWorkspaceEntry {
  return { prHint } as SidebarWorkspaceEntry;
}

function hint(overrides: Partial<PrHint>): PrHint {
  return {
    url: "https://example.test/pull/1",
    number: 1,
    state: "open",
    forge: "github",
    ...overrides,
  };
}

describe("selectProjectChecksProgress", () => {
  it("is idle for a project with no change requests", () => {
    expect(selectProjectChecksProgress([entry(null), undefined]).running).toBe(false);
  });

  it("sums every open change request's run into one ring", () => {
    const progress = selectProjectChecksProgress([
      entry(
        hint({
          checks: [
            { name: "a", url: null, status: "success" },
            { name: "b", url: null, status: "pending" },
          ],
        }),
      ),
      entry(hint({ number: 2, checks: [{ name: "c", url: null, status: "pending" }] })),
    ]);
    expect(progress).toEqual({ total: 3, completed: 1, fraction: 1 / 3, running: true });
  });

  it("ignores merged and closed change requests", () => {
    const progress = selectProjectChecksProgress([
      entry(hint({ state: "merged", checks: [{ name: "a", url: null, status: "pending" }] })),
      entry(hint({ state: "closed", checks: [{ name: "b", url: null, status: "pending" }] })),
    ]);
    expect(progress.running).toBe(false);
    expect(progress.total).toBe(0);
  });
});
