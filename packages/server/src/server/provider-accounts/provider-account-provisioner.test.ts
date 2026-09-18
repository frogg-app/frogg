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

describe("provisionProviderAccount in home mode", () => {
  let root: string;
  let realHome: string;
  let primaryDir: string;
  let accountDir: string;

  const home = (homeLinks: string[]) => ({
    realHome,
    configSubdir: ".gemini",
    homeLinks,
  });

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "frogg-provider-home-"));
    realHome = path.join(root, "home");
    primaryDir = path.join(realHome, ".gemini");
    accountDir = path.join(realHome, ".gemini-peter");
    mkdirSync(primaryDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("nests the config dir inside the synthetic home and links shared home state", () => {
    mkdirSync(path.join(primaryDir, "commands"));
    mkdirSync(path.join(realHome, ".npm"));
    mkdirSync(path.join(realHome, ".cache"));
    writeFileSync(path.join(realHome, ".gitconfig"), "[user]\n");

    const result = provisionProviderAccount({
      primaryDir,
      accountDir,
      linkFolders: ["commands"],
      home: home([".npm", ".cache", ".gitconfig"]),
    });

    expect(result.warnings).toEqual([]);
    // The provider reads <accountDir>/.gemini, not <accountDir>.
    expect(lstatSync(path.join(accountDir, ".gemini")).isDirectory()).toBe(true);
    expect(result.linkedFolders).toEqual(["commands"]);
    expect(readlinkSync(path.join(accountDir, ".gemini", "commands"))).toBe(
      path.join(primaryDir, "commands"),
    );

    expect(result.homeLinks).toEqual([".npm", ".cache", ".gitconfig"]);
    expect(readlinkSync(path.join(accountDir, ".npm"))).toBe(path.join(realHome, ".npm"));
    expect(readlinkSync(path.join(accountDir, ".gitconfig"))).toBe(
      path.join(realHome, ".gitconfig"),
    );
  });

  it("creates parent directories for nested home links", () => {
    mkdirSync(path.join(realHome, ".config", "gcloud"), { recursive: true });

    const result = provisionProviderAccount({
      primaryDir,
      accountDir,
      linkFolders: [],
      home: home([".config/gcloud"]),
    });

    expect(result.warnings).toEqual([]);
    expect(result.homeLinks).toEqual([".config/gcloud"]);
    expect(readlinkSync(path.join(accountDir, ".config", "gcloud"))).toBe(
      path.join(realHome, ".config", "gcloud"),
    );
  });

  it("tolerates home link targets that do not exist", () => {
    mkdirSync(path.join(realHome, ".npm"));

    const result = provisionProviderAccount({
      primaryDir,
      accountDir,
      linkFolders: [],
      home: home([".npm", ".nonesuch", ".config/gcloud"]),
    });

    // Provisioning still succeeds; only the missing targets are reported.
    expect(result.homeLinks).toEqual([".npm"]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.join("\n")).toContain("does not exist");
    expect(lstatSync(accountDir).isDirectory()).toBe(true);
  });

  it("is idempotent and leaves env-mode results unchanged for env-mode accounts", () => {
    mkdirSync(path.join(realHome, ".npm"));
    const options = {
      primaryDir,
      accountDir,
      linkFolders: [],
      home: home([".npm"]),
    };
    provisionProviderAccount(options);
    const second = provisionProviderAccount(options);
    expect(second.homeLinks).toEqual([".npm"]);
    expect(second.warnings).toEqual([]);

    // No `home` option: nothing is nested and no home links are produced.
    const envMode = provisionProviderAccount({
      primaryDir,
      accountDir: path.join(realHome, ".claude-peter"),
      linkFolders: [],
    });
    expect(envMode.homeLinks).toEqual([]);
  });
});
