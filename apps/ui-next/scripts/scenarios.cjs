// Extra scenarios, keyed by name: (tool) => async (page, size) => {}.
module.exports = {
  terminal: (tool) => async (page) => {
    await tool(page, "Terminals", "More");
    await page.waitForTimeout(1200);
    const existing = page.getByText(/^(bash|zsh|sh|Terminal \d+)$/).first();
    if (await existing.count()) await existing.click();
    else await page.getByText("New terminal", { exact: true }).first().click();
    await page.waitForTimeout(1500);
    await page.keyboard.type("git log --oneline --graph -12 && ls -la src\n");
    await page.waitForTimeout(1500);
  },
};
