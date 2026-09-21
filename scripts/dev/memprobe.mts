// Heap-growth probe: drives the running `npm run preview` through a repeated interaction loop
// inside ONE JS context and samples the heap after a forced GC each cycle.
//   npm run preview                                          # in another shell
//   node --import tsx scripts/dev/memprobe.mts --scenario send   --cycles 30
//   node --import tsx scripts/dev/memprobe.mts --scenario switch --cycles 30
//   node --import tsx scripts/dev/memprobe.mts --scenario idle   --cycles 30
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, type Page } from "@playwright/test";
import { buildHostAgentDetailRoute } from "../../apps/ui/src/utils/host-routes.ts";
import { buildSeededHost } from "../../apps/ui/e2e/support/helpers/daemon-registry.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({
  options: {
    cycles: { type: "string", default: "25" },
    scenario: { type: "string", default: "send" },
    desktop: { type: "boolean", default: false },
  },
});
const cycles = Number(values.cycles);

interface PreviewState {
  localWebUrl: string;
  daemonEndpoint: string;
  serverId: string;
  workspaceId?: string;
  agents?: Array<{ id: string; title: string }>;
}
const state: PreviewState = JSON.parse(
  await readFile(path.join(root, ".dev/preview/state.json"), "utf8"),
);
const routeFor = (i: number): string =>
  buildHostAgentDetailRoute(state.serverId, state.agents![i]!.id, state.workspaceId!);

const browser = await chromium.launch({ args: ["--js-flags=--expose-gc"] });
const context = await browser.newContext({
  viewport: values.desktop ? { width: 1400, height: 900 } : { width: 390, height: 844 },
  colorScheme: "dark",
  hasTouch: !values.desktop,
  isMobile: !values.desktop,
  deviceScaleFactor: 1,
});
await context.addInitScript(
  (daemon) => localStorage.setItem("@frogg:daemon-registry", JSON.stringify([daemon])),
  buildSeededHost({
    serverId: state.serverId,
    endpoint: state.daemonEndpoint,
    label: "preview",
    nowIso: new Date().toISOString(),
  }),
);
const page = await context.newPage();
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
const cdp = await context.newCDPSession(page);
await cdp.send("HeapProfiler.enable");
await cdp.send("Performance.enable");

async function sample() {
  await cdp.send("HeapProfiler.collectGarbage");
  const { metrics } = await cdp.send("Performance.getMetrics");
  const by = new Map(metrics.map((m) => [m.name, m.value]));
  return {
    heap: by.get("JSHeapUsedSize") ?? 0,
    nodes: by.get("Nodes") ?? 0,
    listeners: by.get("JSEventListeners") ?? 0,
  };
}

const composer = (p: Page) => p.getByRole("textbox", { name: "Message agent..." }).first();

await page.goto(`${state.localWebUrl}${routeFor(0)}`, { waitUntil: "load" });
await composer(page).waitFor({ state: "visible", timeout: 60_000 });
await page.waitForTimeout(5000);

// In-app (no reload) route change, so state accumulates in one JS context.
async function navigate(i: number): Promise<void> {
  await page.evaluate((r) => window.history.pushState({}, "", r), routeFor(i));
  await page.waitForTimeout(1500);
}

const rows: Array<{ cycle: number; heap: number; nodes: number; listeners: number }> = [];
for (let cycle = 0; cycle < cycles; cycle += 1) {
  if (values.scenario === "send") {
    const input = composer(page);
    await input.fill(`memory probe message ${cycle} ${"filler ".repeat(40)}`);
    await input.press("Enter");
    await page.waitForTimeout(3500);
  } else if (values.scenario === "reconnect") {
    // Mobile backgrounding drops the socket over and over; this is that, compressed.
    await context.setOffline(true);
    await page.waitForTimeout(1500);
    await context.setOffline(false);
    await page.waitForTimeout(4000);
  } else if (values.scenario === "switch") {
    await navigate(1);
    await navigate(0);
  } else {
    await page.waitForTimeout(4000);
  }
  const s = await sample();
  rows.push({ cycle, ...s });
  console.log(
    `cycle ${String(cycle).padStart(3)}  heap ${(s.heap / 1e6).toFixed(2)} MB  nodes ${s.nodes}  listeners ${s.listeners}`,
  );
}

const a = rows[Math.floor(rows.length / 3)]!;
const b = rows[rows.length - 1]!;
const span = Math.max(1, b.cycle - a.cycle);
console.log(`\n--- ${values.scenario}: trend over the last two thirds ---`);
console.log(`heap      ${(a.heap / 1e6).toFixed(2)} -> ${(b.heap / 1e6).toFixed(2)} MB  (${((b.heap - a.heap) / span / 1e3).toFixed(1)} kB/cycle)`);
console.log(`nodes     ${a.nodes} -> ${b.nodes}  (${((b.nodes - a.nodes) / span).toFixed(1)}/cycle)`);
console.log(`listeners ${a.listeners} -> ${b.listeners}  (${((b.listeners - a.listeners) / span).toFixed(1)}/cycle)`);

await browser.close();
