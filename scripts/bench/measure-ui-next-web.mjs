#!/usr/bin/env node
// Client baselines for docs/plans/rust-rebuild.md: cold load of the Frogg Next web export in
// headless Chromium, on the component lab's `chat` entry (fixtures, no daemon).
//
//   (cd apps/ui-next && npx expo export -p web --output-dir ../../.dev/ui-next-web)
//   node scripts/bench/measure-ui-next-web.mjs [.dev/ui-next-web] [--runs 5] [--entry chat]
//
// Each run is a fresh browser context (cold cache). Prints JSON: bundle size, time to
// DOMContentLoaded, to the first rendered lab entry, JS heap after settling, and long-task time.
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { runs: { type: "string", default: "5" }, entry: { type: "string", default: "chat" } },
});
const dist = path.resolve(positionals[0] ?? ".dev/ui-next-web");
const types = {
  ".js": "text/javascript",
  ".html": "text/html",
  ".css": "text/css",
  ".json": "application/json",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.join(dist, url);
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory())
    file = existsSync(`${file}.html`) ? `${file}.html` : path.join(dist, "index.html");
  res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

function jsBytes(dir) {
  let total = 0;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) total += jsBytes(full);
    else if (name.name.endsWith(".js")) total += statSync(full).size;
  }
  return total;
}

const browser = await chromium.launch();
const runs = [];
for (let i = 0; i < Number(values.runs); i++) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__longTasks = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__longTasks += entry.duration;
    }).observe({ type: "longtask", buffered: true });
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const t0 = Date.now();
  await page.goto(`${base}/lab?c=${values.entry}`, { waitUntil: "domcontentloaded" });
  const domContentLoaded = Date.now() - t0;
  // The lab entry has rendered once the page body holds real text beyond the shell.
  await page.waitForFunction(() => (document.body.innerText ?? "").trim().length > 200, null, {
    timeout: 60_000,
  });
  const firstRender = Date.now() - t0;
  await page.waitForTimeout(3000);
  const metrics = Object.fromEntries(
    (await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]),
  );
  runs.push({
    domContentLoaded,
    firstRender,
    jsHeapMb: Math.round((metrics.JSHeapUsedSize / 1048576) * 10) / 10,
    longTaskMs: Math.round(await page.evaluate(() => window.__longTasks)),
    nodes: metrics.Nodes,
  });
  await context.close();
}
await browser.close();
server.close();
const median = (key) => runs.map((r) => r[key]).sort((a, b) => a - b)[Math.floor(runs.length / 2)];
process.stdout.write(
  `${JSON.stringify(
    {
      entry: values.entry,
      jsBundleMb: Math.round((jsBytes(dist) / 1048576) * 100) / 100,
      median: Object.fromEntries(Object.keys(runs[0]).map((k) => [k, median(k)])),
      runs,
    },
    null,
    2,
  )}\n`,
);
