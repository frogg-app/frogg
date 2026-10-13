// Regenerates every gallery shot from the ?state= list and fails on console errors.
// Usage: node design-exploration/mockups/round-4/render.cjs [baseUrl] [stateFilter]
const path = require("path");
const fs = require("fs");
const root = path.resolve(__dirname, "../../..");
const { chromium } = require(path.join(root, "node_modules/playwright"));
const base = process.argv[2] || "http://127.0.0.1:55871/round-4/app/index.html";
const only = process.argv[3];
const out = path.join(__dirname, "shots");
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const probe = await browser.newPage();
  await probe.goto(base, { waitUntil: "load" });
  const states = await probe.evaluate(() =>
    STATES.map(({ id, g, c, m }) => ({ id, g, c, m: !!m })),
  );
  await probe.close();
  fs.writeFileSync(path.join(__dirname, "states.json"), JSON.stringify(states, null, 2) + "\n");
  const errors = [];
  const shoot = async (s, w, h, suffix) => {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: 1,
      reducedMotion: "no-preference",
    });
    const page = await ctx.newPage();
    page.on("console", (m) => m.type() === "error" && errors.push(`${s.id}${suffix}: ${m.text()}`));
    page.on("pageerror", (e) => errors.push(`${s.id}${suffix}: ${e.message}`));
    await page.goto(`${base}?state=${s.id}`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1300);
    await page.screenshot({
      path: path.join(out, `${s.id}${suffix}.jpg`),
      type: "jpeg",
      quality: 82,
    });
    await ctx.close();
  };
  for (const s of states) {
    if (only && !s.id.includes(only)) continue;
    if (s.m) await shoot(s, 390, 844, "");
    else await shoot(s, 1440, 900, "");
    process.stdout.write(".");
  }
  await browser.close();
  console.log(`\n${states.length} states`);
  if (errors.length) {
    console.log("ERRORS:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("0 console errors");
})();
