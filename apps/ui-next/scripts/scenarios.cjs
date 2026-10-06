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
  await p.getByLabel("Host", { exact: true }).fill("buildbox.lan:6767");
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
module.exports["n1-new-session"] = () => async (p) => {
  await p.keyboard.press("Control+n");
  await p.waitForTimeout(1500);
};
module.exports["n1-select-open"] = () => async (p) => {
  await p.keyboard.press("Control+n");
  await p.waitForTimeout(1500);
  await p.getByLabel("Project").first().click();
  await p.waitForTimeout(600);
};
module.exports["n1-settings"] = () => async (p, size) => {
  if (size === "phone") await p.getByText("Settings", { exact: true }).last().click();
  else await p.getByLabel("Settings", { exact: true }).first().click();
  await p.waitForTimeout(1000);
};
module.exports["n1-crash"] = () => async (p) => {
  await p.goto(p.url().replace(/\/?(\?.*)?$/, "/?crash"));
  await p.waitForTimeout(2000);
};

// s1: agent and personal settings pages.
for (const [id, page] of [
  ["chat", "Chat & composer"],
  ["editor", "Files, editor & terminal"],
  ["notify", "Notifications & inbox"],
  ["voice", "Voice & Companion"],
  ["accounts", "Accounts"],
  ["modes", "Permission modes"],
  ["usage", "Usage & limits"],
  ["context", "Context & clean cut"],
])
  module.exports[`s1-${id}`] = () => settings(page);
// t1: tool panel depth.
const scmOpen = async (tool, p, size) => {
  await p.getByText("Preview chat").first().click();
  await p.waitForTimeout(500);
  if (size === "phone") await p.getByLabel("Back").first().click();
  await tool(p, "Source control", "Source");
  await p.waitForTimeout(2000);
};
module.exports["scm-branch"] = (tool) => async (p, size) => {
  await scmOpen(tool, p, size);
  await p.getByLabel("Switch branch").first().click();
  await p.waitForTimeout(1200);
  await p.getByText("main", { exact: true }).last().click();
  await p.waitForTimeout(400);
};
module.exports["scm-more"] = (tool) => async (p, size) => {
  await scmOpen(tool, p, size);
  await p.getByLabel("More source control actions").first().click();
  await p.waitForTimeout(600);
};
// ---- session list (l1) ----
const listOpen = async (p, size) => {
  if (size === "phone") await p.getByText("Sessions", { exact: true }).last().click();
  await p.waitForTimeout(800);
};
const scopeTo = async (p, size, label) => {
  await listOpen(p, size);
  await p.getByLabel("Switch scope").first().click();
  await p.waitForTimeout(400);
  if (label) {
    await p.getByText(label, { exact: true }).last().click();
    await p.waitForTimeout(1200);
  }
};
module.exports["scope-menu"] = () => async (p, size) => scopeTo(p, size);
module.exports["history"] = () => async (p, size) => scopeTo(p, size, "History");
module.exports["chats"] = () => async (p, size) => scopeTo(p, size, "Chats");
module.exports["add-project"] = () => async (p, size) => {
  await scopeTo(p, size, "Add project…");
  await p.waitForTimeout(600);
};
module.exports["import"] = () => async (p, size) => {
  await scopeTo(p, size, "Import conversations…");
  await p.waitForTimeout(2500);
};
module.exports["display-menu"] = () => async (p, size) => {
  await listOpen(p, size);
  await p.getByLabel("Display options").first().click();
  await p.waitForTimeout(500);
};
const rowMenu = async (p, size) => {
  await listOpen(p, size);
  await p.getByText("Stripe webhook retries").first().click({ button: "right" });
  await p.waitForTimeout(500);
};
module.exports["session-menu"] = () => rowMenu;
module.exports["labels"] = () => async (p, size) => {
  await rowMenu(p, size);
  await p.getByText("Labels", { exact: true }).last().click();
  await p.waitForTimeout(800);
};
// s2: Host settings pages.
module.exports["settings-devices"] = () => settings("Devices & access");
module.exports["settings-security"] = () => settings("Security");
module.exports["settings-labels"] = () => settings("Session labels");
module.exports["settings-terminals"] = () => settings("Terminal profiles");
module.exports["settings-resources"] = () => settings("Resources & storage");
module.exports["settings-daemon"] = () => settings("Daemon & updates");
module.exports["release-streams"] = () => async (p, size) => {
  await module.exports.prs()(p, size);
  await p.getByText("Streams", { exact: true }).first().click();
  await p.waitForTimeout(5000);
  const first = p.getByText(/ waiting$/).first();
  if (await first.count()) await first.click();
  await p.waitForTimeout(500);
};
// h1: hosts, connection and pairing.
const hostsTool = async (p, size) => {
  await module.exports.goMore(p, size, "Hosts");
  await p.waitForTimeout(1200);
};
const hAdd = async (p, size) => {
  await hostsTool(p, size);
  await p.getByLabel("Add a host", { exact: true }).first().click();
  await p.waitForTimeout(500);
};
const hOffline = async (p, size) => {
  await hAdd(p, size);
  await p.getByText("Direct address", { exact: true }).first().click();
  await p.getByLabel("Host", { exact: true }).fill("ci-runner-2.lan:6767");
  await p.getByPlaceholder("Name (optional)").fill("ci-runner-2");
  await p.getByText("Connect", { exact: true }).last().click();
  await p.waitForTimeout(3000);
  if (size === "phone") await p.getByText("ci-runner-2", { exact: true }).first().click();
  await p.waitForTimeout(600);
};
const demoOffer = () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  const offer = {
    v: 2,
    serverId: "srv_01J9XH4",
    daemonPublicKeyB64: key,
    relay: { endpoint: "relay.frogg.dev:443", useTls: true },
  };
  return `frogg://pair#offer=${Buffer.from(JSON.stringify(offer)).toString("base64url")}`;
};
module.exports["h-tool-hosts"] = () => async (p, size) => {
  await hostsTool(p, size);
  if (size === "phone") await p.getByText("frogg-dev", { exact: true }).first().click();
  await p.waitForTimeout(1500);
};
module.exports["h-add-host"] = () => async (p, size) => {
  await hAdd(p, size);
  await p.getByLabel("Pairing code").fill("7KQ4M2XD");
  await p.waitForTimeout(400);
};
module.exports["h-pair-confirm"] = () => async (p, size) => {
  await hAdd(p, size);
  await p.getByPlaceholder(/^frogg:\/\/pair/).fill(demoOffer());
  await p.getByText("Continue", { exact: true }).last().click();
  await p.waitForTimeout(1500);
};
module.exports["h-pair-code"] = () => async (p, size) => {
  await hAdd(p, size);
  await p.getByLabel("Pairing code").fill("7KQ4M2XD");
  await p.getByPlaceholder(/^Host address/).fill("127.0.0.1:7821");
  await p.getByText("Continue", { exact: true }).last().click();
  await p.waitForTimeout(2500);
};
module.exports["h-pair-link"] = () => async (p) => {
  await p.goto(`${p.url().split("?")[0]}?pair=${encodeURIComponent(demoOffer())}`, {
    waitUntil: "networkidle",
  });
  await p.waitForTimeout(2500);
};
module.exports["h-pair-device"] = () => async (p, size) => {
  await hostsTool(p, size);
  await p.getByLabel("Pair a device", { exact: true }).first().click();
  await p.waitForTimeout(2500);
};
module.exports["h-host-offline"] = () => hOffline;
module.exports["h-remove-host"] = () => async (p, size) => {
  await hOffline(p, size);
  if (size === "phone") await p.getByText("Remove host…", { exact: true }).first().click();
  else {
    await p.getByText("ci-runner-2", { exact: true }).first().hover();
    await p.getByLabel("Remove ci-runner-2").first().click();
  }
  await p.waitForTimeout(300);
  await p.getByLabel("Host name").fill("ci-runner-");
  await p.waitForTimeout(400);
};

module.exports["settings-worktrees"] = () => settings("Worktrees");

module.exports["settings-scripts"] = () => settings("Scripts & services");

module.exports["settings-ci"] = () => settings("CI & release streams");

module.exports["settings-metadata"] = () => settings("Generated text");

module.exports["settings-about"] = () => settings("About & diagnostics");

module.exports["settings-updates"] = () => settings("App updates");

// Multi-account usage: the preview daemon has one sign-in per provider, so these swap in
// the fixture from usage-fixture.cjs (two Claude, two Codex accounts) before shooting.
const usageFixture = require("./usage-fixture.cjs");
module.exports["settings-usage"] = () => settings("Usage & limits");
module.exports["usage-multi"] = () => async (p, size) => {
  await usageFixture.apply(p);
  await module.exports.goMore(p, size, "Usage");
  await p.waitForTimeout(800);
};
module.exports["usage-multi-collapsed"] = () => async (p, size) => {
  await module.exports["usage-multi"]()(p, size);
  await p.getByLabel("Collapse Claude", { exact: true }).first().click();
  await p.waitForTimeout(300);
};
module.exports["settings-usage-multi"] = () => async (p, size) => {
  await usageFixture.apply(p);
  await settings("Usage & limits")(p, size);
};
// hp: Add host direct address, split host and port.
const hpOpen = async (p, size) => {
  await hAdd(p, size);
  await p.getByText("Direct address", { exact: true }).first().click();
  await p.waitForTimeout(200);
};
module.exports["hp-empty"] = () => hpOpen;
module.exports["hp-filled"] = () => async (p, size) => {
  await hpOpen(p, size);
  await p.getByLabel("Host", { exact: true }).fill("wss://devbox.tail1234.ts.net:7443/ws");
  await p.getByPlaceholder("Name (optional)").fill("devbox");
  await p.waitForTimeout(200);
};
module.exports["hp-badport"] = () => async (p, size) => {
  await hpOpen(p, size);
  await p.getByLabel("Host", { exact: true }).fill("buildbox.lan");
  await p.getByLabel("Port", { exact: true }).fill("70000");
  await p.waitForTimeout(200);
};
// Rail expand-on-hover (desktop/tablet) and the phone tool menu.
const railHover = async (p, wait) => {
  await p.mouse.move(700, 450);
  await p.waitForTimeout(400);
  const box = await p.getByLabel("Hosts", { exact: true }).first().boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.waitForTimeout(wait);
};
module.exports["rail-collapsed"] = () => async (p, size) => {
  if (size === "phone") return;
  await p.mouse.move(700, 450);
  await p.waitForTimeout(400);
};
module.exports["rail-mid"] = () => async (p, size) => {
  if (size === "phone") return;
  await railHover(p, 150);
};
module.exports["rail-expanded"] = () => async (p, size) => {
  if (size === "phone") return;
  await railHover(p, 700);
};
module.exports["rail-picked"] = () => async (p, size) => {
  if (size === "phone") return;
  await railHover(p, 700);
  await p.getByLabel("Usage", { exact: true }).first().click();
  await p.waitForTimeout(600);
};
module.exports["phone-menu"] = () => async (p, size) => {
  if (size !== "phone") return;
  await p.getByText("More", { exact: true }).last().click();
  await p.waitForTimeout(500);
};
