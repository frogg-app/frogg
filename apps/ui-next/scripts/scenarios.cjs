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
