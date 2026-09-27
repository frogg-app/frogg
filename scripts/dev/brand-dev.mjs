#!/usr/bin/env node
// Runs a dev entrypoint under a brand, without exporting FROGG_BRAND_DIR by hand (works the same
// from bash, zsh and PowerShell). Checks the brand first and says which ports and state to expect.
//
//   npm run brand:dev -- brands/acme                 mock-provider UI preview
//   npm run brand:dev -- brands/acme live            this checkout's daemon, real providers
//   npm run brand:dev -- brands/acme server --dry-run
//
// The branded dev scripts themselves live in package.json; this only selects the brand.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { portableCommand } from "./npm-command.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** mode -> the npm script it runs and what to expect from it. */
export const MODES = {
  preview: {
    script: "preview",
    about: "isolated daemon + web app, mock provider, demo data (.dev/preview/home)",
    ports: () => portsFrom(7800),
  },
  live: {
    script: "dev:live",
    about: "this checkout's daemon + web app, real providers (.dev/live/home)",
    ports: () => portsFrom(7820),
  },
  server: {
    script: "dev:server",
    about: "dev daemon with watch (.dev/<id>-home)",
    ports: (brand) => `daemon ${devDaemonPort(brand)}`,
  },
  app: {
    script: "dev:app",
    about: "Expo dev server pointed at the dev daemon",
    ports: (brand) => `Metro ${devMetroPort(brand)}`,
  },
  check: {
    script: "brand:check",
    about: "validate brand.json and artwork",
    ports: () => null,
  },
};

/** scripts/dev/dev-home.sh: stock Frogg keeps its historical dev ports, a brand uses its own. */
function devDaemonPort(brand) {
  return brand.id === "frogg" ? 6768 : brand.daemonPort;
}

function devMetroPort(brand) {
  if (brand.id === "frogg") return 8081;
  return brand.daemonPort === 65535 ? 65534 : brand.daemonPort + 1;
}

function portsFrom(fallback) {
  const web = Number(process.env.PREVIEW_PORT ?? fallback);
  return `web ${web}, daemon ${web + 1} (PREVIEW_PORT)`;
}

export const USAGE = `usage: npm run brand:dev -- <brand-dir> [mode] [--dry-run] [-- <args for the script>]

Runs a dev entrypoint with FROGG_BRAND_DIR set to <brand-dir>.

Modes:
${Object.entries(MODES)
  .map(([mode, { script, about }]) => `  ${mode.padEnd(8)} npm run ${script.padEnd(12)} ${about}`)
  .join("\n")}

Default mode: preview. A checkout builds one brand at a time; stop other dev servers in it
before switching brands, or use a second worktree.`;

export function parseArgs(argv) {
  const passthroughAt = argv.indexOf("--");
  const own = passthroughAt === -1 ? argv : argv.slice(0, passthroughAt);
  const passthrough = passthroughAt === -1 ? [] : argv.slice(passthroughAt + 1);
  const options = { brand: undefined, mode: "preview", dryRun: false, help: false, passthrough };
  const positionals = [];
  for (const arg of own) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg.startsWith("-")) throw new Error(`Unknown option ${arg}. Run with --help.`);
    else positionals.push(arg);
  }
  if (positionals.length > 2) throw new Error(`Unexpected argument ${positionals[2]}`);
  [options.brand, options.mode = "preview"] = positionals;
  if (!options.help && !options.brand) throw new Error("Name a brand directory. Run with --help.");
  if (!MODES[options.mode]) {
    throw new Error(`Unknown mode ${options.mode}; expected ${Object.keys(MODES).join(", ")}`);
  }
  return options;
}

/** The npm invocation for a mode; brand:check takes the brand as a flag, the rest from env. */
export function commandFor(options, brandDir) {
  const { script } = MODES[options.mode];
  const extra = options.mode === "check" ? ["--brand", brandDir] : [];
  const args = ["run", script];
  if (extra.length || options.passthrough.length) args.push("--", ...extra, ...options.passthrough);
  return { command: "npm", args, env: { FROGG_BRAND_DIR: brandDir } };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return void process.stdout.write(`${USAGE}\n`);
  const brandDir = path.resolve(root, options.brand);
  const manifestPath = path.join(brandDir, "brand.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `No brand.json in ${brandDir}. Scaffold one with: npm run brand:init -- --dir ${options.brand} ...`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const invocation = commandFor(options, path.relative(root, brandDir) || ".");
  const ports = MODES[options.mode].ports(manifest);
  process.stdout.write(
    `[brand:dev] ${manifest.name ?? manifest.id} (${path.relative(root, brandDir)}), ${options.mode}: ${MODES[options.mode].about}\n` +
      (ports ? `[brand:dev] ports: ${ports}\n` : "") +
      `[brand:dev] FROGG_BRAND_DIR=${invocation.env.FROGG_BRAND_DIR} ${invocation.command} ${invocation.args.join(" ")}\n`,
  );
  if (options.dryRun) return;
  if (options.mode !== "check") {
    // Fail on a bad manifest now, not after the dev server has spent its start-up.
    const check = portableCommand("npm", [
      "run",
      "--silent",
      "brand:check",
      "--",
      "--brand",
      brandDir,
    ]);
    const checked = spawnSync(check.command, check.args, { cwd: root, stdio: "inherit" });
    if (checked.status !== 0) throw new Error("brand:check failed; fix the brand first.");
  }
  const npm = portableCommand(invocation.command, invocation.args);
  const child = spawn(npm.command, npm.args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...invocation.env },
  });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
