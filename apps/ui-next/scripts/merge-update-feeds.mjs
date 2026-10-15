#!/usr/bin/env node
// Merges the per-target `<feed>.<target>.feed.json` fragments build-desktop.mjs leaves into the
// electron-updater feeds `<feed>` (e.g. frogg-next-latest-mac.yml from the arm64 and x64 builds),
// then deletes the fragments. The feeds are written in electron-builder's own YAML layout.
// No dependencies: the release job runs it straight from a checkout.
// Usage: node apps/ui-next/scripts/merge-update-feeds.mjs <dir> [--expect name.yml ...]
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const FRAGMENT = /^(?<feed>.+\.yml)\.(?<target>[\w-]+)\.feed\.json$/;

/** Merges one feed's fragments: same version, every file listed once, the first one's legacy path. */
export function mergeFeed(feed, fragments) {
  if (!fragments.length) throw new Error(`No fragments for ${feed}`);
  const versions = new Set(fragments.map((f) => f.version));
  if (versions.size !== 1)
    throw new Error(`${feed}: fragments disagree on version (${[...versions].join(", ")})`);
  const files = [];
  for (const fragment of fragments) {
    for (const file of fragment.files ?? [])
      if (!files.some((f) => f.url === file.url)) files.push(file);
  }
  if (!files.length) throw new Error(`${feed}: fragments list no files`);
  const [first] = fragments;
  const releaseDate = fragments
    .map((f) => f.releaseDate)
    .filter(Boolean)
    .sort()
    .at(-1);
  return { ...first, files, ...(releaseDate ? { releaseDate } : {}) };
}

/** File names stay plain like electron-builder writes them; anything else is single-quoted. */
const scalar = (value) => {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = String(value);
  if (/^[A-Za-z][\w.+-]*$/.test(text) && !/^(true|false|null|yes|no|on|off|y|n)$/i.test(text))
    return text;
  return `'${text.replaceAll("'", "''")}'`;
};

/** electron-builder's feed layout: top-level scalars, and `files` as a list of flat maps. */
export function toYaml(feed) {
  const lines = [];
  for (const [key, value] of Object.entries(feed)) {
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) {
      lines.push(`${key}: ${scalar(value)}`);
      continue;
    }
    lines.push(`${key}:`);
    for (const item of value) {
      Object.entries(item)
        .filter(([, v]) => v !== undefined && v !== null)
        .forEach(([k, v], i) => lines.push(`${i ? "    " : "  - "}${k}: ${scalar(v)}`));
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Groups the fragments in `dir` by feed and writes each merged feed; returns the feed names. */
export function mergeUpdateFeeds(dir) {
  const groups = new Map();
  for (const entry of readdirSync(dir).sort()) {
    const match = FRAGMENT.exec(entry);
    if (!match?.groups) continue;
    const list = groups.get(match.groups.feed) ?? [];
    list.push(JSON.parse(readFileSync(path.join(dir, entry), "utf8")));
    groups.set(match.groups.feed, list);
    rmSync(path.join(dir, entry));
  }
  for (const [feed, fragments] of groups)
    writeFileSync(path.join(dir, feed), toYaml(mergeFeed(feed, fragments)));
  return [...groups.keys()].sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { expect: { type: "string", multiple: true, default: [] } },
  });
  const dir = positionals[0];
  if (!dir) throw new Error("Usage: merge-update-feeds.mjs <dir> [--expect feed.yml ...]");
  const written = mergeUpdateFeeds(dir);
  const missing = values.expect.filter((feed) => !written.includes(feed));
  if (missing.length) throw new Error(`Missing update feeds: ${missing.join(", ")}`);
  console.log(written.length ? `Wrote ${written.join(", ")}` : "No update feed fragments");
}
