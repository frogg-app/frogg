import { listenToDesktopEvent, type DesktopEventUnlisten } from "@/desktop/electron/events";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import { isElectronRuntime } from "@/desktop/host";

/** Desktop bridge event name (`frogg:event:` is added by the shell). */
export const SSH_DEPLOY_EVENT = "ssh-deploy-event";

/**
 * Where the deploy engine runs. Here, the desktop shell's main process, which
 * spawns `ssh`; the `.native` variant runs it in the app over its own SSH
 * client. Commands and events are the same either way.
 */
export function isSshDeployAvailable(): boolean {
  return isElectronRuntime();
}

/**
 * True when the deploy runs over the app's own SSH client: no SSH config, agent
 * or key files to read, and no tunnel, since the app cannot hold a Remote SSH
 * connection open. The form then asks for credentials and pairs over the LAN.
 */
export function isSshDeployInApp(): boolean {
  return false;
}

export function invokeSshDeploy<T>(command: string, args: Record<string, unknown>): Promise<T> {
  return invokeDesktopCommand<T>(command, args);
}

export function listenToSshDeploy(handler: (raw: unknown) => void): Promise<DesktopEventUnlisten> {
  return listenToDesktopEvent<unknown>(SSH_DEPLOY_EVENT, handler);
}
