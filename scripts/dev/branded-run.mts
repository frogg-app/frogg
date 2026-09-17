import { portableCommand } from "./npm-command.mjs";
/** Keeps one brand active for the lifetime of a build or dev server. */
import { spawn } from "node:child_process";
import { prepareBrand } from "./branding/prepare.mjs";
import { resolveBrand } from "./branding/resolve.mjs";
import { acquireLock } from "./branding/locks.mjs";

const args = process.argv.slice(2);
const target = args.shift();
if (!target) throw new Error("Usage: branded-run.mts -- <command> <args...>");
const build = resolveBrand();
const release = await acquireLock("build", build);
try {
  process.env.FROGG_BRAND_BUILD_OWNER ||= String(process.pid);
  process.env.FROGG_BRAND_DIR = build.selected;
  await prepareBrand(build.selected);
  const command = target === "--" ? args.shift()! : target;
  if (!command) throw new Error("Missing build command");
  const invocation = portableCommand(command, args);
  const child = spawn(invocation.command, invocation.args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
    shell: false,
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
  process.exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await release();
}
