// Screenshots the running web app per scenario at phone, tablet and desktop sizes, and reports
// console errors. Rebuilds the progress gallery index afterwards.
// Usage: node apps/ui-next/scripts/shots.cjs <tag> [scenario,scenario] [sizes]
//   SEND="text" also sends a chat message in the chat scenario.
const path = require("path");
const fs = require("fs");
const root = path.resolve(__dirname, "../../..");
const { chromium } = require(path.join(root, "node_modules/playwright"));
const url = process.env.URL || "http://127.0.0.1:7830/";
const out = path.join(root, "design-exploration/mockups/ui-next");
const tag = process.argv[2] || "xx";
const only = process.argv[3] ? process.argv[3].split(",") : null;
const sizeFilter = process.argv[4] ? process.argv[4].split(",") : null;
const sizes = { desktop: [1440, 900], tablet: [1024, 768], portrait: [768, 1024], phone: [390, 844] };

const tool = async (page, name, phoneLabel) => {
  const rail = page.getByLabel(name, { exact: true });
  if (await rail.count()) return rail.first().click();
  await page.getByText(phoneLabel ?? name, { exact: true }).first().click();
};

const scenarios = {
  home: async () => {},
  chat: async (page) => {
    await page.getByText("Preview chat").first().click();
    await page.waitForTimeout(1200);
    if (process.env.SEND) {
      const box = page.getByPlaceholder(/^Message/).first();
      await box.fill(process.env.SEND);
      await box.press("Enter");
      await page.waitForTimeout(Number(process.env.WAIT || 4000));
    }
  },
  scm: async (page, size) => {
    // Source control follows the open session's checkout; pick one with changes.
    await page.getByText("Preview chat").first().click();
    await page.waitForTimeout(500);
    if (size === "phone") await page.getByLabel("Back").first().click();
    await tool(page, "Source control", "Source");
    await page.waitForTimeout(1500);
    await page.getByText("session-store.ts", { exact: true }).first().click();
    await page.waitForTimeout(800);
  },
  "scm-list": async (page) => {
    await tool(page, "Source control", "Source");
    await page.waitForTimeout(1500);
  },
};
for (const [name, fn] of Object.entries(require("./scenarios.cjs"))) if (name !== "goMore") scenarios[name] = fn(tool);

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  for (const [size, [w, h]] of Object.entries(sizes)) {
    if (sizeFilter && !sizeFilter.includes(size)) continue;
    for (const [name, fn] of Object.entries(scenarios)) {
      if (only && !only.includes(name)) continue;
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      page.on("pageerror", (e) => errors.push(`${size}/${name}: ${e.message}`));
      page.on("console", (m) => {
        // The hosts scenarios point at an address that does not resolve, on purpose.
        if (m.type() === "error" && !/ERR_NAME_NOT_RESOLVED/.test(m.text())) errors.push(`${size}/${name}: ${m.text()}`);
      });
      await page.goto(url, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1200);
      try {
        await fn(page, size);
      } catch (e) {
        errors.push(`${size}/${name}: scenario failed: ${e.message.split("\n")[0]}`);
      }
      await page.screenshot({ path: path.join(out, `${tag}-${size}-${name}.png`) });
      await page.close();
    }
  }
  await browser.close();
  require("./gallery.cjs")(out);
  console.log(errors.length ? "ERRORS\n" + [...new Set(errors)].join("\n") : "ok, no console errors");
})();
