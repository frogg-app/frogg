// Share the UI-refresh design review outside the LAN: a daemon on loopback serves the static web
// build (with the design switcher), and a Cloudflare quick tunnel publishes it over HTTPS. The
// daemon runs on a copy of the preview's seeded home, so the demo project and chats are there and
// nothing touches the preview itself.
//
// Access is a key gate (design-review-gate.mts): the tunnel reaches the gate, which admits a
// browser that opened the key link once and forwards it to the daemon as a LAN client, so no
// pairing is needed. The key persists in .dev/design-review/key across restarts.
//
//   npm run build:web --workspace=@frogg/app            # rebuild after UI changes (no hot reload)
//   node --import tsx scripts/dev/design-review.mts      # start; prints the key link
//   node --import tsx scripts/dev/design-review.mts pair # a pairing link instead (claims the daemon)
//
// Needs `npm run preview` to have run once (for .dev/preview/home) and `cloudflared` on PATH.
// Ports: DESIGN_REVIEW_PORT (daemon, default 7881) and +1 (gate), both on 127.0.0.1 only.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { cp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newReviewKey, startReviewGate } from "./design-review-gate.mts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const seededHome = path.join(root, ".dev/preview/home");
const reviewDir = path.join(root, ".dev/design-review");
const home = path.join(reviewDir, "home");
const urlFile = path.join(reviewDir, "url.txt");
const distDir = path.join(root, "apps/ui/dist");
const keyFile = path.join(reviewDir, "key");
const port = Number(process.env.DESIGN_REVIEW_PORT ?? 7881);
const gatePort = port + 1;
const children: ChildProcess[] = [];

function log(message: string): void {
  console.log(`[design-review] ${message}`);
}

function start(
  label: string,
  command: string,
  args: string[],
  env: Record<string, string>,
): ChildProcess {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  child.on("exit", (code) => {
    log(`${label} exited (${code}); stopping.`);
    shutdown(1);
  });
  return child;
}

function shutdown(code: number): void {
  for (const child of children) child.kill("SIGTERM");
  process.exit(code);
}

async function waitForPort(timeoutMs: number): Promise<void> {
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
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`daemon did not listen on ${port}`);
}

/** Mint a claim offer with the CLI and re-point its endpoint at the tunnel over TLS. */
function pairingLink(tunnelUrl: string): string {
  const output = execFileSync(
    "npx",
    ["tsx", "apps/cli/src/index.ts", "auth", "pair", "--json", "--home", home],
    { cwd: root, env: { ...process.env, FROGG_HOME: home }, encoding: "utf8" },
  );
  const { deepLink } = JSON.parse(output) as { deepLink: string };
  const encoded = deepLink.split("#offer=")[1] ?? "";
  const offer = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  offer.direct = { endpoints: [`${new URL(tunnelUrl).hostname}:443`], useTls: true };
  const rewritten = Buffer.from(JSON.stringify(offer)).toString("base64url");
  return `${tunnelUrl}/?design=inset#offer=${rewritten}`;
}

async function reviewKey(): Promise<string> {
  if (existsSync(keyFile)) return readFileSync(keyFile, "utf8").trim();
  const key = newReviewKey();
  await mkdir(reviewDir, { recursive: true });
  await writeFile(keyFile, `${key}\n`, { mode: 0o600 });
  return key;
}

function printAccess(tunnelUrl: string, key: string): void {
  console.log(
    [
      "",
      "══════════════════════════════════════════════════════",
      `  Design review (open once per browser; treat it like a password):`,
      `  ${tunnelUrl}/?key=${key}`,
      "  Switch: bottom bar, or Alt+Shift+←/→, Alt+Shift+1…6, Alt+Shift+L",
      "══════════════════════════════════════════════════════",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  if (!existsSync(path.join(distDir, "index.html"))) {
    throw new Error("No web build. Run: npm run build:web --workspace=@frogg/app");
  }
  if (!existsSync(seededHome)) {
    throw new Error("No seeded preview home. Run `npm run preview` once first.");
  }
  await rm(home, { recursive: true, force: true });
  // Skip the preview daemon's lock, identity and log so this daemon starts as its own host.
  const skip = new Set(["frogg.pid", "server-id", "daemon.log", "runtime"]);
  await cp(seededHome, home, {
    recursive: true,
    filter: (source) => !skip.has(path.relative(seededHome, source)),
  });

  log("starting daemon…");
  const daemon = start("daemon", "npm", ["run", "dev", "--workspace=@frogg/server"], {
    FROGG_HOME: home,
    FROGG_SERVER_ID: "srv_design_review",
    FROGG_LISTEN: `127.0.0.1:${port}`,
    FROGG_HOSTNAMES: ".trycloudflare.com",
    FROGG_WEB_UI_ENABLED: "true",
    FROGG_WEB_UI_DIST_DIR: distDir,
    FROGG_RELAY_ENABLED: "0",
    NODE_ENV: "development",
  });
  daemon.stderr?.pipe(process.stderr);
  const key = await reviewKey();
  startReviewGate({ port: gatePort, daemonPort: port, key });

  // An empty config keeps cloudflared from reading ~/.cloudflared/config.yml, whose ingress
  // rules (for other tunnels on this machine) would otherwise 404 every quick-tunnel request.
  const tunnelConfig = path.join(reviewDir, "cloudflared.yml");
  await writeFile(tunnelConfig, "{}\n");
  log("opening tunnel…");
  const tunnel = start(
    "tunnel",
    "cloudflared",
    [
      "tunnel",
      "--config",
      tunnelConfig,
      "--no-autoupdate",
      "--url",
      `http://127.0.0.1:${gatePort}`,
    ],
    {},
  );
  const tunnelUrl = await new Promise<string>((resolve) => {
    const onOutput = (chunk: Buffer) => {
      const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(chunk.toString())?.[0];
      if (!url) return;
      tunnel.stderr?.off("data", onOutput);
      resolve(url);
    };
    tunnel.stderr?.on("data", onOutput);
  });
  await writeFile(urlFile, `${tunnelUrl}\n`);
  await waitForPort(120_000);
  printAccess(tunnelUrl, key);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

if (process.argv[2] === "pair") {
  if (!existsSync(urlFile)) throw new Error("Design review is not running.");
  console.log(pairingLink(readFileSync(urlFile, "utf8").trim()));
} else {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    shutdown(1);
  });
}
