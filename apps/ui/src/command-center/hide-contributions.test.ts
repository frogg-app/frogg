import { describe, expect, it, vi } from "vitest";
import {
  buildHideCommandCenterContributions,
  type HideCommandCenterSource,
} from "./hide-contributions";

function source(overrides: Partial<HideCommandCenterSource> = {}): HideCommandCenterSource {
  return {
    workspace: { workspaceKey: "s:w1", isHidden: false },
    project: { viewKey: "p1", isHidden: false },
    hiddenCount: 0,
    showHidden: false,
    labels: {
      section: "Workspace",
      hideWorkspace: "Hide workspace",
      unhideWorkspace: "Unhide workspace",
      hideProject: "Hide project",
      unhideProject: "Unhide project",
      showHidden: "Show hidden",
      stopShowingHidden: "Stop showing hidden",
    },
    icons: {},
    toggleWorkspace: vi.fn(),
    toggleProject: vi.fn(),
    setShowHidden: vi.fn(),
    ...overrides,
  };
}

function titles(contributions: ReturnType<typeof buildHideCommandCenterContributions>) {
  return contributions.map((c) => (c.presentation.kind === "action" ? c.presentation.title : ""));
}

describe("hide command center contributions", () => {
  it("offers hiding the routed workspace and its project, but no show-hidden toggle yet", () => {
    expect(titles(buildHideCommandCenterContributions(source()))).toEqual([
      "Hide workspace",
      "Hide project",
    ]);
  });

  it("names the opposite action for hidden items and toggles the right key", () => {
    const input = source({
      workspace: { workspaceKey: "s:w1", isHidden: true },
      project: { viewKey: "p1", isHidden: true },
      hiddenCount: 2,
    });
    const contributions = buildHideCommandCenterContributions(input);
    expect(titles(contributions)).toEqual(["Unhide workspace", "Unhide project", "Show hidden"]);
    void contributions[0]!.run();
    void contributions[1]!.run();
    void contributions[2]!.run();
    expect(input.toggleWorkspace).toHaveBeenCalledWith("s:w1");
    expect(input.toggleProject).toHaveBeenCalledWith("p1");
    expect(input.setShowHidden).toHaveBeenCalledWith(true);
  });

  it("keeps only the global toggle outside a workspace", () => {
    const contributions = buildHideCommandCenterContributions(
      source({ workspace: null, project: null, showHidden: true }),
    );
    expect(titles(contributions)).toEqual(["Stop showing hidden"]);
  });
});
