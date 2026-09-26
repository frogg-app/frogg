import { describe, expect, it } from "vitest";
import {
  countHidden,
  filterHiddenProjects,
  mergePersistedSidebarHidden,
  serializeSidebarHidden,
  toggleProjectHidden,
  toggleWorkspaceHidden,
  type SidebarHiddenState,
} from "./state";

const empty: SidebarHiddenState = {
  hiddenProjectKeys: new Set(),
  hiddenWorkspaceKeys: new Set(),
  showHidden: false,
};

const projects = [
  { viewKey: "p1", workspaces: [{ workspaceKey: "s:w1" }, { workspaceKey: "s:w2" }] },
  { viewKey: "p2", workspaces: [{ workspaceKey: "s:w3" }] },
];

describe("sidebar hidden state", () => {
  it("returns the same list when nothing is hidden", () => {
    expect(filterHiddenProjects(projects, empty)).toBe(projects);
  });

  it("drops a hidden project with its workspaces, and a hidden workspace from its project", () => {
    let state = toggleProjectHidden(empty, "p2");
    state = toggleWorkspaceHidden(state, "s:w1");
    expect(filterHiddenProjects(projects, state)).toEqual([
      { viewKey: "p1", workspaces: [{ workspaceKey: "s:w2" }] },
    ]);
    expect(countHidden(projects, state)).toBe(2);
  });

  it("keeps the header of a project whose every workspace is hidden", () => {
    const state = toggleWorkspaceHidden(empty, "s:w3");
    expect(filterHiddenProjects(projects, state)[1]).toEqual({ viewKey: "p2", workspaces: [] });
  });

  it("reveals everything while showHidden is on, and toggles back off", () => {
    const hidden = toggleProjectHidden(empty, "p1");
    expect(filterHiddenProjects(projects, { ...hidden, showHidden: true })).toBe(projects);
    expect(toggleProjectHidden(hidden, "p1").hiddenProjectKeys.size).toBe(0);
  });

  it("does not count stale keys for projects the sidebar cannot see", () => {
    expect(countHidden(projects, toggleProjectHidden(empty, "gone"))).toBe(0);
  });

  it("round-trips through storage and ignores a corrupt value", () => {
    const state = toggleWorkspaceHidden(toggleProjectHidden(empty, "p1"), "s:w3");
    const restored = mergePersistedSidebarHidden(serializeSidebarHidden(state), empty);
    expect([...restored.hiddenProjectKeys]).toEqual(["p1"]);
    expect([...restored.hiddenWorkspaceKeys]).toEqual(["s:w3"]);
    expect(mergePersistedSidebarHidden({ hiddenProjectKeys: [1] }, empty)).toBe(empty);
  });
});
