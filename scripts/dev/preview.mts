// Live UI preview: an isolated daemon plus the Expo web app with hot reload, seeded with a demo
// project and two mock-provider chats, served on the VM's LAN address so it opens in any browser.
// UI edits under apps/ui reload in place; server changes need a restart of this script.
//
//   npm run preview                 # fresh demo state each launch
//   npm run preview -- --keep       # keep the previous run's daemon home (your own chats survive)
//
//   npm run dev:live                # --live: real providers, persistent home, no demo seeding
//
// Ports: PREVIEW_PORT (web, default 7800) and PREVIEW_PORT + 1 (daemon). With --live, the
// development channel's own pair: web 9898 and daemon 9899 (PREVIEW_PORT, LIVE_DAEMON_PORT).
// `npm run shot` reads .dev/preview/state.json to screenshot the running preview.
//
// --live is the stack for trying a feature end to end before it ships as a beta: the daemon runs
// this checkout's source against your real provider logins, its home (.dev/live/home) survives
// restarts, and it restarts itself when packages/server/src or a rebuilt protocol/client dist
// changes. It imports the installed daemon's provider accounts and projects on each start, and
// names itself <hostname>-DEVELOPMENT. Add its daemon endpoint as a host in an installed Frogg app to drive it from there.
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, watch } from "node:fs";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectSeedClient } from "../../apps/ui/e2e/support/helpers/seed-client.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const live = process.argv.includes("--live");
const previewDir = path.join(root, live ? ".dev/live" : ".dev/preview");
const home = path.join(previewDir, "home");
const repo = path.join(previewDir, "demo-repo");
const keep = live || process.argv.includes("--keep");
const webPort = Number(process.env.PREVIEW_PORT ?? (live ? 9898 : 7800));
// Each channel has a fixed daemon and web port: stable 9999/9998, beta 9989/9988, development
// 9899/9898. A host added in the installed app keeps working across runs.
const daemonPort = live ? Number(process.env.LIVE_DAEMON_PORT ?? 9899) : webPort + 1;
const lanIp =
  Object.values(os.networkInterfaces())
    .flat()
    .find((entry) => entry && entry.family === "IPv4" && !entry.internal)?.address ?? "127.0.0.1";
const serverId = live ? "srv_live" : "srv_preview";
const children: ChildProcess[] = [];

function log(message: string): void {
  console.log(`[preview] ${message}`);
}

function start(
  label: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd = root,
): ChildProcess {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const forward = (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n").filter(Boolean)) {
      if (process.env.PREVIEW_VERBOSE === "1" || /error|failed|bundled|listening/i.test(line)) {
        console.log(`[${label}] ${line}`);
      }
    }
  };
  child.stdout?.on("data", forward);
  child.stderr?.on("data", forward);
  child.on("exit", (code) => {
    if (label === "daemon" && live && !shuttingDown && !restarting.has(child) && code !== 0) {
      // A restart on a source edit can catch a half-written file; try again rather than stop.
      if (daemonRetries < 3) {
        daemonRetries += 1;
        log(`daemon exited (${code}); starting it again (${daemonRetries}/3)…`);
        children.splice(children.indexOf(child), 1);
        setTimeout(() => startDaemon(), 2000);
        return;
      }
    }
    if (!shuttingDown && !restarting.has(child)) {
      log(`${label} exited (${code}); stopping.`);
      void shutdown(1);
    }
  });
  children.push(child);
  return child;
}

const restarting = new Set<ChildProcess>();
let daemonRetries = 0;
const daemonEnv: NodeJS.ProcessEnv = {
  FROGG_HOME: home,
  FROGG_SERVER_ID: serverId,
  FROGG_LISTEN: `0.0.0.0:${daemonPort}`,
  FROGG_CORS_ORIGINS: "*",
  FROGG_RELAY_ENABLED: "0",
  FROGG_NODE_INSPECT: "--inspect=0",
  NODE_ENV: "development",
  // Launched from a Frogg agent, this process carries the installed daemon's own settings; they
  // must not reach this daemon.
  FROGG_WEB_UI_ENABLED: "false",
  // Its conversations are copies of the installed daemon's; it must never continue one itself.
  FROGG_RESUME_INTERRUPTED_TURNS: live ? "0" : undefined,
  // Lets the development daemon report and rebuild itself through its launcher.
  FROGG_DEV_CONTROL_FILE: live ? path.join(root, ".dev/live/control.json") : undefined,
  FROGG_DEV_ROOT: live ? root : undefined,
  FROGG_WEB_UI_HOST: undefined,
  FROGG_WEB_UI_PORT: undefined,
  FROGG_WEB_UI_DIST_DIR: undefined,
  FROGG_INSTALL_DIR: undefined,
  FROGG_NODE_ENV: undefined,
  // A development daemon must never pass for the installed one in a host list.
  ...(live ? { FROGG_HOSTNAME: `${os.hostname()}-DEVELOPMENT` } : {}),
};
// A custom brand's daemon drops inherited FROGG_* settings and reads its own prefix (ACME_HOME),
// so hand it the same settings under that prefix. branded-run has prepared the brand already.
const brandPrefix = (() => {
  try {
    const file = path.join(root, ".generated/branding/brand.json");
    return String(JSON.parse(readFileSync(file, "utf8")).envPrefix ?? "FROGG");
  } catch {
    return "FROGG";
  }
})();
if (brandPrefix !== "FROGG") {
  for (const [key, value] of Object.entries({ ...daemonEnv })) {
    if (key.startsWith("FROGG_")) daemonEnv[`${brandPrefix}_${key.slice("FROGG_".length)}`] = value;
  }
}
let daemon: ChildProcess | undefined;
let web: ChildProcess | undefined;
let webStartedAt = Date.now();
const launcherStartedAt = Date.now();

function startWeb(clearCache = false): void {
  webStartedAt = Date.now();
  web = start(
    "web",
    process.execPath,
    [
      path.join(root, "node_modules/expo/bin/cli"),
      "start",
      "--web",
      "--port",
      String(webPort),
      ...(clearCache ? ["--clear"] : []),
    ],
    {
      BROWSER: "none",
      APP_VARIANT: "development",
      EXPO_PUBLIC_LOCAL_DAEMON: `${lanIp}:${daemonPort}`,
      EXPO_PUBLIC_FROGG_DEV_BUILD_LABEL: live ? currentBranch() : "preview",
    },
    path.join(root, "apps/ui"),
  );
}

/** Stops the Metro group and starts it again with a cleared cache. */
async function restartWeb(): Promise<void> {
  const previous = web;
  if (!previous?.pid || shuttingDown) return;
  log("restarting the web app…");
  restarting.add(previous);
  const exited = new Promise((resolve) => previous.once("exit", resolve));
  try {
    process.kill(-previous.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
  await exited;
  children.splice(children.indexOf(previous), 1);
  await waitForPortFree(webPort, 15_000);
  startWeb(true);
  await writeFile(pidFile, JSON.stringify(children.map((child) => child.pid)));
  await waitForPort(webPort, "web app", 180_000);
  await fetch(`http://127.0.0.1:${webPort}`).catch(() => undefined);
  log("web app back up; reload the page.");
}
function startDaemon(): void {
  daemon = start("daemon", "npm", ["run", "dev", "--workspace=@frogg/server"], daemonEnv);
}

async function restartDaemon(reason: string): Promise<void> {
  const previous = daemon;
  if (!previous?.pid || shuttingDown) return;
  log(`${reason} changed, restarting the daemon…`);
  restarting.add(previous);
  const exited = new Promise((resolve) => previous.once("exit", resolve));
  try {
    process.kill(-previous.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
  await exited;
  children.splice(children.indexOf(previous), 1);
  // npm exits before the daemon under it lets go of the port and its pid lock; a daemon started
  // now would find both taken and exit, and the dying one would pass for the new one.
  if (!(await waitForPortFree(daemonPort, 15_000))) {
    try {
      process.kill(-previous.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
    await waitForPortFree(daemonPort, 5_000);
  }
  startDaemon();
  await writeFile(pidFile, JSON.stringify(children.map((child) => child.pid)));
  await waitForPort(daemonPort, "daemon", 120_000);
  daemonRetries = 0;
  log("daemon back up; the app reconnects on its own.");
}

/** Debounced daemon restarts on server source edits and protocol/client rebuilds. */
function watchDaemonSources(): void {
  let timer: NodeJS.Timeout | undefined;
  let changed = "";
  const targets: Array<[string, string]> = [
    ["packages/server/src", "server source"],
    ["packages/protocol/dist", "protocol build"],
    ["packages/client/dist", "client build"],
  ];
  for (const [dir, label] of targets) {
    const absolute = path.join(root, dir);
    if (!existsSync(absolute)) continue;
    watch(absolute, { recursive: true }, (_event, file) => {
      if (!file || /\.test\.ts$|(^|\/)\./.test(String(file))) return;
      changed = label;
      clearTimeout(timer);
      // A rebuild from the app restarts the daemon itself once its build is done.
      timer = setTimeout(() => {
        if (busy !== "daemon") void restartDaemon(changed);
      }, 400);
    });
  }
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

async function waitForPortFree(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isPortOpen(port))) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function waitForPort(port: number, label: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await isPortOpen(port);
    if (open) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not listen on ${port} within ${timeoutMs / 1000}s`);
}

function currentBranch(): string {
  try {
    return execSync("git branch --show-current", { cwd: root, encoding: "utf8" }).trim() || "live";
  } catch {
    return "live";
  }
}

function git(args: string): void {
  execSync(`git ${args}`, { cwd: repo, stdio: "ignore" });
}

async function createDemoRepo(): Promise<void> {
  await rm(repo, { recursive: true, force: true });
  await mkdir(path.join(repo, "src"), { recursive: true });
  git("init -b main");
  git('config user.email "preview@frogg.test"');
  git('config user.name "Frogg Preview"');
  git("config commit.gpgsign false");
  await writeFile(path.join(repo, "README.md"), "# Demo project\n\nSeeded by npm run preview.\n");
  await writeFile(path.join(repo, "src/app.ts"), 'export const greeting = "hello";\n');
  git("add -A");
  git('commit -m "Initial commit"');
  await seedReleaseStreams();
  git("checkout -b feature/preview");
  // Uncommitted edits so the diff-stat pill and the changes pane have something to show.
  await writeFile(
    path.join(repo, "src/app.ts"),
    'export const greeting = "hello, preview";\nexport const answer = 42;\n',
  );
}

/**
 * Release-stream history for the Release streams tab: betas on main, a backport and a promotion
 * on stable, work waiting on both, pushed to a local bare "origin" the daemon reads.
 */
async function seedReleaseStreams(): Promise<void> {
  const origin = path.join(previewDir, "demo-origin.git");
  await rm(origin, { recursive: true, force: true });
  execSync(`git init -q --bare -b main "${origin}"`, { stdio: "ignore" });
  git(`remote add origin "${origin}"`);
  const at = (day: number) => {
    const date = new Date(Date.now() - (30 - day) * 86_400_000).toISOString();
    return { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  };
  const run = (args: string, day: number) =>
    execSync(`git ${args}`, { cwd: repo, stdio: "ignore", env: { ...process.env, ...at(day) } });
  const commit = async (file: string, subject: string, day: number, version?: string) => {
    await writeFile(path.join(repo, file), `${subject}\n`);
    if (version) await writeFile(path.join(repo, "package.json"), `{"version":"${version}"}\n`);
    run("add -A", day);
    run(`commit -q -m "${subject}"`, day);
  };
  const release = async (version: string, day: number) => {
    await commit("VERSION", `chore(release): cut ${version}`, day, version);
    run(`tag -a v${version} -m v${version}`, day);
  };
  await release("1.5.0", 1);
  git("branch stable");
  await commit("graph.ts", "feat(ui): stream graph for release channels", 3);
  await commit("crash.ts", "fix(server): daemon crash when a project has no remote", 4);
  const fix = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf8" }).trim();
  await release("1.6.0-beta.1", 5);
  git("checkout -q stable");
  run(`cherry-pick -x ${fix}`, 6);
  await release("1.5.1", 6);
  git("checkout -q main");
  await commit("beta.ts", "feat(desktop): install frogg beta beside frogg", 8);
  await commit("cache.ts", "perf(git): cache branch snapshots", 9);
  await release("1.6.0-beta.2", 10);
  git("checkout -q stable");
  run("merge -q --no-ff --no-commit -s ours main", 12);
  run("read-tree -u --reset main", 12);
  run('commit -q -m "chore(release): promote main 1.6.0-beta.2 to stable"', 12);
  await release("1.6.0", 12);
  await commit("install.sh", "fix(install): resolve the newest stable release only", 22);
  git("checkout -q main");
  await commit("streams.ts", "feat(streams): backport and promote commands", 15);
  await release("1.7.0-beta.1", 16);
  await commit("pill.ts", "fix(ui): channel pill contrast in light mode", 20);
  await commit("cli.ts", "feat(cli): frogg-beta self-update", 24);
  git("push -q origin main stable --tags");
  git("fetch -q origin");
}

async function seed(): Promise<Record<string, unknown>> {
  await createDemoRepo();
  const client = await connectSeedClient({ port: daemonPort, projectOwnership: "host" });
  try {
    const added = await client.addProject(repo);
    if (added.error) throw new Error(added.error);
    const created = await client.createWorkspace({ source: { kind: "directory", path: repo } });
    if (!created.workspace) throw new Error(created.error ?? "workspace creation failed");
    const workspaceId = created.workspace.id;
    const agents: Array<{ id: string; title: string }> = [];
    for (const title of ["Preview chat", "Second chat"]) {
      const agent = await client.createAgent({
        provider: "mock",
        model: "ten-second-stream",
        modeId: "load-test",
        cwd: repo,
        workspaceId,
        title,
      });
      await client.waitForAgentUpsert(agent.id, (snapshot) => snapshot.status === "idle", 30_000);
      agents.push({ id: agent.id, title });
    }
    // A second workspace running a single agent. A session row with one agent has no disclosure
    // chevron and shows its account instead, so this is the sidebar's other row shape — without
    // it the preview can only ever show the multi-agent one.
    const solo = await client.createWorkspace({
      // `refName` is the base to branch off; the new branch is named for the worktree slug.
      source: {
        kind: "worktree",
        cwd: repo,
        action: "branch-off",
        refName: "main",
        worktreeSlug: "solo",
      },
    });
    if (solo.workspace) {
      const agent = await client.createAgent({
        provider: "mock",
        model: "ten-second-stream",
        modeId: "load-test",
        cwd: solo.workspace.path ?? repo,
        workspaceId: solo.workspace.id,
        title: "Solo chat",
      });
      await client.waitForAgentUpsert(agent.id, (snapshot) => snapshot.status === "idle", 30_000);
      agents.push({ id: agent.id, title: "Solo chat" });
    }
    return { workspaceId, agents };
  } finally {
    await client.close().catch(() => undefined);
  }
}

let shuttingDown = false;
async function shutdown(code: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try {
      if (child.pid) process.kill(-child.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  await rm(path.join(previewDir, "state.json"), { force: true });
  await rm(controlFile, { force: true });
  process.exit(code);
}
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

// The daemon and Metro run in their own process groups so a clean exit can take down their whole
// trees, which also means they outlive a launcher that is killed outright. Their group ids are
// recorded in the state file; a new launch reaps whatever the last one left behind.
const pidFile = path.join(previewDir, "pids.json");
function reapPreviousRun(): void {
  let groups: number[] = [];
  try {
    groups = JSON.parse(readFileSync(pidFile, "utf8"));
  } catch {
    return;
  }
  for (const group of groups) {
    try {
      process.kill(-group, "SIGTERM");
      log(`stopped a leftover preview process group (${group})`);
    } catch {
      /* already gone */
    }
  }
}

// Live mode borrows the installed daemon's provider accounts and projects on every start, so the
// branch runs against the logins and repos already set up there instead of asking for them again.
// Accounts are only config-dir pointers (~/.claude-*), so nobody signs in twice. Agents are copied
// so existing conversations open, but both daemons then share each provider session: continue a
// conversation in one daemon at a time, or they write over each other.
// FROGG_LIVE_SOURCE_HOME picks another home; FROGG_LIVE_SOURCE_HOME=none skips the import.
/** Drops "cut off mid-turn" markers, so nothing here ever continues a copied conversation. */
async function clearInterruptedTurns(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await clearInterruptedTurns(file);
      continue;
    }
    if (!entry.name.endsWith(".json")) continue;
    const text = await readFile(file, "utf8");
    if (!text.includes('"interruptedTurn"')) continue;
    const record = JSON.parse(text) as Record<string, unknown>;
    if (!record.interruptedTurn) continue;
    record.interruptedTurn = null;
    await writeFile(file, JSON.stringify(record, null, 2));
  }
}

async function importInstalledHome(): Promise<void> {
  const source = process.env.FROGG_LIVE_SOURCE_HOME ?? path.join(os.homedir(), ".frogg");
  if (source === "none" || !existsSync(source)) return;
  const readJson = async (file: string): Promise<Record<string, unknown>> => {
    try {
      return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  const installed = await readJson(path.join(source, "config.json"));
  const configFile = path.join(home, "config.json");
  const config = await readJson(configFile);
  if (installed.providerAccounts) config.providerAccounts = installed.providerAccounts;
  // Everything this daemon would do on its own to shared sessions and worktrees is off: resuming
  // or clean-cutting agents after a usage limit, archiving merged workspaces, sweeping worktrees.
  const daemonConfig = (config.daemon ?? {}) as Record<string, unknown>;
  config.daemon = {
    ...daemonConfig,
    autoResumeOnUsageLimit: false,
    autoArchiveAfterMerge: false,
    worktreeRetentionDays: 0,
    cleanCut: {
      ...(daemonConfig.cleanCut as Record<string, unknown> | undefined),
      auto: { usageLimit: false, daemonRestart: false },
    },
  };
  await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`);
  await mkdir(path.join(home, "projects"), { recursive: true });
  for (const file of ["projects.json", "workspaces.json"]) {
    const from = path.join(source, "projects", file);
    if (existsSync(from)) await copyFile(from, path.join(home, "projects", file));
  }
  // Agent records merge over the dev home's own: installed ones are refreshed, agents made here stay.
  const agents = path.join(source, "agents");
  if (existsSync(agents)) {
    await cp(agents, path.join(home, "agents"), { recursive: true, force: true });
    await clearInterruptedTurns(path.join(home, "agents"));
  }
  log(`imported provider accounts, projects and agents from ${source}`);
}

// Launcher control: the development daemon (or any daemon on this machine, which finds this
// file) reports what is running and out of date, and asks for rebuilds, through a token-guarded
// loopback endpoint. See DevDaemonService in packages/server.
const controlFile = path.join(previewDir, "control.json");
let busy: "daemon" | "web" | null = null;
let lastActionError: string | null = null;

function newestMtime(dir: string): number {
  let newest = 0;
  const walk = (current: string) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) walk(file);
      else newest = Math.max(newest, mtimeOf(file));
    }
  };
  walk(dir);
  return newest;
}

function mtimeOf(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function behindMain(): number | null {
  try {
    const count = execSync("git rev-list --count HEAD..origin/main", {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return Number(count.trim());
  } catch {
    return null;
  }
}

async function controlStatus() {
  const depsChanged = mtimeOf(path.join(root, "package-lock.json")) > launcherStartedAt;
  const builtAt = Math.min(
    mtimeOf(path.join(root, "packages/client/dist/daemon-client.js")),
    mtimeOf(path.join(root, "packages/protocol/dist/messages.js")),
  );
  const sourceAt = Math.max(
    newestMtime(path.join(root, "packages/protocol/src")),
    newestMtime(path.join(root, "packages/client/src")),
  );
  const daemonStale: string[] = [];
  const webStale: string[] = [];
  if (sourceAt > builtAt)
    daemonStale.push("protocol or client source changed since the last build");
  if (depsChanged) {
    const reason = "dependencies changed: run npm ci, then stop and start the development daemon";
    daemonStale.push(reason);
    webStale.push(reason);
  }
  const webConfigAt = Math.max(
    ...["metro.config.js", "app.config.ts", "app.json", ".env", ".env.local"].map((name) =>
      mtimeOf(path.join(root, "apps/ui", name)),
    ),
  );
  if (webConfigAt > webStartedAt) webStale.push("web app config changed since it started");
  return {
    daemon: { running: await isPortOpen(daemonPort), stale: daemonStale },
    web: { running: await isPortOpen(webPort), stale: webStale },
    busy,
    lastError: lastActionError,
    behindMain: behindMain(),
    branch: currentBranch(),
    daemonPort,
    webPort,
  };
}

async function runAction(target: "daemon" | "web"): Promise<void> {
  busy = target;
  lastActionError = null;
  try {
    if (target === "daemon") {
      log("rebuilding protocol and client…");
      await new Promise<void>((resolve, reject) => {
        const child = spawn("npm", ["run", "build:client"], { cwd: root, stdio: "ignore" });
        child.once("error", reject);
        child.once("exit", (code) => {
          if (code === 0) {
            resolve();
            return;
          }
          reject(new Error(`npm run build:client exited with ${code}`));
        });
      });
      await restartDaemon("rebuild");
    } else {
      await restartWeb();
    }
  } catch (error) {
    lastActionError = error instanceof Error ? error.message : String(error);
    log(`${target} rebuild failed: ${lastActionError}`);
  } finally {
    busy = null;
  }
}

async function startControlServer(): Promise<void> {
  const token = randomUUID();
  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${token}`)
      return send(401, { error: "unauthorized" });
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/status") {
      void controlStatus().then((status) => send(200, status));
      return;
    }
    if (req.method === "POST" && url.pathname === "/rebuild") {
      const target = url.searchParams.get("target");
      if (target !== "daemon" && target !== "web") return send(400, { error: "unknown target" });
      if (busy) return send(409, { error: `already rebuilding the ${busy}` });
      // Answer first: rebuilding the daemon restarts the daemon that asked.
      send(202, { accepted: true });
      void runAction(target);
      return;
    }
    send(404, { error: "not found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  server.unref();
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await writeFile(
    controlFile,
    JSON.stringify({ url: `http://127.0.0.1:${port}`, token, pid: process.pid, cwd: root }),
  );
}

async function main(): Promise<void> {
  reapPreviousRun();
  await mkdir(previewDir, { recursive: true });
  if (!keep) await rm(home, { recursive: true, force: true });
  await mkdir(home, { recursive: true });

  if (!existsSync(path.join(root, "packages/client/dist/daemon-client.js"))) {
    log("building client packages (first run only)…");
    execSync("npm run build:server-deps", { cwd: root, stdio: "inherit" });
  }

  if (live) await importInstalledHome();
  log("starting daemon…");
  startDaemon();
  log("starting web app…");
  startWeb();
  if (live) await startControlServer();

  await writeFile(pidFile, JSON.stringify(children.map((child) => child.pid)));
  await waitForPort(daemonPort, "daemon", 120_000);
  const seeded = live || (keep && existsSync(path.join(home, "projects"))) ? {} : await seed();
  if (live) watchDaemonSources();
  await waitForPort(webPort, "web app", 180_000);
  log("compiling the web bundle (first load is the slow one)…");
  await fetch(`http://127.0.0.1:${webPort}`).catch(() => undefined);

  const state = {
    webUrl: `http://${lanIp}:${webPort}`,
    localWebUrl: `http://127.0.0.1:${webPort}`,
    daemonEndpoint: `${lanIp}:${daemonPort}`,
    serverId,
    home,
    repo,
    ...seeded,
  };
  await writeFile(path.join(previewDir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);

  console.log("");
  console.log("══════════════════════════════════════════════════════");
  if (live) {
    console.log(`  Live:     ${state.webUrl}`);
    console.log(
      `  Daemon:   ${state.daemonEndpoint}  (real providers, home ${path.relative(root, home)})`,
    );
    console.log("  In an installed app: Add host → the daemon endpoint above.");
    console.log("  UI edits hot-reload; the daemon restarts on server edits.");
  } else {
    console.log(`  Preview:  ${state.webUrl}`);
    console.log(`  Daemon:   ${state.daemonEndpoint}  (isolated home, mock provider)`);
    console.log("  UI edits hot-reload. Screenshot with: npm run shot -- --help");
  }
  console.log("══════════════════════════════════════════════════════");
}

main().catch(async (error) => {
  console.error(`[preview] ${error instanceof Error ? error.message : String(error)}`);
  await shutdown(1);
});
