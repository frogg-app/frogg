import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => undefined },
}));

const { mergeProjects, visibleProjects, localProject } = await import("./localProjects");

const proj = (root: string) => ({
  projectId: `p${root}`,
  projectDisplayName: root.slice(1),
  projectRootPath: root,
  projectKind: "git" as const,
});

describe("local project list", () => {
  const daemon = [proj("/a"), proj("/b"), proj("/c")];
  it("pins to the top in pin order and keeps the daemon order otherwise", () => {
    const merged = mergeProjects(daemon, { pinned: ["/c", "/b"], hidden: [], added: [] });
    expect(merged.map((m) => m.project.projectRootPath)).toEqual(["/c", "/b", "/a"]);
  });
  it("hides daemon projects on this device without dropping them from the merge", () => {
    const merged = mergeProjects(daemon, { pinned: [], hidden: ["/b"], added: [] });
    expect(merged.find((m) => m.project.projectRootPath === "/b")?.hidden).toBe(true);
    expect(visibleProjects(merged).map((p) => p.projectRootPath)).toEqual(["/a", "/c"]);
  });
  it("lists folders the daemon does not have, once", () => {
    const merged = mergeProjects(daemon, { pinned: [], hidden: [], added: ["/z", "/a"] });
    expect(merged.map((m) => [m.project.projectRootPath, m.local])).toEqual([
      ["/a", false],
      ["/b", false],
      ["/c", false],
      ["/z", true],
    ]);
    expect(localProject("C:\\Work\\app").projectDisplayName).toBe("app");
  });
});
