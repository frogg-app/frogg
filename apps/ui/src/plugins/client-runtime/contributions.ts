import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import type { PluginContributionSet } from "@frogg/client/internal/daemon-client";
import type { ClientPluginRecord } from "./records";
import { useClientPluginsStore } from "./runtime-store";

/**
 * Declarative contributions of client-scope plugins running on this device, in the same shape
 * hosts return from plugins.get_contributions. Hybrid plugins are left out: their contributions
 * already come from the host that runs the daemon half.
 */
export function clientContributionSets(
  records: readonly ClientPluginRecord[],
  activeIds: ReadonlySet<string>,
): PluginContributionSet[] {
  return records
    .filter((r) => r.manifest.scope === "client" && activeIds.has(r.id))
    .map((r) => ({
      pluginId: r.id,
      pluginName: r.manifest.name,
      dev: r.source === "dev",
      commands: r.manifest.contributes?.commands ?? [],
      sessionActions: r.manifest.contributes?.sessionActions ?? [],
      panels: r.manifest.contributes?.panels ?? [],
      views: r.manifest.contributes?.views ?? [],
      composerActions: r.manifest.contributes?.composerActions ?? [],
      settings: r.manifest.contributes?.settings ?? [],
      badges: {},
    }));
}

export function useClientContributionSets(): PluginContributionSet[] {
  const records = useClientPluginsStore((s) => s.records);
  const activeKey = useClientPluginsStore(
    useShallow((s) =>
      Object.entries(s.status)
        .filter(([, status]) => status.state === "active")
        .map(([id]) => id)
        .sort(),
    ),
  );
  return useMemo(() => clientContributionSets(records, new Set(activeKey)), [activeKey, records]);
}
