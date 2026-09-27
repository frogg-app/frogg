import type { DeployMethod } from "./args.js";

/** The branded installer (or uninstaller) for a deploy method, from `@frogg/branding/installers`. */
export function selectDeployScript(
  installers: Readonly<Record<string, string>>,
  method: DeployMethod,
  uninstall = false,
): string {
  const name = `/${uninstall ? "uninstall" : "install"}${method === "docker" ? "-docker" : ""}.sh`;
  const script = installers[name];
  if (!script?.startsWith("#!/usr/bin/env bash\n"))
    throw new Error(`Missing branded deployment script: ${name}`);
  return script;
}
