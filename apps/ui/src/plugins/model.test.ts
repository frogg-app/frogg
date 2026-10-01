import { describe, expect, it } from "vitest";
import type { PluginCatalogEntry } from "@frogg/client/internal/daemon-client";
import {
  buildDeterministicWorkspaceTabId,
  normalizeWorkspaceTabTarget,
  workspaceTabTargetsEqual,
} from "@/workspace-tabs/identity";
import { groupCatalog } from "./catalog-model";
import { changedFieldValues, initialFieldValues, type PluginSettingField } from "./setting-values";

function entry(id: string, name: string, category: string | null): PluginCatalogEntry {
  return {
    id,
    name,
    description: null,
    author: null,
    homepage: null,
    category,
    repoUrl: "https://example.com/index.json",
    repoName: "Example",
    tier: "official",
    latest: null,
    versions: [],
    installedVersion: null,
  };
}

describe("groupCatalog", () => {
  const entries = [
    entry("acme.b", "Beta", "integrations"),
    entry("acme.a", "Alpha", "integrations"),
    entry("acme.x", "Loose", null),
    entry("acme.t", "Theme", "appearance"),
  ];

  it("groups by category, sorted, with uncategorised last", () => {
    const groups = groupCatalog(entries, "");
    expect(groups.map((g) => g.category)).toEqual(["appearance", "integrations", null]);
    expect(groups[1]?.entries.map((e) => e.name)).toEqual(["Alpha", "Beta"]);
  });

  it("filters by name, id and category", () => {
    const ids = groupCatalog(entries, "alp").flatMap((g) => g.entries);
    expect(ids.map((e) => e.id)).toEqual(["acme.a"]);
    expect(groupCatalog(entries, "appear")[0]?.entries).toHaveLength(1);
    expect(groupCatalog(entries, "nothing")).toEqual([]);
  });
});

describe("plugin setting values", () => {
  const fields: PluginSettingField[] = [
    { key: "token", title: "Token", type: "secret" },
    { key: "limit", title: "Limit", type: "number", default: 5 },
    { key: "on", title: "On", type: "boolean" },
  ];

  it("fills defaults and reports only changed keys, parsing numbers", () => {
    const initial = initialFieldValues(fields, { token: "" });
    expect(initial).toEqual({ token: "", limit: 5, on: null });
    expect(changedFieldValues(fields, initial, { ...initial, limit: "12", on: true })).toEqual({
      limit: 12,
      on: true,
    });
    expect(changedFieldValues(fields, initial, { ...initial, limit: " " })).toEqual({
      limit: null,
    });
  });
});

describe("plugin_panel tab target", () => {
  it("normalizes, compares and gets a stable id", () => {
    const target = normalizeWorkspaceTabTarget({
      kind: "plugin_panel",
      pluginId: " acme.jira ",
      panelId: "issues",
    });
    expect(target).toEqual({ kind: "plugin_panel", pluginId: "acme.jira", panelId: "issues" });
    expect(
      normalizeWorkspaceTabTarget({ kind: "plugin_panel", pluginId: "", panelId: "x" }),
    ).toBeNull();
    const other = { kind: "plugin_panel" as const, pluginId: "acme.jira", panelId: "other" };
    expect(workspaceTabTargetsEqual(target!, other)).toBe(false);
    expect(workspaceTabTargetsEqual(target!, { ...other, panelId: "issues" })).toBe(true);
    expect(buildDeterministicWorkspaceTabId(target!)).toBe("plugin_panel_9_acme.jira_issues");
  });
});
