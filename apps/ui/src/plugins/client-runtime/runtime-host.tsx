import { useEffect, useRef } from "react";
import { PluginRequestError } from "@frogg/client/internal/daemon-client";
import type { ToastVariant } from "@/components/toast-host";
import { useToast } from "@/contexts/toast-context";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { isPluginsEnabledByBrand, usePluginHostIds } from "../hosts";
import { ClientPluginError } from "./errors";
import { loadClientPlugins, setClientPluginRuntimeDeps } from "./runtime-store";
import { isClientPluginRuntimeSupported } from "./storage";

const SKIP_CODES: ReadonlySet<string> = new Set(["not_found", "not_active", "forbidden"]);

/**
 * Mounted once at the app root on desktop and web: loads this device's client plugins, starts
 * their sandboxes, and gives them toasts and a path to their daemon half on a connected host.
 */
export function ClientPluginRuntimeHost() {
  const toast = useToast();
  const hostIds = usePluginHostIds();
  const hostIdsRef = useRef(hostIds);
  hostIdsRef.current = hostIds;

  useEffect(() => {
    setClientPluginRuntimeDeps({
      notify: (_pluginId, message, level) => {
        const variant: ToastVariant = level;
        toast.show(message, {
          variant,
          durationMs: level === "error" || level === "warning" ? 6000 : undefined,
          testID: "plugin-notify-toast",
        });
      },
      rpcCall: async (pluginId, method, params) => {
        // The daemon half lives on whichever connected host has the hybrid plugin active.
        for (const serverId of hostIdsRef.current) {
          const client = getHostRuntimeStore().getClient(serverId);
          if (!client) continue;
          try {
            return (await client.pluginsRpcCall({ pluginId, method, params })).result ?? null;
          } catch (error) {
            if (error instanceof PluginRequestError && SKIP_CODES.has(error.code)) continue;
            throw error;
          }
        }
        throw new ClientPluginError(
          "not_active",
          `No connected host is running the daemon half of ${pluginId}`,
        );
      },
    });
  }, [toast]);

  useEffect(() => {
    if (!isClientPluginRuntimeSupported() || !isPluginsEnabledByBrand()) return;
    void loadClientPlugins();
  }, []);

  return null;
}
