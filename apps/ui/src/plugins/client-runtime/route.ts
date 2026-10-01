import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { i18n } from "@/localisation/i18next";
import { clientPluginHandles, invokeClientPlugin } from "./runtime-store";

/**
 * The one place a contribution (command, session action, panel render/submit, panel item)
 * is invoked. A method this device's client half registered with ctx.rpc.handle runs in its
 * sandbox; everything else goes to the host's plugins.rpc.call as before.
 */
export async function callPluginMethod(
  client: DaemonClient | null,
  input: { pluginId: string; method: string; params: unknown },
): Promise<{ result?: unknown }> {
  if (clientPluginHandles(input.pluginId, input.method)) {
    return { result: await invokeClientPlugin(input.pluginId, input.method, input.params) };
  }
  if (!client) throw new Error(i18n.t("common.errors.daemonClientUnavailable"));
  return client.pluginsRpcCall(input);
}
