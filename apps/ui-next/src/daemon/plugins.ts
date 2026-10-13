import { useEffect } from "react";
import { create } from "zustand";
import { getClient, onHostSwitch, useDaemon } from "./store";

/** The plugin that switches the host's built-in Companion on (daemon: `contributes.features`). */
export const COMPANION_PLUGIN_ID = "frogg.companion";

interface PluginGate {
  /** Whether the connected host has the Companion plugin installed and enabled. */
  companion: boolean;
}

export const usePluginGate = create<PluginGate>(() => ({ companion: false }));
onHostSwitch(() => usePluginGate.setState({ companion: false }));

const isCompanion = (id: string) => id === COMPANION_PLUGIN_ID || id.endsWith(".companion");

/** Re-reads the installed plugins. Hosts without plugin support never show the Companion. */
export async function refreshPluginGate(): Promise<void> {
  const c = getClient();
  if (!c?.supportsPlugins()) {
    usePluginGate.setState({ companion: false });
    return;
  }
  try {
    const { plugins } = await c.pluginsList();
    usePluginGate.setState({ companion: plugins.some((p) => isCompanion(p.id) && p.enabled) });
  } catch {
    usePluginGate.setState({ companion: false });
  }
}

/** Keeps the gate current while mounted: on connect and on every `plugins.changed`. */
export function useWatchPluginGate(): void {
  const conn = useDaemon((s) => s.conn);
  useEffect(() => {
    const c = getClient();
    if (conn !== "online" || !c) return;
    void refreshPluginGate();
    return c.subscribeRawMessages((m) => {
      if (m.type === "plugins.changed") void refreshPluginGate();
    });
  }, [conn]);
}
