import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OwnedStorageService } from "./owned-storage.js";

let root: string;
let froggHome: string;
let tmpRoot: string;

function write(file: string, bytes: number, ageMs = 0): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "x".repeat(bytes));
  const when = new Date(Date.now() - ageMs);
  utimesSync(file, when, when);
  utimesSync(path.dirname(file), when, when);
}

function service(): OwnedStorageService {
  return new OwnedStorageService({
    froggHome,
    tmpRoot,
    homeDir: path.join(root, "home"),
    logger: pino({ level: "silent" }),
  });
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "owned-storage-test-"));
  froggHome = path.join(root, "frogg-home");
  tmpRoot = path.join(root, "tmp");
  mkdirSync(froggHome);
  mkdirSync(tmpRoot);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("OwnedStorageService", () => {
  it("sizes categories and marks only safe ones cleanable", async () => {
    write(path.join(froggHome, "daemon.log"), 10);
    write(path.join(froggHome, "20260101-0000-01-daemon.log"), 20);
    write(path.join(froggHome, "agents", "a", "timeline.json"), 30);
    write(path.join(froggHome, "worktrees", "p", "w", "file"), 40);

    const report = await service().list();
    const byId = new Map(report.categories.map((c) => [c.id, c]));
    expect(byId.get("logs")).toMatchObject({ bytes: 30, cleanable: true, reclaimableBytes: 20 });
    expect(byId.get("agents")).toMatchObject({
      bytes: 30,
      cleanable: false,
      reclaimableBytes: null,
    });
    expect(byId.get("worktrees")).toMatchObject({ bytes: 40, cleanable: false });
    expect(byId.get("daemon_versions")).toMatchObject({ exists: false, path: null });
  });

  it("rejects cleanup of size-only and unknown categories", async () => {
    write(path.join(froggHome, "worktrees", "p", "w", "file"), 40);
    await expect(service().cleanup("worktrees")).rejects.toThrow(/not cleanable/);
    await expect(service().cleanup("../etc")).rejects.toThrow(/not cleanable/);
    expect(existsSync(path.join(froggHome, "worktrees", "p", "w", "file"))).toBe(true);
  });

  it("cleans rotated logs but keeps the live log", async () => {
    write(path.join(froggHome, "daemon.log"), 10);
    write(path.join(froggHome, "20260101-0000-01-daemon.log"), 20);
    write(path.join(froggHome, "daemon.log.3"), 5);
    write(path.join(froggHome, "notes-daemon.log"), 7);

    const result = await service().cleanup("logs");
    expect(result).toEqual({ categoryId: "logs", bytesFreed: 25, removedCount: 2 });
    expect(existsSync(path.join(froggHome, "daemon.log"))).toBe(true);
    expect(existsSync(path.join(froggHome, "notes-daemon.log"))).toBe(true);
  });

  it("cleans only stale temp debris, not a live owner's", async () => {
    const dead = path.join(tmpRoot, "frogg-attachments-999999-abc123");
    const mine = path.join(tmpRoot, `frogg-attachments-${process.pid}-abc123`);
    write(path.join(dead, "a.png"), 50, 60 * 60 * 1000);
    write(path.join(mine, "b.png"), 60, 60 * 60 * 1000);

    const storage = service();
    const temp = (await storage.list()).categories.find((c) => c.id === "temp");
    expect(temp).toMatchObject({ bytes: 110, reclaimableBytes: 50 });

    const result = await storage.cleanup("temp");
    expect(result.bytesFreed).toBe(50);
    expect(existsSync(dead)).toBe(false);
    expect(existsSync(mine)).toBe(true);
  });

  it("caches the report until refresh or cleanup", async () => {
    const storage = service();
    const first = await storage.list();
    write(path.join(froggHome, "uploads", "f"), 9);
    expect(await storage.list()).toBe(first);
    const refreshed = await storage.list({ refresh: true });
    expect(refreshed.categories.find((c) => c.id === "uploads")?.bytes).toBe(9);
  });
});
