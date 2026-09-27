import { describe, expect, it } from "vitest";
import { PluginManifestSchema, PluginPanelContentSchema, addedCapabilities } from "./manifest.js";
import {
  PluginIndexSchema,
  comparePluginVersions,
  isPluginIdAllowed,
  pickPluginVersion,
  pluginVersionSatisfies,
} from "./repo-index.js";
import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "../messages.js";

const manifest = {
  id: "acme.jira-links",
  name: "Jira links",
  version: "1.2.0",
  apiVersion: 1,
  scope: "daemon",
  entry: { daemon: "dist/daemon.js" },
  capabilities: ["network", "agent.read", "rpc", "settings.store"],
  contributes: {
    commands: [{ id: "acme.jira-links.open", title: "Open issue" }],
    panels: [{ id: "issues", title: "Issues", kind: "list" }],
    settings: [{ key: "baseUrl", title: "Base URL", type: "string" }],
  },
};

describe("PluginManifestSchema", () => {
  it("accepts a valid manifest", () => {
    expect(PluginManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it.each([
    ["bad id", { id: "Acme" }],
    ["single-segment id", { id: "acme" }],
    ["bad version", { version: "1.2" }],
    ["unknown capability", { capabilities: ["root"] }],
    ["unknown scope", { scope: "kernel" }],
    ["escaping entry", { entry: { daemon: "../evil.js" } }],
    ["absolute entry", { entry: { daemon: "/etc/evil.js" } }],
    ["daemon scope without daemon entry", { entry: { client: "dist/client.js" } }],
    ["hybrid without client entry", { scope: "hybrid" }],
    ["commands without rpc", { capabilities: ["settings.store"] }],
    ["duplicate capability", { capabilities: ["rpc", "rpc", "settings.store"] }],
  ])("rejects %s", (_name, patch) => {
    expect(PluginManifestSchema.safeParse({ ...manifest, ...patch }).success).toBe(false);
  });

  it("reports capabilities an update adds", () => {
    expect(addedCapabilities(["rpc"], ["rpc", "network"])).toEqual(["network"]);
  });

  it("validates panel content", () => {
    expect(PluginPanelContentSchema.safeParse({ kind: "markdown", markdown: "# x" }).success).toBe(
      true,
    );
    expect(PluginPanelContentSchema.safeParse({ kind: "html", html: "<b>" }).success).toBe(false);
  });
});

const version = {
  version: "1.2.0",
  apiVersion: 1,
  scope: "daemon",
  capabilities: ["network"],
  tarball: "https://example.com/acme.jira-links-1.2.0.tgz",
  sha256: "a".repeat(64),
};

describe("PluginIndexSchema", () => {
  const index = {
    schemaVersion: 1,
    name: "Test",
    generatedAt: "2026-09-27T00:00:00Z",
    plugins: [{ id: "acme.jira-links", category: "integrations", versions: [version] }],
  };
  it("accepts a valid index", () => {
    expect(PluginIndexSchema.safeParse(index).success).toBe(true);
  });
  it("rejects bad sha, unknown schemaVersion, duplicates", () => {
    expect(
      PluginIndexSchema.safeParse({
        ...index,
        plugins: [{ id: "acme.jira-links", versions: [{ ...version, sha256: "xyz" }] }],
      }).success,
    ).toBe(false);
    expect(PluginIndexSchema.safeParse({ ...index, schemaVersion: 2 }).success).toBe(false);
    expect(
      PluginIndexSchema.safeParse({ ...index, plugins: [index.plugins[0], index.plugins[0]] })
        .success,
    ).toBe(false);
    expect(
      PluginIndexSchema.safeParse({
        ...index,
        plugins: [{ id: "acme.jira-links", versions: [version, version] }],
      }).success,
    ).toBe(false);
  });
});

describe("versions and policy globs", () => {
  it("compares and matches ranges", () => {
    expect(comparePluginVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(comparePluginVersions("1.0.0", "1.0.0-beta.1")).toBeGreaterThan(0);
    expect(pluginVersionSatisfies("1.4.0", "^1")).toBe(true);
    expect(pluginVersionSatisfies("2.0.0", "^1")).toBe(false);
    expect(pluginVersionSatisfies("0.3.1", "^0.3")).toBe(true);
    expect(pluginVersionSatisfies("0.4.0", "^0.3")).toBe(false);
    expect(pluginVersionSatisfies("1.2.3", "1.2.3")).toBe(true);
    expect(pluginVersionSatisfies("1.2.4", "~1.2")).toBe(true);
    expect(pluginVersionSatisfies("1.3.0", "~1.2")).toBe(false);
    expect(pluginVersionSatisfies("1.0.0-beta.1", "*")).toBe(false);
    const picked = pickPluginVersion(
      [
        { version: "1.0.0", apiVersion: 1 },
        { version: "1.5.0", apiVersion: 2 },
        { version: "1.4.0", apiVersion: 1 },
      ],
      "^1",
      (v) => v === 1,
    );
    expect(picked?.version).toBe("1.4.0");
  });

  it("applies allow/deny globs with deny winning", () => {
    expect(isPluginIdAllowed("acme.x", { allow: ["acme.*"] })).toBe(true);
    expect(isPluginIdAllowed("other.x", { allow: ["acme.*"] })).toBe(false);
    expect(isPluginIdAllowed("acme.x", { allow: ["acme.*"], deny: ["acme.x"] })).toBe(false);
    expect(isPluginIdAllowed("anything.y", {})).toBe(true);
  });
});

describe("plugin RPC messages", () => {
  it("parses requests and responses through the session unions", () => {
    expect(
      SessionInboundMessageSchema.safeParse({
        type: "plugins.install.request",
        requestId: "r1",
        id: "acme.jira-links",
        repoUrl: "https://example.com/index.json",
        grantedCapabilities: ["network"],
      }).success,
    ).toBe(true);
    expect(
      SessionOutboundMessageSchema.safeParse({
        type: "plugins.changed",
        payload: { pluginId: null, reason: "repos" },
      }).success,
    ).toBe(true);
    expect(
      SessionOutboundMessageSchema.safeParse({
        type: "plugins.rpc.call.response",
        payload: { requestId: "r1", error: null, result: { ok: true } },
      }).success,
    ).toBe(true);
  });
});
