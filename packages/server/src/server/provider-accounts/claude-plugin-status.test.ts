import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isUpdateDue,
  listClaudePluginSources,
  marketplaceAutoUpdates,
  readClaudePluginStatus,
} from "./claude-plugin-status.js";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function write(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

/** A Claude config dir with two marketplaces and three installed plugins. */
function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "claude-plugins-"));
  roots.push(root);
  const configDir = path.join(root, ".claude");
  const plugins = path.join(configDir, "plugins");
  const official = path.join(plugins, "marketplaces", "claude-plugins-official");
  const team = path.join(plugins, "marketplaces", "team");
  write(path.join(plugins, "known_marketplaces.json"), {
    "claude-plugins-official": {
      installLocation: official,
      lastUpdated: "2026-10-13T06:49:08.681Z",
    },
    team: { installLocation: team, lastUpdated: null, autoUpdate: false },
  });
  write(path.join(official, ".claude-plugin", "marketplace.json"), {
    plugins: [
      { name: "lsp", version: "1.2.0", description: "Language server", source: "./plugins/lsp" },
      { name: "nover", source: "./plugins/nover" },
    ],
  });
  write(path.join(official, "plugins", "nover", ".claude-plugin", "plugin.json"), {
    name: "nover",
    description: "From plugin.json",
  });
  write(path.join(team, ".claude-plugin", "marketplace.json"), {
    plugins: [{ name: "deploy", source: "./plugins/deploy" }],
  });
  write(path.join(team, "plugins", "deploy", ".claude-plugin", "plugin.json"), {
    name: "deploy",
    version: "2.0.0",
  });
  write(path.join(plugins, "installed_plugins.json"), {
    version: 2,
    plugins: {
      "lsp@claude-plugins-official": [{ scope: "user", version: "1.0.0" }],
      "nover@claude-plugins-official": [{ scope: "user", version: "9f8e7d6c5b4a" }],
      "deploy@team": [{ scope: "project", projectPath: "/repo", version: "2.0.0" }],
    },
  });
  return configDir;
}

describe("Claude plugin status", () => {
  it("compares installed versions with the marketplace and plugin.json", async () => {
    const { plugins, marketplaces } = await readClaudePluginStatus(fixture());
    expect(plugins.map((p) => [p.id, p.installedVersion, p.latestVersion, p.updateDue])).toEqual([
      ["lsp@claude-plugins-official", "1.0.0", "1.2.0", true],
      ["deploy@team", "2.0.0", "2.0.0", false],
      ["nover@claude-plugins-official", "9f8e7d6c5b4a", null, false],
    ]);
    expect(plugins[0]).toMatchObject({ autoUpdate: true, description: "Language server" });
    expect(plugins[1]).toMatchObject({ autoUpdate: false, scope: "project", projectPath: "/repo" });
    expect(plugins[2]?.description).toBe("From plugin.json");
    expect(marketplaces).toEqual([
      {
        name: "claude-plugins-official",
        autoUpdate: true,
        lastUpdated: "2026-10-13T06:49:08.681Z",
      },
      { name: "team", autoUpdate: false, lastUpdated: null },
    ]);
  });

  it("returns nothing for a config dir without plugins", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "claude-empty-"));
    roots.push(root);
    expect(await readClaudePluginStatus(root)).toEqual({ plugins: [], marketplaces: [] });
  });

  it("honours Claude Code's auto-update defaults and env switches", () => {
    expect(marketplaceAutoUpdates("claude-plugins-official", undefined)).toBe(true);
    expect(marketplaceAutoUpdates("team", undefined)).toBe(false);
    expect(marketplaceAutoUpdates("team", true)).toBe(true);
    expect(
      marketplaceAutoUpdates("claude-plugins-official", true, { DISABLE_AUTOUPDATER: "1" }),
    ).toBe(false);
    expect(
      marketplaceAutoUpdates("claude-plugins-official", true, {
        DISABLE_AUTOUPDATER: "1",
        FORCE_AUTOUPDATE_PLUGINS: "1",
      }),
    ).toBe(true);
    expect(isUpdateDue("1.0.0", "1.0.1")).toBe(true);
    expect(isUpdateDue("1.1.0", "1.0.1")).toBe(false);
    expect(isUpdateDue(null, "1.0.0")).toBe(false);
  });

  it("groups accounts that share a linked plugins folder", async () => {
    const primary = fixture();
    const accountDir = path.join(path.dirname(primary), ".claude-work");
    mkdirSync(accountDir);
    symlinkSync(path.join(primary, "plugins"), path.join(accountDir, "plugins"));
    const accounts = [
      { id: "claude", name: "Default", configDir: primary, provider: "claude" },
      { id: "acc-work", name: "work", configDir: accountDir, provider: "claude" },
    ];
    const store = {
      list: () => accounts,
      getCapability: () => ({ enabled: true, primaryDirName: ".claude" }),
      activeAccountIds: () => ({}),
      findAccount: (id: string) => accounts.find((a) => a.id === id),
      primaryConfigDir: () => primary,
    };
    const sources = await listClaudePluginSources(store as never);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ accountNames: ["Default", "work"] });
    expect(sources[0]?.plugins).toHaveLength(3);
  });
});
