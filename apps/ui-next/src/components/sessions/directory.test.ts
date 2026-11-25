import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {} },
}));
vi.mock("../../daemon/store", () => ({
  getClient: () => null,
  onHostSwitch: () => {},
  useDaemon: { subscribe: () => {} },
}));

const { projectIdOf } = await import("./directory");

const projects = [
  { projectId: "prj_frogg", projectKey: "remote:github.com/frogg-app/frogg" },
  { projectId: "prj_other", projectKey: "remote:github.com/acme/other" },
] as never;
const sess = (workspaceId: string, projectKey?: string) =>
  ({ agent: { workspaceId }, ...(projectKey ? { project: { projectKey } } : {}) }) as never;

describe("projectIdOf", () => {
  it("uses the loaded workspace's project", () => {
    const workspaces = { w1: { projectId: "prj_other" } } as never;
    expect(projectIdOf(sess("w1", "prj_frogg"), { workspaces, projects })).toBe("prj_other");
  });

  it("matches the project id a daemon sends for a session whose workspace is archived", () => {
    expect(projectIdOf(sess("gone", "prj_frogg"), { workspaces: {}, projects })).toBe("prj_frogg");
  });

  it("still matches an older daemon's project key", () => {
    const key = "remote:github.com/acme/other";
    expect(projectIdOf(sess("gone", key), { workspaces: {}, projects })).toBe("prj_other");
  });

  it("is null when the session names no known project", () => {
    expect(projectIdOf(sess("gone"), { workspaces: {}, projects })).toBeNull();
    expect(projectIdOf(sess("gone", "prj_missing"), { workspaces: {}, projects })).toBeNull();
  });
});
