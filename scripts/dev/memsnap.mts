// Heap-snapshot diff across a repeated scenario, to name what a leak retains.
// Takes a snapshot, runs N reconnect cycles, takes another, and reports the constructors
// whose instance count and retained shallow size grew the most.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { buildHostAgentDetailRoute } from "../../apps/ui/src/utils/host-routes.ts";
import { buildSeededHost } from "../../apps/ui/e2e/support/helpers/daemon-registry.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({
  options: { cycles: { type: "string", default: "25" }, scenario: { type: "string", default: "reconnect" } },
});
const cycles = Number(values.cycles);
const state = JSON.parse(await readFile(path.join(root, ".dev/preview/state.json"), "utf8"));
const routeFor = (i: number) =>
  buildHostAgentDetailRoute(state.serverId, state.agents[i].id, state.workspaceId);

const browser = await chromium.launch({ args: ["--js-flags=--expose-gc"] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, colorScheme: "dark", hasTouch: true, isMobile: true, deviceScaleFactor: 1,
});
await context.addInitScript(
  (d) => localStorage.setItem("@frogg:daemon-registry", JSON.stringify([d])),
  buildSeededHost({ serverId: state.serverId, endpoint: state.daemonEndpoint, label: "preview", nowIso: new Date().toISOString() }),
);
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("HeapProfiler.enable");

interface Tally { count: number; size: number }

async function snapshotTally(): Promise<Map<string, Tally>> {
  await cdp.send("HeapProfiler.collectGarbage");
  let raw = "";
  const onChunk = (e: { chunk: string }) => { raw += e.chunk; };
  cdp.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
  await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false, treatGlobalObjectsAsRoots: true });
  cdp.off("HeapProfiler.addHeapSnapshotChunk", onChunk);

  const snap = JSON.parse(raw);
  const { node_fields, node_types } = snap.snapshot.meta;
  const fieldCount = node_fields.length;
  const typeIdx = node_fields.indexOf("type");
  const nameIdx = node_fields.indexOf("name");
  const sizeIdx = node_fields.indexOf("self_size");
  const typeNames: string[] = node_types[typeIdx];
  const strings: string[] = snap.strings;
  const nodes: number[] = snap.nodes;

  const tally = new Map<string, Tally>();
  for (let i = 0; i < nodes.length; i += fieldCount) {
    const kind = typeNames[nodes[i + typeIdx]!]!;
    const name = strings[nodes[i + nameIdx]!] ?? "";
    const key = `${kind}:${name}`;
    const entry = tally.get(key) ?? { count: 0, size: 0 };
    entry.count += 1;
    entry.size += nodes[i + sizeIdx]!;
    tally.set(key, entry);
  }
  return tally;
}

await page.goto(`${state.localWebUrl}${routeFor(0)}`, { waitUntil: "load" });
await page.getByRole("textbox", { name: "Message agent..." }).first().waitFor({ state: "visible", timeout: 60_000 });
await page.waitForTimeout(6000);

// Warm up so first-use allocations do not show up as growth.
for (let i = 0; i < 5; i += 1) {
  await context.setOffline(true); await page.waitForTimeout(1200);
  await context.setOffline(false); await page.waitForTimeout(3500);
}

console.log("baseline snapshot…");
const before = await snapshotTally();
for (let i = 0; i < cycles; i += 1) {
  await context.setOffline(true); await page.waitForTimeout(1200);
  await context.setOffline(false); await page.waitForTimeout(3500);
  process.stdout.write(`.${i % 10 === 9 ? "\n" : ""}`);
}
console.log("\nfinal snapshot…");
const after = await snapshotTally();

const deltas: Array<{ key: string; dCount: number; dSize: number }> = [];
for (const [key, a] of after) {
  const b = before.get(key) ?? { count: 0, size: 0 };
  deltas.push({ key, dCount: a.count - b.count, dSize: a.size - b.size });
}
deltas.sort((x, y) => y.dSize - x.dSize);
console.log(`\n--- top growth over ${cycles} reconnect cycles (shallow size) ---`);
for (const d of deltas.slice(0, 30)) {
  if (d.dSize <= 0) break;
  console.log(
    `${(d.dSize / 1024).toFixed(1).padStart(9)} kB  ${String(d.dCount).padStart(7)} objs  ${(d.dCount / cycles).toFixed(1).padStart(7)}/cycle  ${d.key}`,
  );
}
await browser.close();
