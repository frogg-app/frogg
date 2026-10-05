import type pino from "pino";
import { HostMetricsSampler } from "./host-metrics.js";
import { OwnedStorageService, type OwnedStorageOptions } from "./owned-storage.js";
import { WorktreeInventory, type WorktreeInventoryOptions } from "./worktree-inventory.js";
import type { StorageAlertMonitor } from "./storage-alerts.js";

/** One per daemon: metrics windows and storage-size caches are shared by every client. */
export interface HostResources {
  metrics: HostMetricsSampler;
  storage: OwnedStorageService;
  worktrees: WorktreeInventory;
  /**
   * Growing-storage alerts. Assigned once the WebSocket server exists to
   * broadcast a level change; absent on a daemon without that wiring.
   */
  storageAlerts?: StorageAlertMonitor;
}

export function createHostResources(
  options: Omit<OwnedStorageOptions, "logger" | "worktreeInventory"> & {
    logger: pino.Logger;
    worktrees: Omit<WorktreeInventoryOptions, "logger">;
  },
): HostResources {
  const worktrees = new WorktreeInventory({
    ...options.worktrees,
    logger: options.logger.child({ module: "worktree-inventory" }),
  });
  return {
    metrics: new HostMetricsSampler({ diskPath: options.froggHome }),
    worktrees,
    storage: new OwnedStorageService({
      ...options,
      worktreeInventory: worktrees,
      logger: options.logger.child({ module: "owned-storage" }),
    }),
  };
}
