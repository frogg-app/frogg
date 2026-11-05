#!/usr/bin/env node
// Screenshot a page in headless Chromium (dev tool, not shipped).
//   node apps/client/scripts/shot.mjs <url> <out.png> [width=1440] [height=900] [--wait=ms] [--eval=js] [--init=js] [--hover=x,y]
// Waits for network idle, then `--wait` ms more (default 600) so animations settle.
// `--eval` runs a snippet in the page before the shot (open a menu, hover the rail, …);
// `--init` runs before the app loads (seed localStorage: saved hosts, theme).
import { chromium } from "playwright";

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split(/=(.*)/s).slice(0, 2)),
);
const [url, out, width = "1440", height = "900"] = args.filter((a) => !a.startsWith("--"));
if (!url || !out) {
  console.error("usage: shot.mjs <url> <out.png> [width] [height] [--wait=ms] [--eval=js]");
  process.exit(2);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: Number(width), height: Number(height) },
    deviceScaleFactor: 1,
  });
  const logs = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") logs.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  if (flags.init) await page.addInitScript(flags.init);
  await page.goto(url, { waitUntil: "networkidle" });
  // Park the pointer mid-page so hover-driven chrome (the rail) stays at rest.
  await page.mouse.move(Number(width) / 2 + 1, Number(height) / 2, { steps: 2 });
  if (flags.hover) {
    const [x, y] = flags.hover.split(",").map(Number);
    await page.mouse.move(x, y, { steps: 4 });
  }
  if (flags.eval) await page.evaluate(flags.eval);
  await page.waitForTimeout(Number(flags.wait ?? 600));
  await page.screenshot({ path: out });
  for (const l of logs) console.log(l);
  console.log(out);
} finally {
  await browser.close();
}
