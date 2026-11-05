#!/usr/bin/env node
// Baselines for docs/plans/rust-rebuild.md: daemon cold start, idle memory and RPC latency.
//
// Boots the built Node daemon (packages/server/dist) on a random port with throwaway HOME,
// FROGG_HOME, CODEX_HOME and CLAUDE_CONFIG_DIR under .dev/rust-baselines/, so it never touches
// the real provider or Frogg homes, and never port 9999. Run after `npm run build:server`:
//
//   node scripts/bench/measure-rust-baselines.mjs [--runs 5] [--pings 500]
//   node scripts/bench/measure-rust-baselines.mjs --binary <apps/daemon-rs release binary>
//   node scripts/bench/measure-rust-baselines.mjs --front <apps/daemon-rs release binary>
//
// `--binary` measures the Rust front half (apps/daemon-rs, no Node upstream) the same way; it
// answers ping natively. A local-token is written for it, as it only reads one.
// `--front` measures phase 2: the Rust binary in `--supervise` mode in front of the Node
// worker (what FROGG_RS_FRONT=1 starts), with session RPCs forwarded to the worker.
// In `--front` mode the session RPCs alternate between the front and the same Node worker
// directly (its private port, from daemon.log), so `directSessionRpcPingMs` is the hop's
// baseline under identical machine load. Separate runs on a shared VM differ by more than the
// 0.2 ms budget the plan sets for a forwarded RPC.
// `--out <file>` also writes the JSON summary to a file.
//
// Prints a JSON summary. Measures:
//   coldStartMs   spawn → TCP listen, spawn → first answered ping over /ws, and (with a Node
//                 worker) spawn → first answered session RPC
//   rssMb         resident memory of the daemon process tree after it has idled
//   transportPingMs  sequential transport-level ping/pong round trips (p50/p95/p99/max)
//   sessionRpcPingMs sequential session-RPC pings through DaemonClient (Node daemon only)
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { WebSocket } from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({
  options: {
    runs: { type: "string", default: "5" },
    pings: { type: "string", default: "500" },
    idle: { type: "string", default: "10000" },
    binary: { type: "string" },
    front: { type: "string" },
    out: { type: "string" },
  },
});
const scratch = path.join(root, ".dev/rust-baselines");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => {
        if (port === 9999) reject(new Error("port 9999"));
        else resolve(port);
      });
    });
  });
}

function waitForPort(port, child, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (child.exitCode !== null) {
        reject(new Error(`daemon exited ${child.exitCode}`));
        return;
      }
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve(performance.now());
      });
      socket.once("error", () => {
        socket.destroy();
        if (performance.now() > deadline) reject(new Error("timeout waiting for port"));
        else setTimeout(attempt, 10);
      });
    };
    attempt();
  });
}

function isolatedEnv(run, port) {
  const base = path.join(scratch, `run-${run}`);
  rmSync(base, { recursive: true, force: true });
  const dirs = {
    HOME: path.join(base, "home"),
    FROGG_HOME: path.join(base, "frogg-home"),
    CODEX_HOME: path.join(base, "codex-home"),
    CLAUDE_CONFIG_DIR: path.join(base, "claude-config"),
    TMPDIR: path.join(base, "tmp"),
  };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  return {
    PATH: process.env.PATH,
    ...dirs,
    XDG_CONFIG_HOME: path.join(dirs.HOME, ".config"),
    XDG_DATA_HOME: path.join(dirs.HOME, ".local/share"),
    FROGG_LISTEN: `127.0.0.1:${port}`,
    FROGG_SERVER_ID: `srv_rust_baseline_${run}`,
    NODE_ENV: "production",
  };
}

/** RSS of a process and all of its descendants, from /proc. */
function treeRssMb(pid) {
  const children = new Map();
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      if (!children.has(ppid)) children.set(ppid, []);
      children.get(ppid).push(Number(entry));
    } catch {}
  }
  let kb = 0;
  const stack = [pid];
  while (stack.length) {
    const current = stack.pop();
    try {
      const status = readFileSync(`/proc/${current}/status`, "utf8");
      kb += Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0);
    } catch {}
    stack.push(...(children.get(current) ?? []));
  }
  return kb / 1024;
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const round = (n) => Math.round(n * 100) / 100;
  return {
    n: sorted.length,
    p50: round(pct(sorted, 0.5)),
    p95: round(pct(sorted, 0.95)),
    p99: round(pct(sorted, 0.99)),
    max: round(sorted.at(-1)),
  };
}

/** Retries until the freshly started daemon answers a ping, and returns that socket. */
async function firstPong(port, localToken, started) {
  for (;;) {
    let socket;
    try {
      socket = await openSocket(port, localToken);
      await rawPing(socket);
      return socket;
    } catch {
      socket?.terminate();
    }
    if (performance.now() - started > 60_000) throw new Error("no pong");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** 50 warm-up calls, then `--pings` timed sequential calls into `samples`. */
async function timeSequential(samples, call) {
  for (let i = 0; i < 50; i++) await call();
  for (let i = 0; i < Number(values.pings); i++) {
    const t = performance.now();
    await call();
    samples.push(performance.now() - t);
  }
}

function sessionClient(port, localToken) {
  return new DaemonClient({
    url: `ws://127.0.0.1:${port}/ws`,
    clientId: `rust-baseline-rpc-${port}`,
    clientType: "cli",
    password: localToken,
    // `ws`, as the CLI uses: the global WebSocket cannot send the auth header.
    webSocketFactory: (url, options) =>
      new WebSocket(url, options?.protocols, { headers: options?.headers }),
  });
}

async function measureSessionRpc(port, localToken) {
  const client = sessionClient(port, localToken);
  await client.connect();
  await timeSequential(rpcPings, () => client.ping({ timeoutMs: 5_000 }));
  await client.close?.();
}

/** The supervised worker's private address, from the front's "Worker ready" log line. */
function workerPort(froggHome) {
  const log = readFileSync(path.join(froggHome, "daemon.log"), "utf8");
  const ready = log
    .split("\n")
    .filter((line) => line.includes('"Worker ready"'))
    .at(-1);
  return Number(JSON.parse(ready).listen.split(":").at(-1));
}

/** Alternates front and direct pings so both see the same machine load. */
async function measureInterleaved(port, directPort, localToken) {
  const front = sessionClient(port, localToken);
  const direct = sessionClient(directPort, localToken);
  await front.connect();
  await direct.connect();
  const timed = async (samples, client) => {
    const t = performance.now();
    await client.ping({ timeoutMs: 5_000 });
    samples?.push(performance.now() - t);
  };
  for (let i = 0; i < 50; i++) {
    await timed(null, front);
    await timed(null, direct);
  }
  for (let i = 0; i < Number(values.pings); i++) {
    // Swap the order every round so neither side always goes first.
    if (i % 2 === 0) {
      await timed(rpcPings, front);
      await timed(directRpcPings, direct);
    } else {
      await timed(directRpcPings, direct);
      await timed(rpcPings, front);
    }
  }
  await front.close?.();
  await direct.close?.();
}

/** Retries until the session layer (the Node worker, directly or behind the front) answers. */
async function firstSessionRpc(port, localToken, started) {
  for (;;) {
    const client = sessionClient(port, localToken);
    try {
      await client.connect();
      await client.ping({ timeoutMs: 5_000 });
      await client.close?.();
      return;
    } catch {
      await client.close?.().catch(() => {});
    }
    if (performance.now() - started > 60_000) throw new Error("no session RPC");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const { DaemonClient } = await import(
  pathToFileURL(path.join(root, "packages/client/dist/daemon-client.js")).href
);
const entry = path.join(root, "packages/server/dist/scripts/supervisor-entrypoint.js");
const workerEntry = path.join(root, "packages/server/dist/server/server/daemon-worker.js");

async function readLocalToken(froggHome, started) {
  for (;;) {
    try {
      const token = readFileSync(path.join(froggHome, "local-token"), "utf8").trim();
      if (token) return token;
    } catch {}
    if (performance.now() - started > 60_000) throw new Error("no local-token");
    await new Promise((r) => setTimeout(r, 5));
  }
}

const listen = [];
const firstPing = [];
const firstRpc = [];
const rss = [];
const pings = [];
const rpcPings = [];
const directRpcPings = [];

function openSocket(port, token) {
  return new Promise((resolve, reject) => {
    // The bearer goes in the subprotocol, as DaemonClient sends it, and the header.
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, [`frogg.bearer.${token}`], {
      headers: { Authorization: `Bearer ${token}` },
    });
    socket.once("open", () => {
      // The Node daemon answers nothing before a hello; the Rust front half forwards it upstream
      // (queued until the worker is up, or dropped with none) and answers ping natively either way.
      if (!values.binary)
        socket.send(
          JSON.stringify({
            type: "hello",
            clientId: `rust-baseline-raw-${port}`,
            clientType: "cli",
            protocolVersion: 1,
            capabilities: {},
          }),
        );
      resolve(socket);
    });
    socket.once("error", reject);
  });
}

/** Transport-level `{type:"ping"}` → `{type:"pong"}`, which both daemons answer. */
function rawPing(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("pong timeout")), 5_000);
    const onMessage = (data) => {
      if (JSON.parse(String(data)).type !== "pong") return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve();
    };
    socket.on("message", onMessage);
    socket.send(JSON.stringify({ type: "ping" }));
  });
}
for (let run = 0; run < Number(values.runs); run++) {
  const port = await freePort();
  const env = isolatedEnv(run, port);
  if (values.binary)
    writeFileSync(path.join(env.FROGG_HOME, "local-token"), randomBytes(32).toString("hex"), {
      mode: 0o600,
    });
  const started = performance.now();
  let child;
  if (values.binary) {
    child = spawn(path.resolve(values.binary), [], { cwd: root, env, stdio: "ignore" });
  } else if (values.front) {
    child = spawn(
      path.resolve(values.front),
      ["--supervise", "--node", process.execPath, "--worker", workerEntry],
      { cwd: root, env, stdio: "ignore" },
    );
  } else {
    child = spawn(process.execPath, [entry], { cwd: root, env, stdio: "ignore" });
  }
  try {
    listen.push((await waitForPort(port, child, 60_000)) - started);
    // Loopback clients authenticate with the daemon's local token, like the CLI does. The Node
    // daemon writes it while it boots, so wait for the file rather than racing it.
    const localToken = await readLocalToken(env.FROGG_HOME, started);
    const socket = await firstPong(port, localToken, started);
    firstPing.push(performance.now() - started);
    if (!values.binary) {
      await firstSessionRpc(port, localToken, started);
      firstRpc.push(performance.now() - started);
    }
    if (run === 0) {
      await timeSequential(pings, () => rawPing(socket));
      // A session RPC (request/response through the session layer) where the daemon has one.
      if (values.front) await measureInterleaved(port, workerPort(env.FROGG_HOME), localToken);
      else if (!values.binary) await measureSessionRpc(port, localToken);
    }
    await new Promise((r) => setTimeout(r, Number(values.idle)));
    rss.push(treeRssMb(child.pid));
    socket.terminate();
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => (child.exitCode !== null ? r() : child.once("exit", r)));
  }
}
rmSync(scratch, { recursive: true, force: true });
let daemonLabel = `node ${process.version}`;
if (values.binary) daemonLabel = path.basename(values.binary);
if (values.front)
  daemonLabel = `${path.basename(values.front)} --supervise (node ${process.version})`;
const summary = `${JSON.stringify(
  {
    daemon: daemonLabel,
    coldStartMs: {
      listen: stats(listen),
      firstPing: stats(firstPing),
      ...(firstRpc.length ? { firstSessionRpc: stats(firstRpc) } : {}),
    },
    rssMb: stats(rss),
    transportPingMs: stats(pings),
    ...(rpcPings.length ? { sessionRpcPingMs: stats(rpcPings) } : {}),
    ...(directRpcPings.length ? { directSessionRpcPingMs: stats(directRpcPings) } : {}),
  },
  null,
  2,
)}\n`;
if (values.out) writeFileSync(values.out, summary);
process.stdout.write(summary);
process.exit(0);
