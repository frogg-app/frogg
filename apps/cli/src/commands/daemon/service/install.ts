import { brandEnv } from "@frogg/branding/identity";
import { brand } from "@frogg/branding";
import { loadConfig, resolveFroggHome } from "@frogg/server";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_SERVICE_LISTEN,
  resolveServicePlan,
  type ServiceCommand,
  type ServicePlanInput,
  type ServicePlatform,
} from "./plan.js";

/**
 * Installs and removes the "start Frogg when I log in" service: a systemd user
 * unit, a launchd agent, or a Windows logon task (see plan.ts). Every step is
 * idempotent — installing twice rewrites the same unit and restarts the
 * service; uninstalling something that is not there is not an error.
 */
export interface ServiceActionOptions {
  listen?: string;
  home?: string;
  platform?: ServicePlatform;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Runs one plan command; returns a failure description or null. Tests stub this. */
  run?: (command: ServiceCommand) => string | null;
}

export interface ServiceActionResult {
  /** `failed`: a required step did not succeed, so nothing will start at login. */
  action: "installed" | "failed" | "uninstalled" | "not_installed";
  platform: ServicePlatform;
  label: string;
  /** The unit, plist or Windows launcher script. */
  file: string | null;
  listen: string;
  home: string | null;
  command: string;
  /** Commands that failed; the service may still need manual attention. */
  warnings: string[];
  hints: string[];
  message: string;
}

/** How to launch the CLI again from a service manager, with no shell in between. */
export function resolveCliCommand(env: NodeJS.ProcessEnv = process.env): ServiceCommand {
  const launcher = brandEnv(brand, env, "CLI");
  if (launcher && existsSync(launcher)) {
    return { program: launcher, args: [] };
  }

  const entry = process.argv[1];
  if (entry) {
    // A bundle install keeps a rolling `current/bin/frogg` symlink; prefer it so
    // the service survives an upgrade to a new version directory.
    const versionsIndex = entry.split(path.sep).indexOf("versions");
    if (versionsIndex > 0) {
      const root = entry.split(path.sep).slice(0, versionsIndex).join(path.sep);
      const rolling = path.join(
        root,
        "current",
        "bin",
        process.platform === "win32" ? `${brand.cliName}.cmd` : brand.cliName,
      );
      if (existsSync(rolling)) return { program: rolling, args: [] };
    }
    return { program: process.execPath, args: [path.resolve(entry)] };
  }
  return { program: process.execPath, args: [] };
}

function buildPlanInput(
  options: ServiceActionOptions,
  action: "install" | "uninstall",
): ServicePlanInput {
  const platform = options.platform ?? (process.platform as ServicePlatform);
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const configuredHome =
    options.home ?? brandEnv(brand, env, "HOME") ?? path.join(homeDir, brand.homeDir);
  const froggHome = resolveFroggHome({ ...env, [`${brand.envPrefix}_HOME`]: configuredHome });
  const explicitListen = options.listen?.trim() || env.FROGG_LISTEN?.trim() || undefined;
  const configControlsListen = action === "install" && explicitListen === undefined;
  const configuredListen = configControlsListen
    ? loadConfig(froggHome, { env: { ...env, FROGG_LISTEN: undefined } }).listen
    : DEFAULT_SERVICE_LISTEN;
  const listen = explicitListen ?? configuredListen;
  const persistListen = explicitListen !== undefined;
  const cli = resolveCliCommand(env);
  // Windows has no service manager to keep a foreground process: the login
  // launcher starts a detached daemon and exits, so no console stays open.
  const args = [...cli.args, "daemon", "start"];
  if (platform !== "win32") args.push("--foreground");
  // The Windows launcher carries no environment block, so the settings ride on argv.
  if (platform === "win32") {
    if (persistListen) args.push("--listen", listen);
    args.push("--home", froggHome);
  }

  return {
    platform,
    homeDir,
    env,
    command: { program: cli.program, args },
    listen,
    persistListen,
    froggHome,
    pathPrepend: path.dirname(cli.program),
  };
}

function runCommand(command: ServiceCommand): string | null {
  const result = spawnSync(command.program, command.args, {
    stdio: "ignore",
    windowsHide: true,
    windowsVerbatimArguments: command.verbatim === true,
  });
  if (result.error) return `${command.program}: ${result.error.message}`;
  if (result.status !== 0) {
    return `${[command.program, ...command.args].join(" ")} exited with ${result.status ?? "a signal"}`;
  }
  return null;
}

function describeCommand(input: ServicePlanInput): string {
  return [input.command.program, ...input.command.args].join(" ");
}

export function installLoginService(options: ServiceActionOptions = {}): ServiceActionResult {
  const input = buildPlanInput(options, "install");
  const plan = resolveServicePlan(input);
  const run = options.run ?? runCommand;
  const warnings: string[] = [];
  let failure: string | null = null;

  if (plan.file) {
    mkdirSync(path.dirname(plan.file.path), { recursive: true });
    writeFileSync(plan.file.path, plan.file.contents);
  }
  for (const command of plan.install) {
    const error = run(command);
    if (!error || command.optional) continue;
    // A later step depends on this one, so stop rather than report half an install.
    failure = error;
    break;
  }
  if (failure) warnings.push(failure);

  return {
    action: failure ? "failed" : "installed",
    platform: plan.platform,
    label: plan.label,
    file: plan.file?.path ?? null,
    listen: input.listen,
    home: input.froggHome ?? null,
    command: describeCommand(input),
    warnings,
    hints: failure ? [] : plan.hints,
    message: failure
      ? `Could not set up ${plan.label} to start ${brand.name} when you log in: ${failure}`
      : `${brand.name} will start when you log in (${plan.label}).`,
  };
}

export function uninstallLoginService(options: ServiceActionOptions = {}): ServiceActionResult {
  const input = buildPlanInput(options, "uninstall");
  const plan = resolveServicePlan(input);
  const run = options.run ?? runCommand;
  let existed = plan.file ? existsSync(plan.file.path) : true;

  for (const command of plan.uninstall) {
    // On Windows a Run value or legacy task without a launcher still counts.
    if (run(command) === null && plan.platform === "win32") existed = true;
  }
  if (plan.file && existed) rmSync(plan.file.path, { force: true });

  return {
    action: existed ? "uninstalled" : "not_installed",
    platform: plan.platform,
    label: plan.label,
    file: plan.file?.path ?? null,
    listen: input.listen,
    home: input.froggHome ?? null,
    command: describeCommand(input),
    warnings: [],
    hints: [],
    message: existed
      ? `${brand.name} will no longer start when you log in (${plan.label} removed).`
      : `Nothing to remove: no ${plan.label} login service is installed.`,
  };
}
