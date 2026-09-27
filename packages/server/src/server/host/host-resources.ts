import type pino from "pino";
import { HostMetricsSampler } from "./host-metrics.js";
import { OwnedStorageService, type OwnedStorageOptions } from "./owned-storage.js";

/** One per daemon: metrics windows and storage-size caches are shared by every client. */
export interface HostResources {
  metrics: HostMetricsSampler;
  storage: OwnedStorageService;
}

export function createHostResources(
  options: Omit<OwnedStorageOptions, "logger"> & { logger: pino.Logger },
): HostResources {
  return {
    metrics: new HostMetricsSampler({ diskPath: options.froggHome }),
    storage: new OwnedStorageService({
      ...options,
      logger: options.logger.child({ module: "owned-storage" }),
    }),
  };
}
