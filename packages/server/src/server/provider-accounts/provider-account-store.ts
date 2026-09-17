import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  findProviderAccountCapability,
  isProviderAccountCapabilityUnverified,
  PROVIDER_ACCOUNT_CAPABILITIES,
  toProviderAccountSlug,
  type ProviderAccount,
  type ProviderAccountCapability,
  type ProviderAccountState,
} from "@frogg/protocol/provider-accounts";

import {
  loadPersistedConfig,
  savePersistedConfig,
  type PersistedConfig,
} from "../persisted-config.js";
import { provisionProviderAccount } from "./provider-account-provisioner.js";

export class ProviderAccountError extends Error {}

export interface ProviderAccountStoreOptions {
  froggHome: string;
  /** Overridable for tests; defaults to the daemon user's home directory. */
  homeDir?: string;
}

export interface CreateProviderAccountInput {
  provider: string;
  name: string;
  linkedFolders?: readonly string[];
}

export interface ProviderAccountMutationResult {
  accounts: ProviderAccountState[];
  capabilities: ProviderAccountCapability[];
  activeAccountIds: Record<string, string>;
  warnings: string[];
}

interface ProviderAccountsConfigEntry {
  enabled?: boolean;
  activeAccountId?: string | null;
  accounts?: ProviderAccount[];
}

type ProviderAccountsConfig = Record<string, ProviderAccountsConfigEntry>;

/**
 * Owns the persisted multi-sign-in state. Every mutation re-reads `config.json`,
 * applies the change and writes it back through the normal persisted-config save
 * path, so a concurrent daemon-config edit is not clobbered by stale state.
 */
export class ProviderAccountStore {
  private readonly froggHome: string;
  private readonly homeDir: string;

  constructor(options: ProviderAccountStoreOptions) {
    this.froggHome = options.froggHome;
    this.homeDir = options.homeDir ?? os.homedir();
  }

  /** The capability manifest with `enabled` overridden from `config.json`. */
  listCapabilities(): ProviderAccountCapability[] {
    const configured = this.readConfig();
    const capabilities: ProviderAccountCapability[] = [];
    for (const capability of PROVIDER_ACCOUNT_CAPABILITIES) {
      const override = configured[capability.provider]?.enabled;
      capabilities.push(override === undefined ? capability : { ...capability, enabled: override });
    }
    return capabilities;
  }

  getCapability(provider: string): ProviderAccountCapability | undefined {
    return this.listCapabilities().find((capability) => capability.provider === provider);
  }

  list(provider?: string): ProviderAccountState[] {
    const configured = this.readConfig();
    const capabilities = this.listCapabilities();
    const states: ProviderAccountState[] = [];

    for (const [providerId, entry] of Object.entries(configured)) {
      if (provider !== undefined && providerId !== provider) continue;
      const capability = capabilities.find((item) => item.provider === providerId);
      for (const account of entry.accounts ?? []) {
        states.push({
          ...account,
          authenticated: isAccountAuthenticated(account, capability),
          isActive: entry.activeAccountId === account.id,
        });
      }
    }

    return states.sort(
      (a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name),
    );
  }

  activeAccountIds(): Record<string, string> {
    const configured = this.readConfig();
    const active: Record<string, string> = {};
    for (const [providerId, entry] of Object.entries(configured)) {
      const accountId = entry.activeAccountId;
      if (!accountId) continue;
      if ((entry.accounts ?? []).some((account) => account.id === accountId)) {
        active[providerId] = accountId;
      }
    }
    return active;
  }

  /** The stored account, regardless of provider. */
  findAccount(accountId: string): ProviderAccount | undefined {
    for (const entry of Object.values(this.readConfig())) {
      const match = (entry.accounts ?? []).find((account) => account.id === accountId);
      if (match) return match;
    }
    return undefined;
  }

  /**
   * The provider's primary (default) config directory — the one a user gets with
   * no accounts configured, e.g. `~/.claude`. Returns undefined for providers
   * with no accounts capability.
   */
  primaryConfigDir(provider: string): string | undefined {
    const capability = this.getCapability(provider);
    return capability ? path.join(this.homeDir, capability.primaryDirName) : undefined;
  }

  create(input: CreateProviderAccountInput): ProviderAccountMutationResult {
    const capability = this.requireEnabledCapability(input.provider);
    const slug = toProviderAccountSlug(input.name);
    if (!slug) {
      throw new ProviderAccountError(
        `Account name "${input.name}" is not a valid slug. Use lowercase letters, digits and single hyphens.`,
      );
    }

    const config = this.readConfig();
    const entry = config[input.provider] ?? {};
    const accounts = entry.accounts ?? [];
    if (accounts.some((account) => account.name === slug)) {
      throw new ProviderAccountError(
        `Account "${slug}" already exists for provider "${input.provider}".`,
      );
    }

    const primaryDir = path.join(this.homeDir, capability.primaryDirName);
    const configDir = `${primaryDir}-${slug}`;
    const requested = input.linkedFolders ?? capability.linkableFolders;
    const linkFolders = requested.filter((folder) => capability.linkableFolders.includes(folder));
    const unknownFolders = requested.filter(
      (folder) => !capability.linkableFolders.includes(folder),
    );

    const provisioned = provisionProviderAccount({
      primaryDir,
      accountDir: configDir,
      linkFolders,
    });

    const account: ProviderAccount = {
      id: randomUUID(),
      provider: input.provider,
      name: slug,
      configDir,
      linkedFolders: provisioned.linkedFolders,
      createdAt: new Date().toISOString(),
    };

    this.writeConfig({
      ...config,
      [input.provider]: {
        ...entry,
        accounts: [...accounts, account],
        // First account for a provider becomes the active one.
        activeAccountId: entry.activeAccountId ?? account.id,
      },
    });

    return this.buildResult([
      ...(isProviderAccountCapabilityUnverified(capability)
        ? [
            `Provider "${input.provider}" has an unverified account manifest: ${
              capability.verificationNote ??
              "its config directory and credential files were never confirmed against the CLI."
            } Sign-in may write to the wrong directory or report the wrong state.`,
          ]
        : []),
      ...unknownFolders.map(
        (folder) => `Ignored unknown linkable folder "${folder}" for provider "${input.provider}".`,
      ),
      ...provisioned.warnings,
    ]);
  }

  /**
   * Forgets the account. The config directory on disk is deliberately left in
   * place: it holds the user's credentials, and deleting it would destroy a
   * sign-in that a plain "remove from the list" action should not touch.
   */
  delete(accountId: string): ProviderAccountMutationResult {
    const config = this.readConfig();
    const providerId = Object.keys(config).find((key) =>
      (config[key]?.accounts ?? []).some((account) => account.id === accountId),
    );
    if (!providerId) {
      throw new ProviderAccountError(`Unknown provider account "${accountId}".`);
    }
    this.requireEnabledCapability(providerId);

    const entry = config[providerId] ?? {};
    const accounts = (entry.accounts ?? []).filter((account) => account.id !== accountId);
    this.writeConfig({
      ...config,
      [providerId]: {
        ...entry,
        accounts,
        activeAccountId:
          entry.activeAccountId === accountId ? (accounts[0]?.id ?? null) : entry.activeAccountId,
      },
    });

    return this.buildResult([
      `Account removed. Its config directory was left on disk and can be deleted manually.`,
    ]);
  }

  setActive(provider: string, accountId: string | null): ProviderAccountMutationResult {
    this.requireEnabledCapability(provider);
    const config = this.readConfig();
    const entry = config[provider] ?? {};
    if (accountId !== null && !(entry.accounts ?? []).some((a) => a.id === accountId)) {
      throw new ProviderAccountError(
        `Unknown provider account "${accountId}" for provider "${provider}".`,
      );
    }

    this.writeConfig({
      ...config,
      [provider]: { ...entry, activeAccountId: accountId },
    });
    return this.buildResult([]);
  }

  buildResult(warnings: string[]): ProviderAccountMutationResult {
    return {
      accounts: this.list(),
      capabilities: this.listCapabilities(),
      activeAccountIds: this.activeAccountIds(),
      warnings,
    };
  }

  private requireEnabledCapability(provider: string): ProviderAccountCapability {
    const capability = this.getCapability(provider);
    if (!capability) {
      throw new ProviderAccountError(`Provider "${provider}" does not support accounts.`);
    }
    if (!capability.enabled) {
      throw new ProviderAccountError(
        `Provider accounts are disabled for "${provider}". Enable them with providerAccounts.${provider}.enabled in config.json.` +
          (isProviderAccountCapabilityUnverified(capability)
            ? ` Note that this provider's account manifest is unverified: ${
                capability.verificationNote ??
                "its config directory and credential files were never confirmed against the CLI."
              }`
            : ""),
      );
    }
    return capability;
  }

  private readConfig(): ProviderAccountsConfig {
    const persisted = loadPersistedConfig(this.froggHome);
    return (persisted.providerAccounts ?? {}) as ProviderAccountsConfig;
  }

  private writeConfig(next: ProviderAccountsConfig): void {
    const persisted: PersistedConfig = loadPersistedConfig(this.froggHome);
    savePersistedConfig(this.froggHome, {
      ...persisted,
      providerAccounts: next,
    });
  }
}

export function isAccountAuthenticated(
  account: Pick<ProviderAccount, "configDir" | "provider">,
  capability: ProviderAccountCapability | undefined,
): boolean {
  const resolved = capability ?? findProviderAccountCapability(account.provider);
  if (!resolved) return false;
  return resolved.credentialFiles.some((file) => existsSync(path.join(account.configDir, file)));
}
