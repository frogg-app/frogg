// Live UI preview: an isolated daemon plus the Expo web app with hot reload, seeded with a demo
// project and two mock-provider chats, served on the VM's LAN address so it opens in any browser.
// UI edits under apps/ui reload in place; server changes need a restart of this script.
//
//   npm run preview                 # fresh demo state each launch
//   npm run preview -- --keep       # keep the previous run's daemon home (your own chats survive)
//
// Ports: PREVIEW_PORT (web, default 7800) and PREVIEW_PORT + 1 (daemon). `npm run shot` reads
// .dev/preview/state.json to screenshot the running preview.
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectSeedClient } from "../../apps/ui/e2e/support/helpers/seed-client.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const previewDir = path.join(root, ".dev/preview");
const home = path.join(previewDir, "home");
const repo = path.join(previewDir, "demo-repo");
const keep = process.argv.includes("--keep");
const webPort = Number(process.env.PREVIEW_PORT ?? 7800);
const daemonPort = webPort + 1;
const lanIp =
  Object.values(os.networkInterfaces())
    .flat()
    .find((entry) => entry && entry.family === "IPv4" && !entry.internal)?.address ?? "127.0.0.1";
const serverId = "srv_preview";
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
): void {
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
    if (!shuttingDown) {
      log(`${label} exited (${code}); stopping.`);
      void shutdown(1);
    }
  });
  children.push(child);
}

async function waitForPort(port: number, label: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = net.connect(port, "127.0.0.1", () => {
        socket.end();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
    });
    if (open) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not listen on ${port} within ${timeoutMs / 1000}s`);
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

async function main(): Promise<void> {
  reapPreviousRun();
  await mkdir(previewDir, { recursive: true });
  if (!keep) await rm(home, { recursive: true, force: true });
  await mkdir(home, { recursive: true });

  if (!existsSync(path.join(root, "packages/client/dist/daemon-client.js"))) {
    log("building client packages (first run only)…");
    execSync("npm run build:server-deps", { cwd: root, stdio: "inherit" });
  }

  log("starting daemon…");
  start("daemon", "npm", ["run", "dev", "--workspace=@frogg/server"], {
    FROGG_HOME: home,
    FROGG_SERVER_ID: serverId,
    FROGG_LISTEN: `0.0.0.0:${daemonPort}`,
    FROGG_CORS_ORIGINS: "*",
    FROGG_RELAY_ENABLED: "0",
    FROGG_NODE_INSPECT: "--inspect=0",
    NODE_ENV: "development",
  });
  log("starting web app…");
  start(
    "web",
    process.execPath,
    [path.join(root, "node_modules/expo/bin/cli"), "start", "--web", "--port", String(webPort)],
    {
      BROWSER: "none",
      APP_VARIANT: "development",
      EXPO_PUBLIC_LOCAL_DAEMON: `${lanIp}:${daemonPort}`,
      EXPO_PUBLIC_FROGG_DEV_BUILD_LABEL: "preview",
    },
    path.join(root, "apps/ui"),
  );

  await writeFile(pidFile, JSON.stringify(children.map((child) => child.pid)));
  await waitForPort(daemonPort, "daemon", 120_000);
  const seeded = keep && existsSync(path.join(home, "projects")) ? {} : await seed();
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
  console.log(`  Preview:  ${state.webUrl}`);
  console.log(`  Daemon:   ${state.daemonEndpoint}  (isolated home, mock provider)`);
  console.log("  UI edits hot-reload. Screenshot with: npm run shot -- --help");
  console.log("══════════════════════════════════════════════════════");
}

main().catch(async (error) => {
  console.error(`[preview] ${error instanceof Error ? error.message : String(error)}`);
  await shutdown(1);
});
