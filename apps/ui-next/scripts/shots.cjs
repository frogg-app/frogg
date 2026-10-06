// Screenshots the running web app at phone, tablet and desktop sizes, failing on console errors.
// Usage: node apps/ui-next/scripts/shots.cjs [url] [outDir] [tag]
const path = require("path");
const fs = require("fs");
const root = path.resolve(__dirname, "../../..");
const { chromium } = require(path.join(root, "node_modules/playwright"));
const url = process.argv[2] || "http://127.0.0.1:7830/";
const out = process.argv[3] || path.join(root, "design-exploration/mockups/ui-next");
const tag = process.argv[4] || "";
const sizes = { desktop: [1440, 900], tablet: [1024, 768], phone: [390, 844] };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  for (const [name, [w, h]] of Object.entries(sizes)) {
    for (const step of ["home", "chat"]) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
      page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
      await page.goto(url, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1500);
      if (step === "chat") {
        const row = page.getByText("Preview chat").first();
        if (await row.count()) await row.click();
        await page.waitForTimeout(1200);
        if (process.env.SEND) {
          const box = page.getByPlaceholder(/^Message/).first();
          await box.fill(process.env.SEND);
          await box.press("Enter");
          await page.waitForTimeout(Number(process.env.WAIT || 4000));
        }
      }
      await page.screenshot({ path: path.join(out, `${tag}${name}-${step}.png`) });
      await page.close();
    }
  }
  await browser.close();
  if (errors.length) console.log("ERRORS\n" + [...new Set(errors)].join("\n"));
  else console.log("ok, no console errors");
})();
