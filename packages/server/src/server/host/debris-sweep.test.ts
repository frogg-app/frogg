import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyTempName, findFroggDebris, sweepFroggDebris } from "./debris-sweep.js";

const HOUR = 60 * 60 * 1000;
const DEAD_PID = 999_999;
const LIVE_PID = 424_242;

let root: string;
let tmpRoot: string;
let homeDir: string;
let projectsParent: string;

function makeEntry(parent: string, name: string, ageMs: number, file?: string): string {
  const full = path.join(parent, name);
  mkdirSync(full, { recursive: true });
  if (file) writeFileSync(path.join(full, file), "x".repeat(100));
  const when = new Date(Date.now() - ageMs);
  utimesSync(full, when, when);
  return full;
}

const baseOptions = () => ({
  tmpRoot,
  homeDir,
  stagingParents: [projectsParent],
  isPidAlive: (pid: number) => pid === LIVE_PID,
  username: "alice",
});

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "debris-sweep-test-"));
  tmpRoot = path.join(root, "tmp");
  homeDir = path.join(root, "home");
  projectsParent = path.join(root, "code");
  for (const dir of [tmpRoot, homeDir, projectsParent]) mkdirSync(dir);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("classifyTempName", () => {
  const opts = {
    staleAfterMs: 24 * HOUR,
    deadOwnerGraceMs: HOUR / 6,
    isPidAlive: (pid: number) => pid === LIVE_PID,
    username: "alice",
  };

  it("removes a dead owner's pid-tagged dir after the grace period only", () => {
    expect(classifyTempName(`frogg-attachments-${DEAD_PID}-abc123`, HOUR, opts)).toBe(true);
    expect(classifyTempName(`frogg-attachments-${DEAD_PID}-abc123`, 60_000, opts)).toBe(false);
  });

  it("never removes a live owner's or this process's dir, however old", () => {
    expect(classifyTempName(`frogg-pi-mcp-${LIVE_PID}-abc123`, 100 * HOUR, opts)).toBe(false);
    expect(classifyTempName(`frogg-stt-${process.pid}-x.webm`, 100 * HOUR, opts)).toBe(false);
  });

  it("removes legacy mkdtemp dirs only once stale", () => {
    expect(classifyTempName("frogg-attachments-Ab12Cd", 25 * HOUR, opts)).toBe(true);
    expect(classifyTempName("frogg-attachments-Ab12Cd", 2 * HOUR, opts)).toBe(false);
  });

  it("matches zsh runtime dirs only for the current user", () => {
    expect(classifyTempName(`alice-frogg-zsh-${DEAD_PID}`, HOUR, opts)).toBe(true);
    expect(classifyTempName(`bob-frogg-zsh-${DEAD_PID}`, HOUR, opts)).toBe(false);
  });

  it("ignores lookalikes and test fixtures", () => {
    for (const name of [
      "frogg-agent-cwd-Ab12Cd",
      "frogg-classify-dot-Ab12Cd",
      "frogg-attachments",
      "frogg-attachments-toolong1",
      "xfrogg-attachments-Ab12Cd",
      "frogg-concept-01.png",
    ]) {
      expect(classifyTempName(name, 1000 * HOUR, opts)).toBe(false);
    }
  });
});

describe("findFroggDebris", () => {
  it("returns only exact Frogg debris from each known location", async () => {
    const deadTemp = makeEntry(tmpRoot, `frogg-attachments-${DEAD_PID}-abc123`, HOUR, "a.png");
    makeEntry(tmpRoot, `frogg-attachments-${LIVE_PID}-abc123`, 100 * HOUR, "a.png");
    makeEntry(tmpRoot, "frogg-agent-cwd-Ab12Cd", 100 * HOUR);
    const emptyHome = makeEntry(homeDir, "frogg-classify-home-Ab12Cd", 0);
    mkdirSync(path.join(emptyHome, "nested", "deeper"), { recursive: true });
    makeEntry(homeDir, "frogg-classify-home-Zz99Zz", 0, "user-file.txt");
    const staleClone = makeEntry(projectsParent, ".frogg-clone-Ab12Cd", 25 * HOUR, "HEAD");
    makeEntry(projectsParent, ".frogg-clone-Cd34Ef", HOUR, "HEAD");

    const found = await findFroggDebris(baseOptions());
    expect(found.map((c) => c.path).sort()).toEqual([deadTemp, emptyHome, staleClone].sort());
  });

  it("skips protected paths and symlinks", async () => {
    const outside = makeEntry(root, "outside", 0, "keep.txt");
    symlinkSync(outside, path.join(tmpRoot, `frogg-pi-mcp-${DEAD_PID}-abc123`));
    const protectedDir = makeEntry(tmpRoot, `frogg-attachments-${DEAD_PID}-zzz999`, HOUR);

    const found = await findFroggDebris({ ...baseOptions(), protectedPaths: [protectedDir] });
    expect(found).toEqual([]);
  });

  it("skips entries owned by another uid", async () => {
    makeEntry(tmpRoot, `frogg-attachments-${DEAD_PID}-abc123`, HOUR);
    const uid = typeof process.getuid === "function" ? process.getuid() : null;
    if (uid === null) return; // Windows: ownership is not checked.
    expect(await findFroggDebris({ ...baseOptions(), uid: uid + 1 })).toEqual([]);
  });
});

describe("sweepFroggDebris", () => {
  it("removes debris, reports bytes, and leaves everything else", async () => {
    const dead = makeEntry(tmpRoot, `frogg-attachments-${DEAD_PID}-abc123`, HOUR, "a.png");
    const live = makeEntry(tmpRoot, `frogg-attachments-${LIVE_PID}-abc123`, HOUR, "a.png");
    const result = await sweepFroggDebris({ ...baseOptions(), logger: pino({ level: "silent" }) });
    expect(result.removed).toEqual([dead]);
    expect(result.bytesFreed).toBe(100);
    expect(existsSync(dead)).toBe(false);
    expect(existsSync(live)).toBe(true);
  });

  it("never throws when locations are missing", async () => {
    const result = await sweepFroggDebris({
      tmpRoot: path.join(root, "nope"),
      homeDir: path.join(root, "nope2"),
      stagingParents: [path.join(root, "nope3")],
      logger: pino({ level: "silent" }),
    });
    expect(result.removed).toEqual([]);
  });
});
