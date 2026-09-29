// Builds a local, signed plugin repository on disk and serves it over loopback HTTP.
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { generatePluginRepoKeyPair, type PluginRepoKeyPair } from "./signing.js";
import {
  buildPluginIndex,
  packPlugin,
  serializePluginIndex,
  signPluginIndexFile,
} from "./tooling.js";

export interface FixturePluginSpec {
  id: string;
  version: string;
  capabilities?: string[];
  scope?: "daemon" | "client" | "hybrid" | "build";
  category?: string;
  /** Body of dist/daemon.js. Defaults to a greet RPC returning the version. */
  code?: string;
  contributes?: Record<string, unknown>;
}

export function greetCode(tag: string): string {
  return `export default function activate(ctx) {
  ctx.rpc.handle("fx.greet", async (params) => ({ tag: ${JSON.stringify(tag)}, params }));
  if (ctx.ui) ctx.ui.setBadge("main", ${JSON.stringify(tag)});
}
export function deactivate() {}
`;
}

export async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function writeFixturePlugin(root: string, spec: FixturePluginSpec): Promise<string> {
  const dir = path.join(root, spec.category ?? "examples", spec.id);
  await fs.mkdir(path.join(dir, "dist"), { recursive: true });
  const scope = spec.scope ?? "daemon";
  const manifest = {
    id: spec.id,
    name: `Fixture ${spec.id}`,
    version: spec.version,
    apiVersion: 1,
    scope,
    entry: {
      ...(scope === "daemon" || scope === "hybrid" ? { daemon: "dist/daemon.js" } : {}),
      ...(scope === "client" || scope === "hybrid" ? { client: "dist/client.js" } : {}),
    },
    capabilities: spec.capabilities ?? ["rpc", "ui.contribute"],
    ...(spec.contributes ? { contributes: spec.contributes } : {}),
  };
  await fs.writeFile(path.join(dir, "frogg-plugin.json"), JSON.stringify(manifest, null, 2));
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: spec.id, type: "module" }),
  );
  await fs.writeFile(path.join(dir, "dist", "daemon.js"), spec.code ?? greetCode(spec.version));
  await fs.writeFile(
    path.join(dir, "dist", "client.js"),
    "export default function activate() {}\n",
  );
  return dir;
}

export interface FixtureRepo {
  url: string;
  outDir: string;
  keys: PluginRepoKeyPair;
  /** Rebuild index + signature from `plugins` (all versions ever published are kept). */
  publish(plugins: FixturePluginSpec[]): Promise<void>;
  close(): Promise<void>;
}

/** Serves `outDir` on 127.0.0.1. Each publish packs into outDir and merges versions. */
export async function startFixtureRepo(keys = generatePluginRepoKeyPair()): Promise<FixtureRepo> {
  const root = await tempDir("frogg-plugin-repo-");
  const outDir = path.join(root, "out");
  await fs.mkdir(outDir, { recursive: true });
  const server = http.createServer((req, res) => {
    const file = path.join(outDir, decodeURIComponent((req.url ?? "/").split("?")[0]!));
    fs.readFile(file).then(
      (body) => res.writeHead(200).end(body),
      () => res.writeHead(404).end(),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const published = new Map<string, unknown[]>();
  let n = 0;
  return {
    url: `${base}index.json`,
    outDir,
    keys,
    async publish(plugins) {
      const src = path.join(root, `src-${++n}`);
      for (const spec of plugins) {
        const dir = await writeFixturePlugin(src, spec);
        await packPlugin(dir, outDir);
      }
      const index = await buildPluginIndex({
        pluginsDir: src,
        tarballsDir: outDir,
        baseUrl: base,
        name: "Fixture repo",
      });
      for (const entry of index.plugins) {
        const prior = (published.get(entry.id) ?? []).filter(
          (v) => !entry.versions.some((nv) => nv.version === (v as { version: string }).version),
        );
        published.set(entry.id, [...prior, ...entry.versions]);
      }
      const merged = {
        ...index,
        plugins: [...published.entries()].map(([id, versions]) => ({
          id,
          category: "examples",
          versions,
        })),
      };
      const file = path.join(outDir, "index.json");
      await fs.writeFile(file, serializePluginIndex(merged as typeof index));
      await signPluginIndexFile(file, keys.privateKey);
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
