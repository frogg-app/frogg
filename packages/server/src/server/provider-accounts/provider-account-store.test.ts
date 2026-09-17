import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadPersistedConfig, savePersistedConfig } from "../persisted-config.js";
import { resolveProviderAccountEnv } from "./provider-account-env.js";
import { ProviderAccountError, ProviderAccountStore } from "./provider-account-store.js";

describe("ProviderAccountStore", () => {
  let root: string;
  let froggHome: string;
  let homeDir: string;
  let store: ProviderAccountStore;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "frogg-account-store-"));
    froggHome = path.join(root, "frogg");
    homeDir = path.join(root, "home");
    mkdirSync(froggHome, { recursive: true });
    mkdirSync(path.join(homeDir, ".claude", "skills"), { recursive: true });
    store = new ProviderAccountStore({ froggHome, homeDir });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("creates an account, persists it, and makes it active", () => {
    const result = store.create({
      provider: "claude",
      name: "Peter",
      linkedFolders: ["skills"],
    });

    expect(result.accounts).toHaveLength(1);
    const account = result.accounts[0]!;
    expect(account.name).toBe("peter");
    expect(account.configDir).toBe(path.join(homeDir, ".claude-peter"));
    expect(account.linkedFolders).toEqual(["skills"]);
    expect(account.isActive).toBe(true);
    expect(account.authenticated).toBe(false);
    expect(existsSync(account.configDir)).toBe(true);

    const persisted = loadPersistedConfig(froggHome);
    expect(persisted.providerAccounts?.claude?.accounts).toHaveLength(1);
    expect(persisted.providerAccounts?.claude?.activeAccountId).toBe(account.id);
  });

  it("reports an account as authenticated once a credential file exists", () => {
    const created = store.create({
      provider: "claude",
      name: "peter",
      linkedFolders: [],
    });
    const account = created.accounts[0]!;
    writeFileSync(path.join(account.configDir, ".credentials.json"), "{}");

    expect(store.list()[0]?.authenticated).toBe(true);
  });

  it("rejects invalid and duplicate names", () => {
    store.create({ provider: "claude", name: "peter", linkedFolders: [] });

    expect(() =>
      store.create({ provider: "claude", name: "Two Words", linkedFolders: [] }),
    ).toThrow(ProviderAccountError);
    expect(() => store.create({ provider: "claude", name: "PETER", linkedFolders: [] })).toThrow(
      /already exists/,
    );
  });

  it("rejects management for a provider whose accounts are disabled", () => {
    expect(() => store.create({ provider: "codex", name: "work", linkedFolders: [] })).toThrow(
      /disabled/,
    );
    expect(() => store.setActive("codex", null)).toThrow(/disabled/);
    expect(() => store.create({ provider: "nope", name: "work", linkedFolders: [] })).toThrow(
      /does not support accounts/,
    );
  });

  it("honours a config.json enabled override", () => {
    const persisted = loadPersistedConfig(froggHome);
    savePersistedConfig(froggHome, {
      ...persisted,
      providerAccounts: {
        claude: { enabled: false },
        codex: { enabled: true },
      },
    });

    expect(() => store.create({ provider: "claude", name: "peter", linkedFolders: [] })).toThrow(
      /disabled/,
    );
    expect(store.getCapability("codex")?.enabled).toBe(true);
  });

  it("switches and clears the active account", () => {
    const first = store.create({
      provider: "claude",
      name: "peter",
      linkedFolders: [],
    }).accounts[0]!;
    const second = store
      .create({ provider: "claude", name: "jason", linkedFolders: [] })
      .accounts.find((account) => account.name === "jason")!;

    expect(store.activeAccountIds().claude).toBe(first.id);

    store.setActive("claude", second.id);
    expect(store.activeAccountIds().claude).toBe(second.id);
    expect(resolveProviderAccountEnv(store, "claude")).toEqual({
      CLAUDE_CONFIG_DIR: second.configDir,
    });

    store.setActive("claude", null);
    expect(store.activeAccountIds().claude).toBeUndefined();
    expect(resolveProviderAccountEnv(store, "claude")).toEqual({});
  });

  it("deletes an account and promotes a remaining one", () => {
    const first = store.create({
      provider: "claude",
      name: "peter",
      linkedFolders: [],
    }).accounts[0]!;
    store.create({ provider: "claude", name: "jason", linkedFolders: [] });

    const result = store.delete(first.id);

    expect(result.accounts.map((account) => account.name)).toEqual(["jason"]);
    expect(result.accounts[0]?.isActive).toBe(true);
    // The config dir holds credentials, so it is deliberately left behind.
    expect(existsSync(first.configDir)).toBe(true);
    expect(() => store.delete(first.id)).toThrow(/Unknown provider account/);
  });

  it("returns an empty env overlay for a provider without accounts", () => {
    expect(resolveProviderAccountEnv(store, "claude")).toEqual({});
    expect(resolveProviderAccountEnv(store, "codex")).toEqual({});
  });
});
