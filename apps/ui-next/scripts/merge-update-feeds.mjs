#!/usr/bin/env node
// Merges the per-target `<feed>.<target>.feed.json` fragments build-desktop.mjs leaves into the
// electron-updater feeds `<feed>` (e.g. frogg-next-latest-mac.yml from the arm64 and x64 builds),
// then deletes the fragments. The feeds are written as JSON, which is valid YAML to the updater.
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
    writeFileSync(path.join(dir, feed), `${JSON.stringify(mergeFeed(feed, fragments), null, 2)}\n`);
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
