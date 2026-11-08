// Browser smoke test for the Rust client's WASM UI (apps/client/ui).
//
// Serves a built `ui/dist`, starts a throwaway dev daemon (mock provider, scratch FROGG_HOME) and
// walks the main screens in headless Chromium: onboarding and pairing → new session (folder
// browser, mock agent) → streamed reply → reopen from the list after a reload → every settings
// page → every panel, a file, a terminal, then the phone layout. Any console error, page error or
// WASM panic fails the run.
//
//   (cd apps/client/ui && trunk build)
//   node --import tsx apps/client/e2e/smoke.mts
//
// Needs the server deps built (`npm run build:server-deps`). Env:
//   SMOKE_DIST          built UI (default apps/client/ui/dist)
//   SMOKE_DAEMON_PORT   daemon port (default 6795); SMOKE_WEB_PORT static server (default 6796)
//   SMOKE_DAEMON_ROOT   checkout whose packages/server runs the daemon (default this repo)
//   SMOKE_SHOTS         directory for screenshots of each step (optional)
//   SMOKE_THEME         theme id to start in (seeds the stored theme choice; optional)
//   SMOKE_HEADED=1      watch it run
//   SMOKE_WARN=1        print console warnings (debug builds: untracked reads, disposed signals)
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dist = path.resolve(process.env.SMOKE_DIST ?? path.join(root, "apps/client/ui/dist"));
const daemonRoot = path.resolve(process.env.SMOKE_DAEMON_ROOT ?? root);
const daemonPort = Number(process.env.SMOKE_DAEMON_PORT ?? 6795);
const webPort = Number(process.env.SMOKE_WEB_PORT ?? 6796);
const shots = process.env.SMOKE_SHOTS ? path.resolve(process.env.SMOKE_SHOTS) : null;
// The user's daemons: never dial them, whatever the environment says.
const FORBIDDEN = new Set([9999, 9969]);
const STEP_TIMEOUT = 20_000;
const REPO_NAME = "smoke-repo";
const STREAM_END = "(end of synthetic stream)";

if (FORBIDDEN.has(daemonPort) || FORBIDDEN.has(webPort)) throw new Error("reserved port");
if (!existsSync(path.join(dist, "index.html"))) {
  throw new Error(`${dist}/index.html missing: run \`trunk build\` in apps/client/ui first`);
}

const t0 = Date.now();
const log = (msg: string) =>
  console.log(`[smoke +${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

async function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}

async function waitFor(
  what: string,
  probe: () => Promise<boolean>,
  ms: number,
  child?: ChildProcess,
) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null)
      throw new Error(`${what}: process exited (${child.exitCode})`);
    if (await probe().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${what}: timed out after ${ms}ms`);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

function serveDist(): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    let file = path.join(dist, decodeURIComponent(url.pathname));
    if (!file.startsWith(dist)) file = dist;
    if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(dist, "index.html");
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(webPort, "127.0.0.1", () => resolve(server));
  });
}

function brandPrefix(): string {
  try {
    const file = path.join(daemonRoot, ".generated/branding/brand.json");
    return String(JSON.parse(readFileSync(file, "utf8")).envPrefix ?? "FROGG");
  } catch {
    return "FROGG";
  }
}

function startDaemon(home: string, userHome: string, out: string[]): ChildProcess {
  // FROGG_NODE_ENV=development exposes the mock providers; the rest keeps it off the network and
  // away from anything the environment (a Frogg agent shell) might carry over.
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: userHome };
  for (const k of Object.keys(env)) if (k.startsWith("FROGG_")) delete env[k];
  Object.assign(env, {
    FROGG_HOME: home,
    FROGG_LISTEN: `127.0.0.1:${daemonPort}`,
    FROGG_SERVER_ID: "srv_client_smoke",
    FROGG_RELAY_ENABLED: "0",
    FROGG_CORS_ORIGINS: "*",
    FROGG_WEB_UI_ENABLED: "false",
    FROGG_NODE_INSPECT: "0",
    FROGG_NODE_ENV: "development",
    FROGG_LOG_FORMAT: "json",
    // No speech: it would download its local models in the background.
    FROGG_VOICE: "false",
  });
  // A branded daemon (Frogg Next) reads its own prefix: hand it the same settings under that too.
  const prefix = brandPrefix();
  if (prefix !== "FROGG") {
    for (const [k, v] of Object.entries(env)) {
      if (k.startsWith("FROGG_")) env[`${prefix}_${k.slice("FROGG_".length)}`] = v;
    }
  }
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "packages/server/scripts/supervisor-entrypoint.ts", "--dev"],
    { cwd: daemonRoot, env, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  const keep = (b: Buffer) => {
    for (const line of b.toString().split("\n")) if (line.trim()) out.push(line);
    if (out.length > 200) out.splice(0, out.length - 200);
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  return child;
}

function stopDaemon(child: ChildProcess | null) {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {}
  setTimeout(() => {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {}
  }, 3_000).unref();
}

function makeRepo(dir: string) {
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
  git("init", "-b", "main");
  git("config", "user.email", "smoke@frogg.test");
  git("config", "user.name", "Frogg Smoke");
  git("config", "commit.gpgsign", "false");
  writeFileSync(path.join(dir, "README.md"), "# smoke\n");
  git("add", ".");
  git("commit", "-m", "init");
}

// ── the walk ─────────────────────────────────────────────────────────────────────────────────

const problems: string[] = [];
let stepName = "load";

function watch(page: Page) {
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`[${stepName}] console.error: ${m.text()}`);
    // Debug builds warn about untracked reads and disposed signals; SMOKE_WARN=1 shows them.
    if (m.type() === "warning" && process.env.SMOKE_WARN === "1") {
      log(`console.warn: ${m.text().slice(0, 600)}`);
    }
  });
  page.on("pageerror", (e) => problems.push(`[${stepName}] pageerror: ${e.message}`));
  page.on("crash", () => problems.push(`[${stepName}] page crashed`));
}

async function step(page: Page, name: string, body: () => Promise<void>) {
  stepName = name;
  log(name);
  try {
    await body();
  } finally {
    if (shots) {
      const file = path.join(shots, `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`);
      await page.screenshot({ path: file }).catch(() => undefined);
    }
  }
  // A panic poisons the WASM instance; stop at the step that caused it.
  if (problems.length) throw new Error(`errors during "${name}"`);
}

/** A rail tool, or the phone tab bar's equivalent. */
async function openTool(page: Page, label: string) {
  await page.locator(`[aria-label="${label}"]`).first().click();
}

async function desktop(page: Page, url: string, pairUrl: string, home: string, title: string) {
  await step(page, "boot", async () => {
    await page.goto(url);
    await page.locator(".ob-title, .rail").first().waitFor({ timeout: STEP_TIMEOUT });
  });

  await step(page, "onboarding", async () => {
    // First run opens the walkthrough. Answer the two profile questions.
    await page.getByText("Welcome to Frogg").waitFor({ timeout: STEP_TIMEOUT });
    await page.locator(".ob-choice").filter({ hasText: "Expert" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.locator(".ob-choice").first().click();
    await page.getByRole("button", { name: "Continue" }).click();
  });

  await step(page, "pair", async () => {
    // The fresh daemon is unclaimed: pair with the link `frogg daemon pair` prints.
    await page.getByRole("button", { name: "Pair with a code or link" }).click();
    const input = page.getByPlaceholder(/frogg:\/\/pair/).first();
    await input.fill(pairUrl);
    await page.getByRole("button", { name: "Pair", exact: true }).click();
    await input.waitFor({ state: "detached", timeout: STEP_TIMEOUT });
    // Back in the walkthrough, the host step now reports the connection.
    await page.locator(".ob-state.ok").first().waitFor({ timeout: STEP_TIMEOUT });
    await page.getByRole("button", { name: "Skip setup" }).click();
    await page.locator(".ob-title").waitFor({ state: "detached", timeout: STEP_TIMEOUT });
  });

  await step(page, "new session", async () => {
    await openTool(page, "Sessions");
    await page.locator('[aria-label="New session"]').first().click();
    const prompt = page.locator(".ns-prompt-in");
    await prompt.waitFor({ timeout: STEP_TIMEOUT });
    // No projects yet: add one with the folder browser (type the parent's path, pick the repo).
    await page.getByRole("button", { name: "Choose folder…" }).click();
    await page.getByRole("button", { name: "Type a path" }).click();
    await page.locator(".path-input input").fill(home);
    await page.locator(".path-input input").press("Enter");
    await page.locator(".dir-row").filter({ hasText: REPO_NAME }).click();
    await page.getByRole("button", { name: `Use ${REPO_NAME}` }).click();
    await page.locator(".ns-browse").waitFor({ state: "detached", timeout: STEP_TIMEOUT });
    // The mock provider, on its short stream.
    await choose(page, "Agent", 0, "Mock Load Test");
    await choose(page, "Agent", 1, "Ten second stream");
    await prompt.fill("Smoke test: say hello.");
    await page.locator(".ns-title").fill(title);
    await page.getByRole("button", { name: /^Create session/ }).click();
    await prompt.waitFor({ state: "detached", timeout: STEP_TIMEOUT });
  });

  await step(page, "streamed reply", async () => {
    await page.locator(".tl-reply-body").first().waitFor({ timeout: STEP_TIMEOUT });
    // The mock stream runs about ten seconds and ends with a fixed line.
    await page.getByText(STREAM_END).waitFor({ timeout: 40_000 });
  });

  await step(page, "session state and menu", async () => {
    // The header ⋯ lists the session actions; archive checks for unsaved work first.
    await page.locator('[aria-label="Session actions"]').first().click();
    await page.getByRole("button", { name: "Copy session ID" }).waitFor({ timeout: STEP_TIMEOUT });
    await page.getByRole("button", { name: /^Archive session/ }).click();
    await page.getByText(/leaves your lists/).waitFor({ timeout: STEP_TIMEOUT });
    await page.keyboard.press("Escape");
  });

  await step(page, "reopen from list", async () => {
    // A cold start, so the session opens from the list rather than staying mounted.
    await page.reload();
    await openTool(page, "Sessions");
    await page.locator(".srow2").filter({ hasText: title }).first().click();
    await page.getByText(STREAM_END).waitFor({ timeout: STEP_TIMEOUT });
  });

  await step(page, "popout window", async () => {
    // The row menu pops the session into its own window, which shows only its chat.
    await page.locator(".srow2").filter({ hasText: title }).first().click({ button: "right" });
    const [win] = await Promise.all([
      page.context().waitForEvent("page"),
      page.getByText("Open in new window", { exact: true }).click(),
    ]);
    watch(win);
    await win.getByText(STREAM_END).waitFor({ timeout: STEP_TIMEOUT });
    await win.close();
  });

  await step(page, "projects dialog", async () => {
    // One Escape closes only the top layer (the dialog), not the page behind it.
    await page.locator(".slist-scope").first().click();
    await page.getByText("Manage projects…", { exact: true }).click();
    await page
      .getByText("Projects on this device", { exact: true })
      .first()
      .waitFor({ timeout: STEP_TIMEOUT });
    await page.keyboard.press("Escape");
    await page
      .getByText("Projects on this device", { exact: true })
      .first()
      .waitFor({ state: "detached", timeout: STEP_TIMEOUT });
  });

  await step(page, "settings", async () => {
    await openTool(page, "Settings");
    const items = page.locator(".set-nav-item");
    await items.first().waitFor({ timeout: STEP_TIMEOUT });
    const n = await items.count();
    for (let i = 0; i < n; i++) {
      const item = items.nth(i);
      stepName = `settings: ${(await item.innerText()).trim()}`;
      await item.click();
      await page.waitForTimeout(120);
      if (problems.length) throw new Error(`errors on ${stepName}`);
      // The theme picker lives on the first page (You); keep a shot of it.
      if (i === 0 && shots) {
        await page.screenshot({ path: path.join(shots, "settings-you.png"), fullPage: true });
      }
    }
    log(`visited ${n} settings pages`);
  });

  // Every rail panel, against the open session's checkout.
  for (const tool of [
    "Search",
    "Source control",
    "PRs & CI",
    "Tasks",
    "Hosts",
    "Usage",
    "Plugins",
    "Inbox",
  ]) {
    await step(page, `panel ${tool}`, async () => {
      await openTool(page, tool);
      await page.waitForTimeout(250);
    });
  }

  await step(page, "files", async () => {
    await openTool(page, "Files");
    await page.getByText("README.md", { exact: true }).click();
    await page.locator(".pn-viewer").getByText("smoke").first().waitFor({ timeout: STEP_TIMEOUT });
  });

  await step(page, "prs streams", async () => {
    await openTool(page, "PRs & CI");
    await page.getByRole("tab", { name: "Streams" }).click();
    await page
      .locator(".pn-stream-row, .pn .pn-error, .pn .pn-empty")
      .first()
      .waitFor({ timeout: STEP_TIMEOUT });
  });

  await step(page, "scm quick settings", async () => {
    await openTool(page, "Source control");
    await page.getByRole("button", { name: "Source control view settings" }).click();
    await page.locator(".pn-quick").getByText("Branch graph").waitFor({ timeout: STEP_TIMEOUT });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Switch branch" }).click();
    await page.locator(".pn-branch-row.on").waitFor({ timeout: STEP_TIMEOUT });
    await page.keyboard.press("Escape");
  });

  await step(page, "files reopen", async () => {
    await openTool(page, "Files");
    await page.locator(".pn-node").getByText("README.md", { exact: true }).click();
  });

  await step(page, "files edit and save", async () => {
    const viewer = page.locator(".pn-viewer");
    await viewer.getByRole("tab", { name: "Edit" }).click();
    const editor = viewer.locator("textarea.pn-editor");
    await editor.fill("# smoke edited\n");
    await viewer.getByText("◆ Unsaved", { exact: false }).waitFor({ timeout: STEP_TIMEOUT });
    await viewer.getByRole("button", { name: "Save", exact: true }).click();
    await viewer.getByText("◆ Unsaved", { exact: false }).waitFor({ state: "detached" });
    await viewer.getByRole("tab", { name: "Source" }).click();
    await viewer.getByText("smoke edited").first().waitFor({ timeout: STEP_TIMEOUT });
  });

  await step(page, "files search", async () => {
    await page.getByRole("button", { name: "Search files", exact: true }).click();
    await page.getByRole("textbox", { name: "Search files" }).fill("READ");
    await page.locator(".pn-search-count").waitFor({ timeout: STEP_TIMEOUT });
    await page.getByRole("button", { name: "Close search", exact: true }).click();
  });

  await step(page, "terminal", async () => {
    await openTool(page, "Terminals");
    await page.getByRole("button", { name: "New terminal", exact: true }).click();
    await page.locator(".fr-term-row").first().waitFor({ timeout: STEP_TIMEOUT });
  });
}

/** Picks `option` in the `index`th select of the new-session row labelled `label`. */
async function choose(page: Page, label: string, index: number, option: string) {
  const row = page
    .locator(".ns-field")
    .filter({ has: page.locator(".ns-label", { hasText: label }) });
  await row.locator('[aria-haspopup="listbox"]').nth(index).click();
  await page.getByRole("option", { name: option }).first().click();
}

async function phone(page: Page, url: string, title: string) {
  await step(page, "phone boot", async () => {
    await page.goto(url);
    await page.getByText(title, { exact: true }).first().waitFor({ timeout: STEP_TIMEOUT });
  });
  await step(page, "phone session", async () => {
    await page.locator(".srow2").filter({ hasText: title }).first().click();
    await page.getByText(STREAM_END).waitFor({ timeout: STEP_TIMEOUT });
    await page.getByRole("button", { name: "Back", exact: true }).first().click();
  });
  await step(page, "phone settings", async () => {
    await page.locator(".tab").filter({ hasText: "Settings" }).click();
    await page.locator(".set-nav-item").first().click();
    await page.getByRole("button", { name: "Back", exact: true }).first().waitFor();
  });
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────

let daemon: ChildProcess | null = null;
let web: Server | null = null;
const scratch = await mkdtemp(path.join(os.tmpdir(), "frogg-client-smoke-"));
const daemonOut: string[] = [];
let failed = false;
try {
  for (const p of [daemonPort, webPort]) {
    if (!(await portFree(p))) throw new Error(`port ${p} is in use`);
  }
  if (shots) mkdirSync(shots, { recursive: true });
  // FROGG_HOME, and a HOME of its own whose only folder is the project the walk picks.
  const froggHome = path.join(scratch, "frogg");
  const userHome = path.join(scratch, "home");
  const repo = path.join(userHome, REPO_NAME);
  mkdirSync(froggHome, { recursive: true });
  mkdirSync(repo, { recursive: true });
  makeRepo(repo);

  web = await serveDist();
  daemon = startDaemon(froggHome, userHome, daemonOut);
  await waitFor(
    "daemon",
    async () => (await fetch(`http://127.0.0.1:${daemonPort}/api/health`)).ok,
    90_000,
    daemon,
  );
  log(`daemon up on ${daemonPort}`);

  // The unclaimed daemon's pairing link, as `frogg daemon pair` would print it.
  const offer = await fetch(`http://127.0.0.1:${daemonPort}/api/setup/offer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!offer.ok) throw new Error(`pairing offer: HTTP ${offer.status}`);
  const pairUrl = String(((await offer.json()) as { url: string }).url);

  const browser = await chromium.launch({ headless: process.env.SMOKE_HEADED !== "1" });
  try {
    const url = `http://127.0.0.1:${webPort}/?daemon=127.0.0.1:${daemonPort}`;
    const title = "Smoke session";
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    if (process.env.SMOKE_THEME) {
      const choice = JSON.stringify({ id: process.env.SMOKE_THEME, overrides: {} });
      await ctx.addInitScript((c) => {
        if (!localStorage.getItem("frogg.next.theme")) localStorage.setItem("frogg.next.theme", c);
      }, choice);
    }
    const page = await ctx.newPage();
    watch(page);
    await desktop(page, url, pairUrl, userHome, title);
    // Same storage (saved host, onboarding state), phone viewport.
    const state = await ctx.storageState();
    await ctx.close();
    const phoneCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      storageState: state,
    });
    const phonePage = await phoneCtx.newPage();
    watch(phonePage);
    await phone(phonePage, url, title);
    await phoneCtx.close();
  } finally {
    await browser.close();
  }
  log("passed");
} catch (error) {
  failed = true;
  console.error(`\n[smoke] FAILED at "${stepName}": ${(error as Error).message}`);
  for (const p of problems) console.error(`  ${p}`);
  if (daemonOut.length) {
    console.error("\n[smoke] daemon output (tail):");
    for (const l of daemonOut.slice(-30)) console.error(`  ${l.slice(0, 300)}`);
  }
} finally {
  stopDaemon(daemon);
  web?.close();
  await new Promise((r) => setTimeout(r, 500));
  await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
}
process.exit(failed ? 1 : 0);
