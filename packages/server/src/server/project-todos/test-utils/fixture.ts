import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import type { PersistedProjectRecord, PersistedWorkspaceRecord } from "../../workspace-registry.js";
import { ProjectTodoService } from "../service.js";

export function projectRecord(
  overrides: Partial<PersistedProjectRecord> = {},
): PersistedProjectRecord {
  return {
    projectId: "p1",
    rootPath: "/repo",
    kind: "git",
    displayName: "repo",
    projectKey: null,
    customName: null,
    customIconRevision: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides,
  } as PersistedProjectRecord;
}

export function workspaceRecord(
  overrides: Partial<PersistedWorkspaceRecord>,
): PersistedWorkspaceRecord {
  return {
    workspaceId: "w1",
    projectId: "p1",
    cwd: "/repo",
    kind: "local_checkout",
    displayName: "main",
    title: null,
    branch: null,
    worktreeRoot: null,
    baseBranch: null,
    isFroggOwnedWorktree: false,
    mainRepoRoot: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    autoArchivedChangeRequestUrl: null,
    pinnedAt: null,
    ...overrides,
  } as PersistedWorkspaceRecord;
}

/**
 * A real service over a temp main checkout (`root`) with one worktree workspace
 * `wt` on branch `feature`. Ids are sequential (`t1`, `t2`, ...).
 */
export async function createTodoFixture(options: { running?: string[] } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "frogg-todos-"));
  const running = new Set(options.running ?? ["a1", "a2"]);
  let clock = 0;
  let nextId = 0;
  const workspaces = [
    workspaceRecord({ workspaceId: "main", cwd: root, worktreeRoot: root }),
    workspaceRecord({
      workspaceId: "wt",
      kind: "worktree",
      branch: "feature",
      cwd: path.join(root, "..", `${path.basename(root)}-wt`),
      worktreeRoot: path.join(root, "..", `${path.basename(root)}-wt`),
      mainRepoRoot: root,
    }),
  ];
  const service = new ProjectTodoService({
    projectRegistry: {
      get: async (id) => (id === "p1" ? projectRecord({ rootPath: root }) : null),
    },
    workspaceRegistry: {
      get: async (id) => workspaces.find((w) => w.workspaceId === id) ?? null,
      list: async () => workspaces,
    },
    isAgentRunning: (agentId) => running.has(agentId),
    resolveAgentProjectIds: async () => ["p1"],
    logger: pino({ level: "silent" }),
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString(),
    generateId: () => `t${++nextId}`,
  });
  return {
    root,
    running,
    service,
    workspaces,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
