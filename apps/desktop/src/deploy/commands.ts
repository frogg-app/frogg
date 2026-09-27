import { randomUUID } from "node:crypto";
import { app, BrowserWindow } from "electron";
import { brand } from "@frogg/branding";
import { createSshPasswordEnvironment } from "../daemon/ssh-password.js";
import type { DesktopCommandHandler } from "../settings/desktop-settings-commands.js";
import { createScriptExecutor } from "./executor.js";
import { DeployManager } from "@frogg/protocol/ssh-deploy/manager";
import { buildProbeScript } from "@frogg/protocol/ssh-deploy/probe";
import { cliPairCodeAdapter } from "@frogg/protocol/ssh-deploy/pair-code";
import { cliHardenAdapter } from "@frogg/protocol/ssh-deploy/harden";
import { deployScript } from "./scripts.js";
import { SshForwardManager } from "./forward.js";

export const DEPLOY_EVENT = "frogg:event:ssh-deploy-event";
let manager: DeployManager | undefined;
export function createSshDeployCommandHandlers(): Record<string, DesktopCommandHandler> {
  if (!manager) {
    manager = new DeployManager({
      execute: createScriptExecutor({
        passwordEnvironment: createSshPasswordEnvironment,
      }),
      brand: {
        envPrefix: brand.envPrefix,
        daemonPort: brand.daemonPort,
        releaseBase: brand.distribution.releaseBase,
      },
      defaultVersion: app.getVersion(),
      probeScript: buildProbeScript(brand),
      script: deployScript,
      pairCode: {
        script: cliPairCodeAdapter.script(brand),
        parse: cliPairCodeAdapter.parse,
      },
      harden: {
        script: cliHardenAdapter.script(brand),
        parse: cliHardenAdapter.parse,
      },
      forwards: new SshForwardManager({
        passwordEnvironment: createSshPasswordEnvironment,
      }),
      createJobId: () => `deploy-${randomUUID()}`,
      emit(event) {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed() && !window.webContents.isDestroyed())
            window.webContents.send(DEPLOY_EVENT, event);
        }
      },
    });
    app.on("before-quit", () => manager?.cancelAll());
  }
  const current = manager;
  return {
    ssh_deploy_probe: (args) => current.probe(args),
    ssh_deploy_pair_code: (args) => current.pairCode(args),
    ssh_deploy_harden: (args) => current.harden(args),
    ssh_deploy_open_forward: (args) => current.openForward(args),
    ssh_deploy_close_forward: (args) => current.closeForward(args),
    ssh_deploy_start: (args) => current.start(args),
    ssh_deploy_uninstall: (args) => current.uninstall(args),
    ssh_deploy_cancel: (args) => current.cancel(args),
  };
}
