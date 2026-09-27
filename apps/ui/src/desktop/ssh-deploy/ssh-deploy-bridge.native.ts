import { requireOptionalNativeModule } from "expo-modules-core";
import { brand } from "@frogg/branding";
import { installers } from "@frogg/branding/installers";
import { DeployManager, type DeployEvent } from "@frogg/protocol/ssh-deploy/manager";
import { buildProbeScript } from "@frogg/protocol/ssh-deploy/probe";
import { cliPairCodeAdapter } from "@frogg/protocol/ssh-deploy/pair-code";
import { cliHardenAdapter } from "@frogg/protocol/ssh-deploy/harden";
import { selectDeployScript } from "@frogg/protocol/ssh-deploy/scripts";
import { resolveAppVersion } from "@/utils/app-version";
import { createNativeExecuteScript, type FroggSshModule } from "./native-ssh-executor";

export const SSH_DEPLOY_EVENT = "ssh-deploy-event";

const sshModule = requireOptionalNativeModule<FroggSshModule>("FroggSsh");
const listeners = new Set<(raw: unknown) => void>();
let manager: DeployManager | null = null;

function getManager(module: FroggSshModule): DeployManager {
  manager ??= new DeployManager({
    execute: createNativeExecuteScript(module),
    brand: {
      envPrefix: brand.envPrefix,
      daemonPort: brand.daemonPort,
      releaseBase: brand.distribution.releaseBase,
    },
    defaultVersion: resolveAppVersion() ?? "",
    probeScript: buildProbeScript(brand),
    script: (method, uninstall) => selectDeployScript(installers, method, uninstall),
    pairCode: {
      script: cliPairCodeAdapter.script(brand),
      parse: cliPairCodeAdapter.parse,
    },
    harden: {
      script: cliHardenAdapter.script(brand),
      parse: cliHardenAdapter.parse,
    },
    emit(event: DeployEvent) {
      for (const listener of listeners) listener(event);
    },
  });
  return manager;
}

/** The app's own SSH client (Android) runs the deploy engine in-process. */
export function isSshDeployAvailable(): boolean {
  return sshModule !== null;
}

/**
 * True when the deploy runs over the app's own SSH client: no SSH config, agent
 * or key files to read, and no tunnel, since the app cannot hold a Remote SSH
 * connection open. The form then asks for credentials and pairs over the LAN.
 */
export function isSshDeployInApp(): boolean {
  return true;
}

export async function invokeSshDeploy<T>(
  command: string,
  args: Record<string, unknown>,
): Promise<T> {
  if (!sshModule) throw new Error("SSH is unavailable in this build.");
  const current = getManager(sshModule);
  switch (command) {
    case "ssh_deploy_probe":
      return (await current.probe(args)) as T;
    case "ssh_deploy_pair_code":
      return (await current.pairCode(args)) as T;
    case "ssh_deploy_harden":
      return (await current.harden(args)) as T;
    case "ssh_deploy_start":
      return current.start(args) as T;
    case "ssh_deploy_uninstall":
      return current.uninstall(args) as T;
    case "ssh_deploy_cancel":
      return current.cancel(args) as T;
    default:
      throw new Error(`${command} is unavailable in the mobile app.`);
  }
}

export async function listenToSshDeploy(handler: (raw: unknown) => void): Promise<() => void> {
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
  };
}
