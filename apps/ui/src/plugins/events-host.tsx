import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { ToastVariant } from "@/components/toast-host";
import { usePluginHostIds } from "./hosts";
import { pluginsQueryKeys } from "./query-keys";

const NOTIFY_VARIANTS: ReadonlySet<string> = new Set(["info", "success", "warning", "error"]);

function toToastVariant(level: string): ToastVariant {
  return NOTIFY_VARIANTS.has(level) ? (level as ToastVariant) : "info";
}

/** One host's plugin push events: `plugins.changed` refetches, `plugins.notify` toasts. */
function PluginHostEvents({ serverId }: { serverId: string }) {
  const client = useHostRuntimeClient(serverId);
  const queryClient = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    if (!client) return;
    const offChanged = client.onPluginsChanged(() => {
      void queryClient.invalidateQueries({ queryKey: pluginsQueryKeys.host(serverId) });
    });
    const offNotify = client.onPluginsNotify((event) => {
      const variant = toToastVariant(event.level);
      toast.show(event.message, {
        variant,
        durationMs: variant === "error" || variant === "warning" ? 6000 : undefined,
        testID: "plugin-notify-toast",
      });
    });
    return () => {
      offChanged();
      offNotify();
    };
  }, [client, queryClient, serverId, toast]);

  return null;
}

/** Mounted once at the app root; subscribes to every plugin-capable host. */
export function PluginEventsHost() {
  const serverIds = usePluginHostIds();
  return (
    <>
      {serverIds.map((serverId) => (
        <PluginHostEvents key={serverId} serverId={serverId} />
      ))}
    </>
  );
}
