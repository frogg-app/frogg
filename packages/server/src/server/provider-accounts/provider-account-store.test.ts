import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  providerAccountDefaultId,
  type ProviderAccountState,
} from "@frogg/protocol/provider-accounts";

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
    expect(() => store.create({ provider: "opencode", name: "work", linkedFolders: [] })).toThrow(
      /disabled/,
    );
    expect(() => store.setActive("opencode", null)).toThrow(/disabled/);
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

describe("ProviderAccountStore rename, sign-out and portability", () => {
  let root: string;
  let froggHome: string;
  let homeDir: string;
  let store: ProviderAccountStore;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "frogg-account-store-ext-"));
    froggHome = path.join(root, "frogg");
    homeDir = path.join(root, "home");
    mkdirSync(froggHome, { recursive: true });
    mkdirSync(path.join(homeDir, ".claude", "skills"), { recursive: true });
    store = new ProviderAccountStore({ froggHome, homeDir });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function createAccount(name: string): ProviderAccountState {
    return store
      .create({ provider: "claude", name, linkedFolders: [] })
      .accounts.find((account) => account.name === name)!;
  }

  it("rename: changes the display name without moving the config directory", () => {
    const account = createAccount("peter");
    writeFileSync(path.join(account.configDir, ".credentials.json"), "{}");

    const renamed = store.rename(account.id, "Peter's work laptop");

    const updated = renamed.accounts.find((candidate) => candidate.id === account.id)!;
    expect(updated.name).toBe("Peter's work laptop");
    expect(updated.configDir).toBe(account.configDir);
    expect(existsSync(account.configDir)).toBe(true);
    // The sign-in inside the untouched directory survives.
    expect(updated.authenticated).toBe(true);
    expect(existsSync(path.join(homeDir, ".claude-peter's work laptop"))).toBe(false);
  });

  it("rename: persists a stored record for the implicit default account and keeps the primary dir", () => {
    const defaultId = providerAccountDefaultId("claude");

    const renamed = store.rename(defaultId, "Personal");

    const stored = renamed.accounts.find((account) => account.id === defaultId)!;
    expect(stored.name).toBe("Personal");
    expect(stored.configDir).toBe(path.join(homeDir, ".claude"));

    // The rename sticks across a fresh store reading the same config.json.
    const reopened = new ProviderAccountStore({ froggHome, homeDir });
    const persisted = reopened.list("claude").find((account) => account.id === defaultId)!;
    expect(persisted.name).toBe("Personal");
    expect(persisted.configDir).toBe(path.join(homeDir, ".claude"));
  });

  it("rename: rejects a name another account of the provider already uses", () => {
    createAccount("peter");
    const second = createAccount("paula");

    expect(() => store.rename(second.id, "peter")).toThrow(ProviderAccountError);
  });

  it("rename: rejects a blank name", () => {
    const account = createAccount("peter");
    expect(() => store.rename(account.id, "   ")).toThrow(ProviderAccountError);
  });

  it("signOut: deletes only the credential files inside the account's config dir", () => {
    const account = createAccount("peter");
    const credential = path.join(account.configDir, ".credentials.json");
    const settings = path.join(account.configDir, "settings.json");
    const otherAccountCredential = path.join(createAccount("paula").configDir, ".credentials.json");
    const primaryCredential = path.join(homeDir, ".claude", ".credentials.json");
    writeFileSync(credential, "{}");
    writeFileSync(settings, "{}");
    writeFileSync(otherAccountCredential, "{}");
    writeFileSync(primaryCredential, "{}");

    const result = store.signOut(account.id);

    expect(existsSync(credential)).toBe(false);
    expect(existsSync(settings)).toBe(true);
    expect(existsSync(account.configDir)).toBe(true);
    expect(existsSync(otherAccountCredential)).toBe(true);
    expect(existsSync(primaryCredential)).toBe(true);
    // The account itself is still listed, just no longer authenticated.
    const after = result.accounts.find((candidate) => candidate.id === account.id)!;
    expect(after.authenticated).toBe(false);
  });

  it("signOut: refuses an account that is not signed in", () => {
    const account = createAccount("peter");
    expect(() => store.signOut(account.id)).toThrow(ProviderAccountError);
  });

  it("export/import: round-trips an account and its credentials onto another daemon", () => {
    const account = createAccount("peter");
    writeFileSync(path.join(account.configDir, ".credentials.json"), '{"token":"secret"}');

    const bundle = store.export("claude");
    expect(bundle.version).toBe(1);
    expect(bundle.provider).toBe("claude");
    expect(bundle.accounts).toHaveLength(1);
    expect(
      Buffer.from(bundle.accounts[0]!.credentials[0]!.contentsBase64, "base64").toString("utf8"),
    ).toBe('{"token":"secret"}');

    // A second, independent daemon with its own frogg home and home dir.
    const otherHome = path.join(root, "other-home");
    const otherFroggHome = path.join(root, "other-frogg");
    mkdirSync(otherHome, { recursive: true });
    mkdirSync(otherFroggHome, { recursive: true });
    const target = new ProviderAccountStore({
      froggHome: otherFroggHome,
      homeDir: otherHome,
    });

    const imported = target.import(bundle);

    const restored = imported.accounts.find((candidate) => candidate.id === account.id)!;
    expect(restored.name).toBe("peter");
    expect(restored.configDir).toBe(path.join(otherHome, ".claude-peter"));
    expect(restored.authenticated).toBe(true);
    const credentialPath = path.join(restored.configDir, ".credentials.json");
    expect(readFileSync(credentialPath, "utf8")).toBe('{"token":"secret"}');
    expect(statSync(credentialPath).mode & 0o777).toBe(0o600);
  });

  it("export/import: carries allowedModels across the round trip", () => {
    const account = createAccount("peter");
    writeFileSync(path.join(account.configDir, ".credentials.json"), "{}");
    store.setAllowedModels(account.id, ["opus", "sonnet"]);

    const otherHome = path.join(root, "other-home-2");
    const otherFroggHome = path.join(root, "other-frogg-2");
    mkdirSync(otherHome, { recursive: true });
    mkdirSync(otherFroggHome, { recursive: true });
    const target = new ProviderAccountStore({
      froggHome: otherFroggHome,
      homeDir: otherHome,
    });

    const imported = target.import(store.export("claude"));

    expect(imported.accounts.find((c) => c.id === account.id)?.allowedModels).toEqual([
      "opus",
      "sonnet",
    ]);
  });

  it("export/import: rejects an id collision without overwriting the existing credentials", () => {
    const account = createAccount("peter");
    const credential = path.join(account.configDir, ".credentials.json");
    writeFileSync(credential, '{"token":"local"}');
    const bundle = store.export("claude");
    bundle.accounts[0]!.credentials[0]!.contentsBase64 =
      Buffer.from('{"token":"incoming"}').toString("base64");

    expect(() => store.import(bundle)).toThrow(/already exists/);
    expect(readFileSync(credential, "utf8")).toBe('{"token":"local"}');
  });

  it("export/import: rejects a name collision", () => {
    const account = createAccount("peter");
    writeFileSync(path.join(account.configDir, ".credentials.json"), "{}");
    const bundle = store.export("claude");
    bundle.accounts[0]!.account = {
      ...bundle.accounts[0]!.account,
      id: "a-different-id",
    };

    expect(() => store.import(bundle)).toThrow(/already exists/);
  });

  it("export/import: rejects an unknown bundle version", () => {
    const account = createAccount("peter");
    writeFileSync(path.join(account.configDir, ".credentials.json"), "{}");
    const bundle = { ...store.export("claude"), version: 99 };

    expect(() => store.import(bundle)).toThrow(/Unsupported provider account bundle version/);
  });

  it("export/import: rejects a bundle whose entries belong to another provider", () => {
    const account = createAccount("peter");
    writeFileSync(path.join(account.configDir, ".credentials.json"), "{}");
    const bundle = store.export("claude");
    bundle.accounts[0]!.account = {
      ...bundle.accounts[0]!.account,
      provider: "codex",
    };

    expect(() => store.import(bundle)).toThrow(/belongs to provider/);
  });

  it("allowedModels: persists the restriction and resolves it for the account", () => {
    const account = createAccount("peter");

    const result = store.setAllowedModels(account.id, ["opus", " sonnet ", "opus", ""]);

    expect(result.accounts.find((c) => c.id === account.id)?.allowedModels).toEqual([
      "opus",
      "sonnet",
    ]);
    expect(store.allowedModelsFor("claude", account.id)).toEqual(["opus", "sonnet"]);
  });

  it("allowedModels: treats null as clearing the restriction", () => {
    const account = createAccount("peter");
    store.setAllowedModels(account.id, ["opus"]);

    store.setAllowedModels(account.id, null);

    expect(store.allowedModelsFor("claude", account.id)).toBeUndefined();
    expect(store.list().find((c) => c.id === account.id)?.allowedModels).toBeUndefined();
  });

  it("allowedModels: keeps an empty array as 'no model permitted'", () => {
    const account = createAccount("peter");
    store.setAllowedModels(account.id, []);
    expect(store.allowedModelsFor("claude", account.id)).toEqual([]);
  });

  it("allowedModels: applies to the implicit default account without moving the primary dir", () => {
    const defaultId = providerAccountDefaultId("claude");

    store.setAllowedModels(defaultId, ["opus"]);

    expect(store.allowedModelsFor("claude", null)).toEqual(["opus"]);
    expect(store.findAccount(defaultId)?.configDir).toBe(path.join(homeDir, ".claude"));
  });

  it("allowedModels: resolves the daemon-wide active account when no account is named", () => {
    const account = createAccount("peter");
    store.setAllowedModels(account.id, ["opus"]);

    expect(store.allowedModelsFor("claude", undefined)).toEqual(["opus"]);
  });

  it("allowedModels: is unrestricted for an account that no longer exists", () => {
    expect(store.allowedModelsFor("claude", "deleted-account")).toBeUndefined();
  });
});

describe("ProviderAccountStore with a home-mode provider", () => {
  let root: string;
  let froggHome: string;
  let homeDir: string;
  let store: ProviderAccountStore;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "frogg-account-store-home-"));
    froggHome = path.join(root, "frogg");
    homeDir = path.join(root, "home");
    mkdirSync(froggHome, { recursive: true });
    mkdirSync(path.join(homeDir, ".gemini", "commands"), { recursive: true });
    mkdirSync(path.join(homeDir, ".npm"), { recursive: true });
    writeFileSync(path.join(homeDir, ".gitconfig"), "[user]\n");
    // gemini ships opt-in; enabling it is a config.json change.
    savePersistedConfig(froggHome, {
      providerAccounts: { gemini: { enabled: true } },
    });
    store = new ProviderAccountStore({ froggHome, homeDir });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("provisions a synthetic home with the config dir nested inside it", () => {
    const result = store.create({
      provider: "gemini",
      name: "second",
      linkedFolders: ["commands"],
    });
    const account = result.accounts[0]!;

    expect(account.configDir).toBe(path.join(homeDir, ".gemini-second"));
    // The provider's real config dir is one level down, and the shared folder
    // is linked inside it.
    expect(statSync(path.join(account.configDir, ".gemini")).isDirectory()).toBe(true);
    expect(account.linkedFolders).toEqual(["commands"]);
    expect(existsSync(path.join(account.configDir, ".gemini", "commands"))).toBe(true);
    // Shared home state is linked back so repointing HOME does not hide it.
    expect(existsSync(path.join(account.configDir, ".npm"))).toBe(true);
    expect(existsSync(path.join(account.configDir, ".gitconfig"))).toBe(true);
    // Missing link targets (.ssh, .cache, .config/gcloud here) only warn.
    expect(result.warnings.join("\n")).toContain("does not exist");
  });

  it("reports the account authenticated from the nested credential file", () => {
    const created = store.create({
      provider: "gemini",
      name: "second",
      linkedFolders: [],
    });
    const account = created.accounts[0]!;
    expect(account.authenticated).toBe(false);

    writeFileSync(path.join(account.configDir, ".gemini", "oauth_creds.json"), "{}");
    const listed = store.list("gemini")[0]!;
    expect(listed.authenticated).toBe(true);
  });

  it("supplies HOME as the env overlay for the active account", () => {
    const created = store.create({
      provider: "gemini",
      name: "second",
      linkedFolders: [],
    });
    expect(resolveProviderAccountEnv(store, "gemini")).toEqual({
      HOME: created.accounts[0]!.configDir,
    });
    // An env-mode provider is unaffected.
    expect(resolveProviderAccountEnv(store, "claude")).toEqual({});
  });
});
