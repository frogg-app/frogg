import { mkdtempSync, mkdirSync, readlinkSync, rmSync, writeFileSync, lstatSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { provisionProviderAccount } from "./provider-account-provisioner.js";

describe("provisionProviderAccount", () => {
  let root: string;
  let primaryDir: string;
  let accountDir: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "frogg-provider-accounts-"));
    primaryDir = path.join(root, ".claude");
    accountDir = path.join(root, ".claude-peter");
    mkdirSync(primaryDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("creates the account directory and links existing folders", () => {
    mkdirSync(path.join(primaryDir, "skills"));
    mkdirSync(path.join(primaryDir, "commands"));

    const result = provisionProviderAccount({
      primaryDir,
      accountDir,
      linkFolders: ["skills", "commands"],
    });

    expect(result.warnings).toEqual([]);
    expect(result.linkedFolders).toEqual(["skills", "commands"]);
    expect(lstatSync(path.join(accountDir, "skills")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(path.join(accountDir, "commands"))).toBe(path.join(primaryDir, "commands"));
  });

  it("warns and skips when the source folder does not exist", () => {
    const result = provisionProviderAccount({
      primaryDir,
      accountDir,
      linkFolders: ["sessions"],
    });

    expect(result.linkedFolders).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("sessions");
    expect(result.warnings[0]).toContain("does not exist");
  });

  it("leaves an existing target alone and reports it as linked", () => {
    mkdirSync(path.join(primaryDir, "agents"));
    mkdirSync(accountDir, { recursive: true });
    mkdirSync(path.join(accountDir, "agents"));
    writeFileSync(path.join(accountDir, "agents", "local.md"), "local");

    const result = provisionProviderAccount({
      primaryDir,
      accountDir,
      linkFolders: ["agents"],
    });

    expect(result.warnings).toEqual([]);
    expect(result.linkedFolders).toEqual(["agents"]);
    expect(lstatSync(path.join(accountDir, "agents")).isSymbolicLink()).toBe(false);
  });

  it("is idempotent across repeated runs", () => {
    mkdirSync(path.join(primaryDir, "projects"));

    const first = provisionProviderAccount({
      primaryDir,
      accountDir,
      linkFolders: ["projects"],
    });
    const second = provisionProviderAccount({
      primaryDir,
      accountDir,
      linkFolders: ["projects"],
    });

    expect(first.linkedFolders).toEqual(["projects"]);
    expect(second.linkedFolders).toEqual(["projects"]);
    expect(second.warnings).toEqual([]);
  });
});
