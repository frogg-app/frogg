/**
 * Reads and writes the `providerUpdates` block of the daemon config.
 *
 * These preferences live in the persisted config rather than the mutable daemon
 * config because they are plain user settings with no launch-override story:
 * nothing about them can be pinned by an environment variable or CLI flag.
 */

import {
  loadPersistedConfig,
  savePersistedConfig,
  type ProviderUpdatesConfig,
} from "../../server/persisted-config.js";

export interface ResolvedProviderUpdatePreferences {
  checkEnabled: boolean;
  autoUpdate: boolean;
  checkIntervalMinutes: number;
  ignoredProviders: string[];
}

export const DEFAULT_PROVIDER_UPDATE_PREFERENCES: ResolvedProviderUpdatePreferences = {
  checkEnabled: true,
  autoUpdate: false,
  checkIntervalMinutes: 12 * 60,
  ignoredProviders: [],
};

export function resolveProviderUpdatePreferences(
  config: ProviderUpdatesConfig | undefined,
): ResolvedProviderUpdatePreferences {
  return {
    checkEnabled: config?.checkEnabled ?? DEFAULT_PROVIDER_UPDATE_PREFERENCES.checkEnabled,
    autoUpdate: config?.autoUpdate ?? DEFAULT_PROVIDER_UPDATE_PREFERENCES.autoUpdate,
    checkIntervalMinutes:
      config?.checkIntervalMinutes ?? DEFAULT_PROVIDER_UPDATE_PREFERENCES.checkIntervalMinutes,
    ignoredProviders: config?.ignoredProviders ?? [],
  };
}

export class ProviderUpdatePreferencesStore {
  constructor(private readonly froggHome: string) {}

  read(): ProviderUpdatesConfig | undefined {
    return loadPersistedConfig(this.froggHome).providerUpdates;
  }

  resolved(): ResolvedProviderUpdatePreferences {
    return resolveProviderUpdatePreferences(this.read());
  }

  /** Merge a partial update in; absent keys keep their stored value. */
  write(patch: ProviderUpdatesConfig): ResolvedProviderUpdatePreferences {
    const config = loadPersistedConfig(this.froggHome);
    const next: ProviderUpdatesConfig = { ...config.providerUpdates, ...patch };
    savePersistedConfig(this.froggHome, { ...config, providerUpdates: next });
    return resolveProviderUpdatePreferences(next);
  }
}
