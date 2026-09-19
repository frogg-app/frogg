import type { Logger } from "pino";

import {
  ProviderSnapshotManager,
  type ProviderSnapshotManagerOptions,
} from "./provider-snapshot-manager.js";
import { OpenCodeBridge } from "./providers/opencode/bridge.js";
import type { FroggToolCatalog } from "./tools/types.js";
import { ProviderAccountStore } from "../provider-accounts/provider-account-store.js";
import {
  resolveAgentProviderAccountEnv,
  resolveProviderAccountEnv,
} from "../provider-accounts/provider-account-env.js";

export interface AgentProviderRuntime {
  snapshotManager: ProviderSnapshotManager;
  setFroggToolCatalog(catalog: FroggToolCatalog | null): void;
  shutdown(): Promise<void>;
}

interface CreateAgentProviderRuntimeOptions {
  froggHome: string;
  logger: Logger;
  snapshotManager: Omit<ProviderSnapshotManagerOptions, "logger" | "openCodeBridge">;
}

export async function createAgentProviderRuntime(
  options: CreateAgentProviderRuntimeOptions,
): Promise<AgentProviderRuntime> {
  const bridge = new OpenCodeBridge({ froggHome: options.froggHome, logger: options.logger });
  const providerAccountStore = new ProviderAccountStore({ froggHome: options.froggHome });
  try {
    await bridge.start();
    const snapshotManager = new ProviderSnapshotManager({
      ...options.snapshotManager,
      logger: options.logger.child({ module: "provider-snapshot-manager" }),
      openCodeBridge: bridge,
      providerAccountEnv: (providerId) => {
        try {
          return resolveProviderAccountEnv(providerAccountStore, providerId);
        } catch (error) {
          options.logger.warn(
            { err: error, providerId },
            "Failed to resolve provider account env overlay",
          );
          return undefined;
        }
      },
      providerAccountEnvForAgent: (providerId, accountId) => {
        try {
          return resolveAgentProviderAccountEnv(providerAccountStore, providerId, accountId);
        } catch (error) {
          options.logger.warn(
            { err: error, providerId, accountId },
            "Failed to resolve per-agent provider account env overlay",
          );
          return { env: {} };
        }
      },
      // COMPAT(providerAccountAllowedModels): added in v1.4.2, remove after 2027-09-17.
      // A failure to read the restriction must not block a launch, so it degrades
      // to "unrestricted" and is logged.
      providerAccountAllowedModels: (providerId, accountId) => {
        try {
          return providerAccountStore.allowedModelsFor(providerId, accountId);
        } catch (error) {
          options.logger.warn(
            { err: error, providerId, accountId },
            "Failed to resolve provider account model restrictions",
          );
          return undefined;
        }
      },
      // COMPAT(providerAccountPreferences): added in v1.5.6, remove after 2027-09-19.
      providerAccountSystemPrompt: (providerId, accountId) => {
        try {
          return providerAccountStore.systemPromptFor(providerId, accountId);
        } catch (error) {
          options.logger.warn(
            { err: error, providerId, accountId },
            "Failed to resolve provider account system prompt",
          );
          return undefined;
        }
      },
    });
    let shutdownPromise: Promise<void> | null = null;
    return {
      snapshotManager,
      setFroggToolCatalog: (catalog) => bridge.setManifestCatalog(catalog),
      shutdown: () => {
        shutdownPromise ??= shutdownProviderRuntime(snapshotManager, bridge);
        return shutdownPromise;
      },
    };
  } catch (error) {
    await bridge.close().catch(() => undefined);
    throw error;
  }
}

async function shutdownProviderRuntime(
  snapshotManager: ProviderSnapshotManager,
  bridge: OpenCodeBridge,
): Promise<void> {
  try {
    await snapshotManager.shutdown();
  } finally {
    await bridge.close();
  }
}
