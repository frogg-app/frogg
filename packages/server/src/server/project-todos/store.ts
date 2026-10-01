// File layer for project to-dos: `<root>/.frogg/todos/index.json` plus one
// markdown plan per item under `plans/<id>.md`. The daemon is the only writer;
// every write goes through writeFileAtomic so readers never see a torn file.
import { promises as fs } from "node:fs";
import path from "node:path";
import { ProjectTodoIndexSchema, type ProjectTodoIndex } from "@frogg/protocol/todos/schemas";
import { writeFileAtomic } from "../atomic-file.js";

export const PROJECT_TODOS_DIR = path.join(".frogg", "todos");
const INDEX_FILE = "index.json";
const PLANS_DIR = "plans";
const GITIGNORE_CONTENT = "# Managed by the Frogg daemon. Project to-dos stay local.\n*\n";
const TODO_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export class ProjectTodoStoreCorruptError extends Error {
  readonly code = "todo_failed";
  constructor(filePath: string, cause: unknown) {
    super(`Project to-do index is unreadable: ${filePath}`, { cause });
  }
}

export function isValidTodoId(id: string): boolean {
  return TODO_ID_PATTERN.test(id);
}

export function todosDirForRoot(root: string): string {
  return path.join(root, PROJECT_TODOS_DIR);
}

export class ProjectTodoStore {
  readonly dir: string;

  constructor(readonly root: string) {
    this.dir = todosDirForRoot(root);
  }

  private get indexPath(): string {
    return path.join(this.dir, INDEX_FILE);
  }

  private planPath(id: string): string {
    if (!isValidTodoId(id)) {
      throw new Error(`Invalid to-do id: ${id}`);
    }
    return path.join(this.dir, PLANS_DIR, `${id}.md`);
  }

  async readIndex(): Promise<ProjectTodoIndex> {
    let raw: string;
    try {
      raw = await fs.readFile(this.indexPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, items: [] };
      }
      throw error;
    }
    try {
      return ProjectTodoIndexSchema.parse(JSON.parse(raw));
    } catch (error) {
      throw new ProjectTodoStoreCorruptError(this.indexPath, error);
    }
  }

  async writeIndex(index: ProjectTodoIndex): Promise<void> {
    await this.ensureGitignore();
    await writeFileAtomic(this.indexPath, `${JSON.stringify(index, null, 2)}\n`);
  }

  async readPlan(id: string): Promise<string | null> {
    try {
      return await fs.readFile(this.planPath(id), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async writePlan(id: string, plan: string): Promise<void> {
    await this.ensureGitignore();
    await writeFileAtomic(this.planPath(id), plan);
  }

  async deletePlan(id: string): Promise<void> {
    await fs.rm(this.planPath(id), { force: true });
  }

  /** Keeps the whole to-do directory out of git without touching the repo's own .gitignore. */
  private async ensureGitignore(): Promise<void> {
    const target = path.join(this.dir, ".gitignore");
    try {
      await fs.access(target);
      return;
    } catch {
      // Missing: create below.
    }
    await writeFileAtomic(target, GITIGNORE_CONTENT);
  }
}
