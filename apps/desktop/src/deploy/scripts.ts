import { installers } from "@frogg/branding/installers";
import type { DeployMethod } from "@frogg/protocol/ssh-deploy/args";
import { selectDeployScript } from "@frogg/protocol/ssh-deploy/scripts";
export function deployScript(method: DeployMethod, uninstall = false): string {
  return selectDeployScript(installers, method, uninstall);
}
