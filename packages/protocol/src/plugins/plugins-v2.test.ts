import { describe, expect, it } from "vitest";
import { PluginManifestSchema, unsupportedManifestApiVersion } from "./manifest.js";
import {
  parsePluginIndexTolerant,
  pluginIndexV2Url,
  splitPluginIndexByApiVersion,
} from "./repo-index.js";

const SHA = "a".repeat(64);

function version(v: string, apiVersion: number, capabilities: string[]) {
  return {
    version: v,
    apiVersion,
    scope: "daemon",
    capabilities,
    tarball: `https://example.com/x-${v}.tgz`,
    sha256: SHA,
  };
}

describe("plugin API v2 manifests", () => {
  const base = {
    id: "acme.bot",
    name: "Bot",
    version: "1.0.0",
    scope: "daemon",
    entry: { daemon: "dist/daemon.js" },
  };

  it("needs apiVersion 2 for v2 capabilities", () => {
    expect(
      PluginManifestSchema.safeParse({
        ...base,
        apiVersion: 1,
        capabilities: ["agent.manage"],
      }).success,
    ).toBe(false);
    expect(
      PluginManifestSchema.safeParse({
        ...base,
        apiVersion: 2,
        capabilities: ["agent.manage"],
      }).success,
    ).toBe(true);
  });

  it("reports an unsupported apiVersion before validating capabilities", () => {
    expect(
      unsupportedManifestApiVersion({
        apiVersion: 3,
        capabilities: ["future.cap"],
      }),
    ).toBe(3);
    expect(unsupportedManifestApiVersion({ apiVersion: 2 })).toBeNull();
    expect(unsupportedManifestApiVersion({ apiVersion: "2" })).toBeNull();
  });
});

describe("plugin index v2", () => {
  const index = {
    schemaVersion: 1,
    name: "Repo",
    generatedAt: "2026-10-12T00:00:00Z",
    plugins: [
      { id: "acme.old", versions: [version("1.0.0", 1, ["rpc"])] },
      {
        id: "acme.bot",
        category: "integrations",
        versions: [version("1.0.0", 1, ["rpc"]), version("2.0.0", 2, ["agent.manage"])],
      },
      { id: "acme.new", versions: [version("1.0.0", 2, ["todos.read"])] },
    ],
  };

  it("splits v1-only index.json from the full index.v2.json", () => {
    const parsed = parsePluginIndexTolerant(index)!;
    const { v1, v2 } = splitPluginIndexByApiVersion(parsed);
    expect(v1.plugins.map((p) => p.id)).toEqual(["acme.old", "acme.bot"]);
    expect(v1.plugins[1]!.versions.map((v) => v.version)).toEqual(["1.0.0"]);
    expect(v2.plugins).toHaveLength(3);
  });

  it("drops versions it cannot parse instead of rejecting the index", () => {
    const future = {
      ...index,
      plugins: [
        ...index.plugins,
        { id: "acme.future", versions: [version("1.0.0", 3, ["future.cap"])] },
        {
          id: "acme.mixed",
          versions: [version("1.0.0", 1, ["rpc"]), version("2.0.0", 3, ["x"])],
        },
        { id: "not a valid id", versions: [version("1.0.0", 1, ["rpc"])] },
      ],
    };
    const parsed = parsePluginIndexTolerant(future)!;
    expect(parsed.plugins.map((p) => p.id)).toEqual([
      "acme.old",
      "acme.bot",
      "acme.new",
      "acme.mixed",
    ]);
    expect(parsed.plugins[3]!.versions).toHaveLength(1);
    expect(parsePluginIndexTolerant({ schemaVersion: 9 })).toBeNull();
  });

  it("derives the v2 URL from index.json URLs only", () => {
    expect(pluginIndexV2Url("https://x.github.io/repo/index.json")).toBe(
      "https://x.github.io/repo/index.v2.json",
    );
    expect(pluginIndexV2Url("https://x.github.io/repo/index.json?t=1")).toBe(
      "https://x.github.io/repo/index.v2.json?t=1",
    );
    expect(pluginIndexV2Url("https://x.github.io/repo/plugins.json")).toBeNull();
  });
});
