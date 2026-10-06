// Extra scenarios, keyed by name: (tool) => async (page, size) => {}.
const more = async (page, label) => {
  await page.getByText("More", { exact: true }).last().click();
  await page.waitForTimeout(300);
  await page.getByText(label, { exact: true }).last().click();
};
const go = (tool) => async (page, size, label, phoneTab) => {
  if (size === "phone" && !phoneTab) await more(page, label);
  else await tool(page, label, phoneTab);
};
module.exports = {
  terminal: (tool) => async (page, size) => {
    await go(tool)(page, size, "Terminals");
    await page.waitForTimeout(1200);
    const existing = page.getByText(/^Terminal \d+$/).first();
    if (await existing.count()) await existing.click();
    else await page.getByText("New terminal", { exact: true }).first().click();
    await page.waitForTimeout(1500);
    await page.keyboard.type("git log --oneline --graph -12 && ls -la src\n");
    await page.waitForTimeout(1500);
  },
  inbox: (tool) => async (page, size) => {
    await go(tool)(page, size, "Inbox", "Inbox");
    await page.waitForTimeout(800);
    await page.getByText("Invoice PDF renderer").last().click();
    await page.waitForTimeout(1200);
  },
  "inbox-failed": (tool) => async (page, size) => {
    await go(tool)(page, size, "Inbox", "Inbox");
    await page.waitForTimeout(800);
    await page.getByText("Stripe webhook retries").last().click();
    await page.waitForTimeout(1200);
  },
  palette: () => async (page, size) => {
    if (size === "phone") return;
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(300);
    await page.keyboard.type("se");
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(400);
  },
  more: () => async (page, size) => {
    if (size !== "phone") return;
    await page.getByText("More", { exact: true }).last().click();
    await page.waitForTimeout(400);
  },
};
const settings = (page) => async (p, size) => {
  if (size === "phone") await p.getByText("Settings", { exact: true }).last().click();
  else await p.getByLabel("Settings", { exact: true }).first().click();
  await p.waitForTimeout(600);
  await p.getByText(page, { exact: true }).first().click();
  await p.waitForTimeout(1200);
};
module.exports["settings-automation"] = () => settings("Automation");
module.exports["settings-tools"] = () => settings("Tools, skills & prompts");
module.exports["settings-providers"] = () => settings("Providers & models");
module.exports["new-session"] = () => async (p) => {
  await p.keyboard.press("Control+n");
  await p.waitForTimeout(1500);
  await p.keyboard.type(
    "Make the session cache cap configurable via config.json and log evictions at debug.",
  );
  await p.waitForTimeout(400);
};
module.exports["new-session-created"] = () => async (p) => {
  await p.keyboard.press("Control+n");
  await p.waitForTimeout(1500);
  await p.keyboard.type("Add an LRU eviction log line");
  await p.getByText("Local checkout", { exact: true }).click();
  // Never a real provider from a screenshot run: pick the mock one.
  await p.getByText("Claude", { exact: true }).first().click();
  await p.getByText("Mock Load Test", { exact: true }).click();
  await p.waitForTimeout(300);
  await p.getByText("Create session", { exact: true }).click();
  await p.waitForTimeout(5000);
};
const goMore = async (p, size, label) => {
  if (size === "phone") {
    await p.getByText("More", { exact: true }).last().click();
    await p.waitForTimeout(300);
    await p.getByText(label, { exact: true }).last().click();
  } else await p.getByLabel(label, { exact: true }).first().click();
  await p.waitForTimeout(1000);
};
module.exports.files = () => async (p, size) => {
  await goMore(p, size, "Files");
  await p.getByText("src", { exact: true }).first().click();
  await p.waitForTimeout(600);
  await p.getByText("store", { exact: true }).first().click();
  await p.waitForTimeout(600);
  await p.getByText("session-store.ts", { exact: true }).first().click();
  await p.waitForTimeout(1200);
};
module.exports.goMore = goMore;
module.exports.search = (tool) => async (p, _size) => {
  await tool(p, "Search");
  await p.waitForTimeout(500);
  await p.keyboard.type("se");
  await p.waitForTimeout(1200);
};
module.exports.usage = () => async (p, size) => {
  await module.exports.goMore(p, size, "Usage");
  await p.waitForTimeout(2500);
};
module.exports.hosts = () => async (p, size) => {
  await module.exports.goMore(p, size, "Hosts");
  await p.waitForTimeout(2000);
};
module.exports.prs = () => async (p, size) => {
  await p.getByText("Interface redesign (ui-next)").first().click();
  await p.waitForTimeout(600);
  if (size === "phone") await p.getByLabel("Back").first().click();
  await module.exports.goMore(p, size, "PRs & CI");
  await p.waitForTimeout(4000);
};
module.exports["prs-ci"] = () => async (p, size) => {
  await module.exports.prs()(p, size);
  await p
    .getByText(/^CI runs/)
    .first()
    .click();
  await p
    .getByText(/^CI runs [1-9]/)
    .first()
    .waitFor({ timeout: 20000 })
    .catch(() => {});
  await p.waitForTimeout(800);
};
module.exports["ci-run"] = () => async (p, size) => {
  await module.exports["prs-ci"]()(p, size);
  await p
    .getByText(/^Release #\d+/)
    .nth(1)
    .click();
  await p.waitForTimeout(600);
  const failed = p.getByText(/^(test|build|e2e)/i).first();
  if (await failed.count()) await failed.click();
  await p.waitForTimeout(500);
};
module.exports.tasks = () => async (p, size) => {
  await module.exports.goMore(p, size, "Tasks");
  await p.waitForTimeout(1500);
};
module.exports.plugins = () => async (p, size) => {
  await module.exports.goMore(p, size, "Plugins");
  await p.waitForTimeout(2500);
};
module.exports["plugins-browse"] = () => async (p, size) => {
  await module.exports.goMore(p, size, "Plugins");
  await p.getByText("Browse", { exact: true }).first().click();
  await p.waitForTimeout(6000);
};
module.exports.companion = () => async (p, size) => {
  await module.exports.goMore(p, size, "Companion");
  await p.waitForTimeout(1500);
};
module.exports["chat-tools"] = () => async (p, _size) => {
  await p.getByText("Preview chat").first().click();
  await p.waitForTimeout(1500);
  await p.getByText("hooks/use-scroll-anchor.ts", { exact: true }).last().click();
  await p.waitForTimeout(500);
};
module.exports["chat-model"] = () => async (p, _size) => {
  await p.getByText("Second chat").first().click();
  await p.waitForTimeout(1500);
  await p.getByText("Ten second stream", { exact: true }).last().click();
  await p.waitForTimeout(500);
};
module.exports["keys-jk"] = () => async (p) => {
  await p.keyboard.press("j");
  await p.keyboard.press("j");
  await p.keyboard.press("j");
  await p.waitForTimeout(1200);
};
module.exports["running"] = () => async (p) => {
  await p.getByText("Solo chat").first().click();
  await p.waitForTimeout(1000);
  const box = p.getByPlaceholder(/^Message/).first();
  await box.fill("Walk me through the scroll anchor.");
  await box.press("Enter");
  await p.waitForTimeout(3500);
};
module.exports["rail-glide"] = () => async (p, size) => {
  if (size === "phone") return;
  await p.getByLabel("Settings", { exact: true }).first().click();
  await p.waitForTimeout(400);
  await p.getByLabel("Search", { exact: true }).first().click();
  await p.waitForTimeout(140);
};
module.exports["hosts-add"] = () => async (p, size) => {
  await module.exports.goMore(p, size, "Hosts");
  await p.getByText("Add a host", { exact: true }).first().click();
  await p.getByPlaceholder(/^host:port/).fill("buildbox.lan:6767");
  await p.getByPlaceholder("Name (optional)").fill("buildbox");
  await p.waitForTimeout(300);
};
module.exports["hosts-offline"] = () => async (p, size) => {
  await module.exports["hosts-add"]()(p, size);
  await p.getByText("Connect", { exact: true }).click();
  await p.waitForTimeout(2500);
};
module.exports["hosts-back"] = () => async (p, size) => {
  await module.exports["hosts-offline"]()(p, size);
  await p.getByText("frogg-dev", { exact: true }).last().click();
  await p.waitForTimeout(2500);
};
