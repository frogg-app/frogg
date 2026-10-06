// A simulated checkout for the component lab: a Frogg-shaped repo tree held in memory, so the
// Files panel, file viewer, @-file picker, source control and attachments run with no daemon.
// The tree is built lazily on first read, mutated by create/rename/duplicate/delete/write, and
// reset by `resetLabFs()` on every lab reseed.
import { diffFiles } from "../fixtures";
import { latency } from "./time";

type Kind = "file" | "directory";
interface Node {
  kind: Kind;
  size: number;
  modifiedAt: string;
  revision: number;
  /** Text content; generated on first read for files that were never written. */
  text?: string;
}

const MIN = 60_000;
const stamp = (minsAgo: number) => new Date(Date.now() - minsAgo * MIN).toISOString();

/** Paths the branch (feat/session-cache-cap) touched, newest first. Drives the diff and mtimes. */
const TOUCHED: Record<string, number> = {
  "packages/server/src/store/session-store.ts": 4,
  "packages/server/src/store/session-store.test.ts": 6,
  "docs/session-cache.md": 9,
  "packages/protocol/src/config.ts": 22,
  "scratch/eviction-notes.md": 2,
};

/** The repo layout. Directories end in "/"; files carry an approximate size in bytes. */
const LAYOUT: Array<[string, number?]> = [
  [".github/workflows/ci.yml", 3820],
  [".github/workflows/release.yml", 5210],
  [".github/CODEOWNERS", 212],
  [".vscode/settings.json", 340],
  [".gitignore", 286],
  [".nvmrc", 4],
  ["AGENTS.md", 9420],
  ["CLAUDE.md", 604],
  ["README.md", 4180],
  ["LICENSE", 1071],
  ["package.json", 2310],
  ["package-lock.json", 1_284_920],
  ["tsconfig.base.json", 712],
  ["frogg.json", 860],
  ["docs/architecture.md", 7340],
  ["docs/session-cache.md", 412],
  ["docs/release-streams.md", 5120],
  ["docs/providers.md", 6210],
  ["docs/images/rail.png", 182_400],
  ["scratch/eviction-notes.md", 640],
  ["scripts/release-promote.mjs", 3410],
  ["scripts/build-lab.cjs", 2120],
  ["apps/ui-next/package.json", 1840],
  ["apps/ui-next/app.config.js", 920],
  ["apps/ui-next/LAB.md", 18_400],
  ["apps/ui-next/src/app/_layout.tsx", 2210],
  ["apps/ui-next/src/app/index.tsx", 8920],
  ["apps/ui-next/src/app/lab.tsx", 410],
  ["apps/ui-next/src/components/Rail.tsx", 12_800],
  ["apps/ui-next/src/components/Files.tsx", 10_400],
  ["apps/ui-next/src/components/Chat.tsx", 14_300],
  ["apps/ui-next/src/components/Composer.tsx", 16_900],
  ["apps/ui-next/src/components/SessionList.tsx", 11_200],
  ["apps/ui-next/src/components/ScmPanel.tsx", 13_700],
  ["apps/ui-next/src/components/Text.tsx", 1420],
  ["apps/ui-next/src/components/Cut.tsx", 2980],
  ["apps/ui-next/src/components/tools/FileViewer.tsx", 12_100],
  ["apps/ui-next/src/components/tools/Menu.tsx", 7400],
  ["apps/ui-next/src/components/settings/Settings.tsx", 9800],
  ["apps/ui-next/src/components/settings/controls.tsx", 8700],
  ["apps/ui-next/src/daemon/store.ts", 9100],
  ["apps/ui-next/src/daemon/files.ts", 6200],
  ["apps/ui-next/src/daemon/scm.ts", 8800],
  ["apps/ui-next/src/theme/tokens.ts", 9900],
  ["apps/ui-next/src/ui-store.ts", 4100],
  ["apps/ui-next/assets/icon.png", 48_210],
  ["apps/ui/package.json", 3120],
  ["apps/ui/src/App.tsx", 6400],
  ["packages/client/package.json", 940],
  ["packages/client/src/index.ts", 380],
  ["packages/client/src/daemon-client.ts", 214_000],
  ["packages/protocol/package.json", 880],
  ["packages/protocol/src/index.ts", 290],
  ["packages/protocol/src/messages.ts", 342_000],
  ["packages/protocol/src/config.ts", 8420],
  ["packages/server/package.json", 2410],
  ["packages/server/tsconfig.json", 420],
  ["packages/server/src/index.ts", 1820],
  ["packages/server/src/daemon.ts", 22_400],
  ["packages/server/src/session.ts", 48_100],
  ["packages/server/src/store/session-store.ts", 4820],
  ["packages/server/src/store/session-store.test.ts", 3910],
  ["packages/server/src/store/agent-store.ts", 7300],
  ["packages/server/src/providers/claude.ts", 18_200],
  ["packages/server/src/providers/codex.ts", 15_400],
  ["packages/server/src/providers/index.ts", 960],
  ["packages/server/src/git/checkout.ts", 21_000],
  ["packages/server/src/git/streams.ts", 14_800],
  ["packages/server/src/terminal/pty.ts", 6100],
  ["packages/server/src/util/logger.ts", 1400],
  ["node_modules/.package-lock.json", 1_120_000],
  ["node_modules/zustand/package.json", 2100],
  ["node_modules/react/package.json", 1900],
  ["dist/index.js", 482_000],
];

/** Directories git ignores; kept in the tree because the daemon lists them too. */
export const IGNORED = new Set(["node_modules", "dist", ".expo"]);

type Tree = Map<string, Node>;
let tree: Tree | null = null;
const written = new Map<string, string>();

function hashAge(path: string): number {
  let h = 0;
  for (const ch of path) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 60 + (h % (60 * 24 * 40));
}

function build(): Tree {
  const t: Tree = new Map();
  t.set(".", { kind: "directory", size: 0, modifiedAt: stamp(2), revision: 1 });
  for (const [path, size = 1200] of LAYOUT) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      const dir = parts.slice(0, i).join("/");
      if (!t.has(dir))
        t.set(dir, { kind: "directory", size: 0, modifiedAt: stamp(hashAge(dir)), revision: 1 });
    }
    t.set(path, {
      kind: "file",
      size,
      modifiedAt: stamp(TOUCHED[path] ?? hashAge(path)),
      revision: 1,
    });
  }
  return t;
}

function fs(): Tree {
  tree ??= build();
  return tree;
}

/** Back to the pristine checkout (called on every lab reseed). */
export function resetLabFs(): void {
  tree = null;
  written.clear();
}

const norm = (p: string) => {
  const s = p.replace(/^\.\/?/, "").replace(/\/+$/, "");
  return s === "" ? "." : s;
};
const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".");
const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const join = (dir: string, name: string) => (dir === "." ? name : `${dir}/${name}`);

/** Host folders above the checkouts, for the new-session directory browser. */
const HOST_DIRS: Record<string, string[]> = {
  "/": ["home", "opt", "tmp"],
  "/home": ["dev"],
  "/home/dev": ["frogg", "frogg-site", "notes", "scratch"],
};

function children(dir: string): string[] {
  const out: string[] = [];
  for (const key of fs().keys())
    if (key !== "." && parentOf(key) === dir && !out.includes(key)) out.push(key);
  return out;
}

export async function listDirectory(cwd: string, path: string) {
  await latency(path === "." ? 260 : 140);
  const host = HOST_DIRS[cwd.replace(/\/+$/, "") || "/"];
  if (host && norm(path) === ".")
    return {
      path: ".",
      absolutePath: cwd,
      entries: host.map((name) => ({
        name,
        path: name,
        kind: "directory" as Kind,
        size: 0,
        modifiedAt: stamp(hashAge(name)),
      })),
    };
  const dir = norm(path);
  const node = fs().get(dir);
  if (!node || node.kind !== "directory") throw new Error(`ENOENT: no such directory '${path}'`);
  return {
    path: dir,
    absolutePath: dir === "." ? cwd : `${cwd}/${dir}`,
    entries: children(dir).map((p) => {
      const n = fs().get(p) as Node;
      return { name: baseName(p), path: p, kind: n.kind, size: n.size, modifiedAt: n.modifiedAt };
    }),
  };
}

const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf)$/i;
const MIME: Record<string, string> = {
  png: "image/png",
  json: "application/json",
  md: "text/markdown",
  ts: "text/typescript",
  tsx: "text/typescript",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  yml: "text/yaml",
};
const extOf = (p: string) => (p.includes(".") ? p.slice(p.lastIndexOf(".") + 1) : "");

/** A 1×1 transparent PNG, so image previews have something real to decode. */
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

export async function readFile(_cwd: string, path: string, _req?: string, maxBytes?: number) {
  const p = norm(path);
  const node = fs().get(p);
  await latency(node && node.size > 100_000 ? 420 : 160);
  if (!node || node.kind !== "file") throw new Error(`ENOENT: no such file '${path}'`);
  if (BINARY.test(p))
    return {
      bytes: PNG,
      mime: MIME[extOf(p)] ?? "application/octet-stream",
      size: node.size,
      path: p,
      kind: "image" as const,
      modifiedAt: node.modifiedAt,
      revision: String(node.revision),
    };
  node.text ??= contentFor(p);
  const bytes = new TextEncoder().encode(node.text);
  const cut = maxBytes && bytes.length > maxBytes ? bytes.slice(0, maxBytes) : bytes;
  return {
    bytes: cut,
    mime: MIME[extOf(p)] ?? "text/plain",
    size: bytes.length,
    path: p,
    kind: "text" as const,
    modifiedAt: node.modifiedAt,
    revision: String(node.revision),
  };
}

export async function writeFile(input: {
  path: string;
  content: string;
  expectedModifiedAt: string;
}) {
  await latency(180);
  const p = norm(input.path);
  const node = fs().get(p);
  if (!node || node.kind !== "file")
    return { status: "error" as const, error: `ENOENT: no such file '${input.path}'` };
  node.text = input.content;
  node.size = new TextEncoder().encode(input.content).length;
  node.modifiedAt = new Date().toISOString();
  node.revision += 1;
  written.set(p, input.content);
  return {
    status: "written" as const,
    modifiedAt: node.modifiedAt,
    size: node.size,
    revision: String(node.revision),
  };
}

const BAD_NAME = /[/\\]|^\.\.?$/;

export async function createFileEntry(input: {
  cwd: string;
  parentPath: string;
  name: string;
  kind: Kind;
}) {
  await latency(150);
  const parent = norm(input.parentPath);
  const path = join(parent, input.name.trim());
  const base = { cwd: input.cwd, parentPath: input.parentPath, requestId: "lab" };
  if (!input.name.trim() || BAD_NAME.test(input.name.trim()))
    return { ...base, path: null, success: false, error: "Invalid name" };
  if (fs().has(path))
    return { ...base, path: null, success: false, error: `${path} already exists` };
  fs().set(path, {
    kind: input.kind,
    size: 0,
    modifiedAt: new Date().toISOString(),
    revision: 1,
    text: input.kind === "file" ? "" : undefined,
  });
  if (input.kind === "file") written.set(path, "");
  return { ...base, path, success: true, error: null };
}

function move(from: string, to: string, copy: boolean): void {
  const t = fs();
  for (const [key, node] of Array.from(t.entries())) {
    if (key !== from && !key.startsWith(`${from}/`)) continue;
    const next = to + key.slice(from.length);
    t.set(next, { ...node, modifiedAt: new Date().toISOString() });
    if (written.has(key) || copy) written.set(next, node.text ?? contentFor(key));
    if (!copy) {
      t.delete(key);
      written.delete(key);
    }
  }
}

export async function renameFileEntry(input: { cwd: string; path: string; name: string }) {
  await latency(150);
  const from = norm(input.path);
  const to = join(parentOf(from), input.name.trim());
  const base = { cwd: input.cwd, path: input.path, requestId: "lab" };
  if (!fs().has(from)) return { ...base, renamedPath: null, success: false, error: "Not found" };
  if (BAD_NAME.test(input.name.trim()))
    return { ...base, renamedPath: null, success: false, error: "Invalid name" };
  if (fs().has(to))
    return { ...base, renamedPath: null, success: false, error: `${to} already exists` };
  move(from, to, false);
  return { ...base, renamedPath: to, success: true, error: null };
}

export async function duplicateFileEntry(input: { cwd: string; path: string }) {
  await latency(170);
  const from = norm(input.path);
  const base = { cwd: input.cwd, path: input.path, requestId: "lab" };
  if (!fs().has(from)) return { ...base, duplicatedPath: null, success: false, error: "Not found" };
  const dot = baseName(from).lastIndexOf(".");
  const stem = dot > 0 ? from.slice(0, from.length - baseName(from).length + dot) : from;
  const ext = dot > 0 ? baseName(from).slice(dot) : "";
  let to = `${stem} copy${ext}`;
  for (let n = 2; fs().has(to); n += 1) to = `${stem} copy ${n}${ext}`;
  move(from, to, true);
  return { ...base, duplicatedPath: to, success: true, error: null };
}

export async function deleteFileEntry(input: { cwd: string; path: string }) {
  await latency(140);
  const p = norm(input.path);
  const base = { cwd: input.cwd, path: input.path, requestId: "lab" };
  if (p === "." || !fs().has(p)) return { ...base, success: false, error: "Not found" };
  for (const key of Array.from(fs().keys()))
    if (key === p || key.startsWith(`${p}/`)) {
      fs().delete(key);
      written.delete(key);
    }
  return { ...base, success: true, error: null };
}

let uploads = 0;
export async function uploadFile(input: { fileName: string; mimeType: string; bytes: unknown }) {
  await latency(320);
  uploads += 1;
  const size = (input.bytes as { length?: number } | null)?.length ?? 0;
  return {
    requestId: "lab",
    error: null,
    file: {
      type: "uploaded_file" as const,
      id: `upload-${uploads}`,
      fileName: input.fileName,
      mimeType: input.mimeType,
      size,
      path: `/home/dev/.frogg/uploads/${uploads}-${input.fileName}`,
    },
  };
}

// ---- diff: the branch's changes plus anything edited or created in the lab --------------------

const PATH_MAP: Record<string, string> = {
  "src/store/session-store.ts": "packages/server/src/store/session-store.ts",
};

const line = (type: "add" | "remove" | "context", content: string) => ({ type, content });

/** Fixture hunks with repo paths, plus extra branch files and live lab edits (as additions). */
export function labDiff() {
  const out = diffFiles.map((f) => Object.assign({}, f, { path: PATH_MAP[f.path] ?? f.path }));
  out.push(
    {
      path: "packages/server/src/store/session-store.test.ts",
      isNew: false,
      isDeleted: false,
      additions: 9,
      deletions: 1,
      hunks: [
        {
          oldStart: 18,
          oldCount: 3,
          newStart: 18,
          newCount: 11,
          lines: [
            line("context", "  });"),
            line("context", ""),
            line("remove", '  it.todo("evicts when full");'),
            line("add", '  it("evicts the least recently used entry when full", () => {'),
            line("add", "    const store = new SessionStore({ sessionCache: { maxEntries: 2 } });"),
            line("add", '    store.set("a", entry());'),
            line("add", '    store.set("b", entry());'),
            line("add", '    store.get("a");'),
            line("add", '    store.set("c", entry());'),
            line("add", '    expect(store.has("b")).toBe(false);'),
            line("add", "  });"),
            line("add", ""),
          ],
        },
      ],
    },
    {
      path: "packages/protocol/src/config.ts",
      isNew: false,
      isDeleted: false,
      additions: 3,
      deletions: 0,
      hunks: [
        {
          oldStart: 112,
          oldCount: 2,
          newStart: 112,
          newCount: 5,
          lines: [
            line("context", '  logLevel: LogLevelSchema.default("info"),'),
            line("add", "  sessionCache: z"),
            line("add", "    .object({ maxEntries: z.number().int().positive().default(200) })"),
            line("add", "    .optional(),"),
            line("context", "});"),
          ],
        },
      ],
    },
    {
      path: "scratch/eviction-notes.md",
      isNew: true,
      isDeleted: false,
      additions: 4,
      deletions: 0,
      hunks: [
        {
          oldStart: 0,
          oldCount: 0,
          newStart: 1,
          newCount: 4,
          lines: [
            line("add", "# Eviction notes (untracked)"),
            line("add", ""),
            line("add", "- LRU via Map insertion order; re-set on get to bump recency."),
            line("add", "- Check the daemon restart path keeps maxEntries."),
          ],
        },
      ],
    },
  );
  const seen = new Set(out.map((f) => f.path));
  for (const [path, text] of written) {
    if (seen.has(path) || !fs().has(path)) continue;
    const lines = text.split("\n");
    out.push({
      path,
      isNew: !LAYOUT.some(([p]) => p === path),
      isDeleted: false,
      additions: lines.length,
      deletions: 0,
      hunks: [
        {
          oldStart: 0,
          oldCount: 0,
          newStart: 1,
          newCount: lines.length,
          lines: lines.map((l) => line("add", l)),
        },
      ],
    });
  }
  return out;
}

/** Every file path in the checkout (for search and pickers). */
export function labPaths(): string[] {
  return [...fs().entries()].filter(([, n]) => n.kind === "file").map(([p]) => p);
}

// ---- contents ----------------------------------------------------------------------------------

const KNOWN: Record<string, string> = {
  "packages/server/src/store/session-store.ts": `import type { DaemonConfig } from "@frogg/protocol";
import { logger } from "../util/logger";

export interface Entry {
  agentId: string;
  cwd: string;
  updatedAt: number;
}

/**
 * In-memory cache of live sessions. Bounded by \`sessionCache.maxEntries\`; when full, the least
 * recently used entry is evicted (Map keeps insertion order, so a get re-inserts to bump it).
 */
export class SessionStore {
  private readonly entries = new Map<string, Entry>();
  private readonly max: number;

  constructor(config: DaemonConfig) {
    this.max = config.sessionCache?.maxEntries ?? 200;
  }

  get(id: string): Entry | undefined {
    const hit = this.entries.get(id);
    if (!hit) return undefined;
    this.entries.delete(id);
    this.entries.set(id, hit);
    return hit;
  }

  set(id: string, entry: Entry): void {
    if (this.entries.size >= this.max) this.evictOldest();
    this.entries.set(id, entry);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  private evictOldest(): void {
    const oldest = this.entries.keys().next().value;
    if (oldest === undefined) return;
    this.entries.delete(oldest);
    logger.debug({ agentId: oldest }, "session cache evicted");
  }
}
`,
  "package.json": `{
  "name": "frogg",
  "private": true,
  "version": "1.6.13-beta.1",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "dev": "npm run dev --workspace @frogg/server",
    "test": "vitest run",
    "lint": "oxlint .",
    "format": "oxfmt .",
    "typecheck": "tsgo --noEmit -p tsconfig.base.json",
    "release:promote": "node scripts/release-promote.mjs"
  },
  "devDependencies": {
    "oxlint": "^1.14.0",
    "typescript": "^5.9.2",
    "vitest": "^3.2.4"
  },
  "engines": { "node": ">=22" }
}
`,
  "README.md": `# Frogg

Run coding agents on your own machines and steer them from anywhere: desktop, web or phone.

## Packages

| Package | What it is |
| --- | --- |
| \`packages/server\` | The daemon: agents, checkouts, terminals, release streams |
| \`packages/protocol\` | Zod schemas for every WebSocket message |
| \`packages/client\` | The typed daemon client the apps use |
| \`apps/ui\` | The shipping Expo app |
| \`apps/ui-next\` | The Bracket + Rail prototype |

## Develop

\`\`\`sh
npm ci
npm run build
npm run dev
\`\`\`

See [AGENTS.md](AGENTS.md) for conventions and [docs/](docs/) for architecture.
`,
  ".github/workflows/ci.yml": `name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test -- --reporter=dot

  android:
    needs: check
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run build:android
`,
  ".gitignore": "node_modules/\ndist/\n.expo/\n*.log\n.env\n.env.*\ncoverage/\n",
  ".nvmrc": "22\n",
  "frogg.json": `{
  "setup": ["npm ci", "npm run build"],
  "scripts": {
    "dev": { "command": "npm run dev", "port": 7821 },
    "web": { "command": "npm run web --workspace ui-next", "port": 7830 }
  },
  "streams": { "development": "main", "stable": "stable" }
}
`,
  "docs/session-cache.md": `# Session cache

The daemon keeps up to \`sessionCache.maxEntries\` sessions in memory.
`,
};

function titleOf(path: string): string {
  return baseName(path)
    .replace(/\.[^.]+$/, "")
    .replace(/[-_.]/g, " ");
}

function pascal(path: string): string {
  return titleOf(path)
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function camel(path: string): string {
  const p = pascal(path);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

function contentFor(path: string): string {
  if (written.has(path)) return written.get(path) as string;
  if (KNOWN[path]) return KNOWN[path];
  const ext = extOf(path);
  const name = baseName(path);
  if (name === "package.json") {
    const pkg = path.split("/").slice(-2, -1)[0] ?? "frogg";
    return `{
  "name": "@frogg/${pkg}",
  "version": "1.6.13-beta.1",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  }
}
`;
  }
  if (path.endsWith(".test.ts"))
    return `import { describe, expect, it } from "vitest";
import { ${pascal(path.replace(".test", ""))} } from "./${baseName(path).replace(".test.ts", "")}";

describe("${pascal(path.replace(".test", ""))}", () => {
  it("starts empty", () => {
    const subject = new ${pascal(path.replace(".test", ""))}({});
    expect(subject.size).toBe(0);
  });
});
`;
  if (ext === "tsx")
    return `import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { color } from "../theme/tokens";
import { T } from "./Text";

/** ${titleOf(path)}: renders its section of the Bracket + Rail shell. */
export function ${pascal(path)}({ title = "${titleOf(path)}" }: { title?: string }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  return (
    <View style={s.wrap}>
      <Pressable onPress={toggle} accessibilityRole="button">
        <T v="label">{title}</T>
      </Pressable>
      {open && <T style={s.body}>Expanded</T>}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 8, backgroundColor: color.bg2 },
  body: { color: color.muted },
});
`;
  if (ext === "ts" || ext === "mjs" || ext === "js" || ext === "cjs")
    return `import { logger } from "${path.includes("server") ? "./util/logger" : "./log"}";

export interface ${pascal(path)}Options {
  /** Milliseconds before a pending call gives up. */
  timeoutMs?: number;
}

/** ${titleOf(path)}. */
export function ${camel(path)}(options: ${pascal(path)}Options = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const started = Date.now();
  return {
    elapsed: () => Date.now() - started,
    expired: () => Date.now() - started > timeoutMs,
    log: (msg: string) => logger.debug({ module: "${titleOf(path)}" }, msg),
  };
}
`;
  if (ext === "json")
    return `{\n  "extends": "../../tsconfig.base.json",\n  "include": ["src"]\n}\n`;
  if (ext === "yml" || ext === "yaml")
    return `name: ${titleOf(path)}\n\non:\n  workflow_dispatch:\n\njobs:\n  run:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci\n`;
  if (ext === "md")
    return `# ${titleOf(path).replace(/^\w/, (c) => c.toUpperCase())}\n\nNotes on ${titleOf(path)} in Frogg.\n\n## Overview\n\n- The daemon owns the state; clients render it.\n- Every change goes through a typed RPC in \`packages/protocol\`.\n`;
  return `# ${name}\n`;
}
