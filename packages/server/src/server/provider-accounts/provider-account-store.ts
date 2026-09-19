import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  findProviderAccountCapability,
  isProviderAccountCapabilityUnverified,
  normalizeProviderAccountDisplayName,
  providerAccountConfigDirMode,
  providerAccountHomeLinks,
  parseProviderAccountDefaultId,
  providerAccountDefaultId,
  PROVIDER_ACCOUNT_CAPABILITIES,
  PROVIDER_ACCOUNT_DEFAULT_NAME,
  PROVIDER_ACCOUNT_EXPORT_BUNDLE_VERSION,
  PROVIDER_ACCOUNT_SYSTEM_PROMPT_MAX_LENGTH,
  toProviderAccountSlug,
  type ProviderAccount,
  type ProviderAccountCapability,
  type ProviderAccountExportBundle,
  type ProviderAccountPreferences,
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
      ...this.homeProvisionOptions(capability),
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

  /**
   * Renames the account's display name. Nothing on disk is touched: the config
   * directory keeps its path, so the sign-in inside it survives.
   *
   * Works for a provider's implicit "Default" account too. That account has no
   * stored record until something needs persisting about it, so the first rename
   * materialises one whose `configDir` is the provider's primary directory.
   */
  rename(accountId: string, name: string): ProviderAccountMutationResult {
    const displayName = normalizeProviderAccountDisplayName(name);
    if (!displayName) {
      throw new ProviderAccountError(
        `Account name "${name}" is not usable. Use non-blank, single-line text of at most 64 characters.`,
      );
    }

    const config = this.readConfig();
    const existing = this.locateAccount(config, accountId);
    const providerId = existing?.providerId ?? parseProviderAccountDefaultId(accountId);
    if (!providerId) {
      throw new ProviderAccountError(`Unknown provider account "${accountId}".`);
    }
    this.requireEnabledCapability(providerId);

    const entry = config[providerId] ?? {};
    const accounts = entry.accounts ?? [];
    if (accounts.some((account) => account.id !== accountId && account.name === displayName)) {
      throw new ProviderAccountError(
        `Account "${displayName}" already exists for provider "${providerId}".`,
      );
    }

    const nextAccounts = existing
      ? accounts.map((account) =>
          // configDir is deliberately carried through untouched.
          account.id === accountId ? { ...account, name: displayName } : account,
        )
      : [...accounts, this.materializeDefaultAccount(providerId, { name: displayName })];

    this.writeConfig({
      ...config,
      [providerId]: { ...entry, accounts: nextAccounts },
    });
    return this.buildResult([]);
  }

  /**
   * Deletes the capability's credential files inside the account's own config
   * directory, and nothing else. Every path is re-joined onto that directory and
   * checked to still be inside it, so a manifest entry can never reach outside.
   */
  signOut(accountId: string): ProviderAccountMutationResult {
    const { providerId, account, capability } = this.requireAccountForMutation(accountId);

    const present = this.credentialFilePaths(account, capability).filter(({ absolute }) =>
      existsSync(absolute),
    );
    if (present.length === 0) {
      throw new ProviderAccountError(
        `Account "${account.name}" is not signed in to provider "${providerId}".`,
      );
    }

    const warnings: string[] = [];
    for (const { file, absolute } of present) {
      try {
        rmSync(absolute, { force: true });
      } catch (error) {
        warnings.push(
          `Could not remove credential file "${file}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const config = this.readConfig();
    const entry = config[providerId] ?? {};
    this.writeConfig({
      ...config,
      [providerId]: {
        ...entry,
        accounts: (entry.accounts ?? []).map((candidate) => {
          if (candidate.id !== accountId) return candidate;
          const { lastAuthenticatedAt: _dropped, ...rest } = candidate;
          return rest;
        }),
      },
    });

    return this.buildResult(warnings);
  }

  /**
   * Restricts the models the account may run. `null` clears the restriction;
   * an empty array permits none. Accepts a provider's implicit default account,
   * materialising a stored record for it the same way {@link rename} does.
   */
  setAllowedModels(
    accountId: string,
    allowedModels: readonly string[] | null,
  ): ProviderAccountMutationResult {
    const config = this.readConfig();
    const existing = this.locateAccount(config, accountId);
    const providerId = existing?.providerId ?? parseProviderAccountDefaultId(accountId);
    if (!providerId) {
      throw new ProviderAccountError(`Unknown provider account "${accountId}".`);
    }
    this.requireEnabledCapability(providerId);

    // Duplicates and blank entries are dropped rather than rejected: the set of
    // permitted model ids is what matters, not how the client spelled it.
    const normalized =
      allowedModels === null
        ? null
        : [...new Set(allowedModels.map((model) => model.trim()).filter((m) => m.length > 0))];

    const entry = config[providerId] ?? {};
    const accounts = entry.accounts ?? [];
    const apply = (account: ProviderAccount): ProviderAccount => {
      if (normalized === null) {
        const { allowedModels: _cleared, ...rest } = account;
        return rest;
      }
      return { ...account, allowedModels: normalized };
    };

    const nextAccounts = existing
      ? accounts.map((account) => (account.id === accountId ? apply(account) : account))
      : [
          ...accounts,
          apply(
            this.materializeDefaultAccount(providerId, {
              name: PROVIDER_ACCOUNT_DEFAULT_NAME,
            }),
          ),
        ];

    this.writeConfig({
      ...config,
      [providerId]: { ...entry, accounts: nextAccounts },
    });
    return this.buildResult([]);
  }

  /**
   * Replaces the account's preferences. `null` (or an all-empty object) clears
   * them. Accepts a provider's implicit default account, materialising a stored
   * record for it the same way {@link rename} does.
   */
  setPreferences(
    accountId: string,
    preferences: ProviderAccountPreferences | null,
  ): ProviderAccountMutationResult {
    const config = this.readConfig();
    const existing = this.locateAccount(config, accountId);
    const providerId = existing?.providerId ?? parseProviderAccountDefaultId(accountId);
    if (!providerId) {
      throw new ProviderAccountError(`Unknown provider account "${accountId}".`);
    }
    this.requireEnabledCapability(providerId);

    const normalized = normalizePreferences(preferences);
    if (
      normalized?.systemPrompt !== undefined &&
      normalized.systemPrompt.length > PROVIDER_ACCOUNT_SYSTEM_PROMPT_MAX_LENGTH
    ) {
      throw new ProviderAccountError(
        `System prompt is longer than ${PROVIDER_ACCOUNT_SYSTEM_PROMPT_MAX_LENGTH} characters.`,
      );
    }

    const entry = config[providerId] ?? {};
    const accounts = entry.accounts ?? [];
    const apply = (account: ProviderAccount): ProviderAccount => {
      const { preferences: _replaced, ...rest } = account;
      return normalized ? { ...rest, preferences: normalized } : rest;
    };

    const nextAccounts = existing
      ? accounts.map((account) => (account.id === accountId ? apply(account) : account))
      : [
          ...accounts,
          apply(
            this.materializeDefaultAccount(providerId, {
              name: PROVIDER_ACCOUNT_DEFAULT_NAME,
            }),
          ),
        ];

    this.writeConfig({
      ...config,
      [providerId]: { ...entry, accounts: nextAccounts },
    });
    return this.buildResult([]);
  }

  /**
   * The system prompt an agent on this account appends, or undefined. Resolves
   * `accountId` exactly like {@link allowedModelsFor}.
   */
  systemPromptFor(provider: string, accountId: string | null | undefined): string | undefined {
    const capability = this.getCapability(provider);
    if (!capability || !capability.enabled) return undefined;

    const resolvedId =
      accountId === undefined
        ? this.activeAccountIds()[provider]
        : (accountId ?? providerAccountDefaultId(provider));
    if (!resolvedId) return undefined;

    const account = this.findAccount(resolvedId);
    if (!account || account.provider !== provider) return undefined;
    return account.preferences?.systemPrompt;
  }

  /**
   * The models an agent on this account may run, or undefined for "unrestricted".
   *
   * `accountId === null` resolves the provider's implicit default account and
   * `undefined` the provider's daemon-wide active account, matching
   * `resolveAgentProviderAccountEnv`. An account id that no longer exists is
   * unrestricted: a deleted account must never make a launch fail here, the env
   * resolver already falls back to the default directory.
   */
  allowedModelsFor(provider: string, accountId: string | null | undefined): string[] | undefined {
    const capability = this.getCapability(provider);
    if (!capability || !capability.enabled) return undefined;

    const resolvedId =
      accountId === undefined
        ? this.activeAccountIds()[provider]
        : (accountId ?? providerAccountDefaultId(provider));
    if (!resolvedId) return undefined;

    const account = this.findAccount(resolvedId);
    if (!account || account.provider !== provider) return undefined;
    return account.allowedModels;
  }

  /**
   * Builds a portable bundle for the named accounts (all of the provider's
   * accounts when `accountIds` is omitted or empty).
   *
   * SECRET MATERIAL: the result holds the raw credential files. It is returned
   * to the caller and never written to disk here.
   */
  export(provider: string, accountIds?: readonly string[]): ProviderAccountExportBundle {
    const capability = this.requireEnabledCapability(provider);
    const stored = (this.readConfig()[provider]?.accounts ?? []).filter(
      (account) => account.provider === provider,
    );

    const wanted = accountIds && accountIds.length > 0 ? new Set(accountIds) : null;
    if (wanted) {
      for (const id of wanted) {
        if (!stored.some((account) => account.id === id)) {
          throw new ProviderAccountError(
            `Unknown provider account "${id}" for provider "${provider}".`,
          );
        }
      }
    }
    const selected = wanted ? stored.filter((account) => wanted.has(account.id)) : stored;
    if (selected.length === 0) {
      throw new ProviderAccountError(`Provider "${provider}" has no accounts to export.`);
    }

    return {
      version: PROVIDER_ACCOUNT_EXPORT_BUNDLE_VERSION,
      provider,
      exportedAt: new Date().toISOString(),
      accounts: selected.map((account) => ({
        account,
        credentials: this.credentialFilePaths(account, capability)
          .filter(({ absolute }) => existsSync(absolute))
          .map(({ file, absolute }) => ({
            file,
            contentsBase64: readFileSync(absolute).toString("base64"),
          })),
      })),
    };
  }

  /**
   * Imports a bundle produced by {@link export}. Each account gets a freshly
   * provisioned config directory on this daemon and its credential files are
   * written 0600.
   *
   * An id or a name that already exists for the provider is rejected before
   * anything is written: importing never overwrites an existing sign-in.
   */
  import(bundle: ProviderAccountExportBundle): ProviderAccountMutationResult {
    if (bundle.version !== PROVIDER_ACCOUNT_EXPORT_BUNDLE_VERSION) {
      throw new ProviderAccountError(
        `Unsupported provider account bundle version ${bundle.version}; this daemon reads version ${PROVIDER_ACCOUNT_EXPORT_BUNDLE_VERSION}.`,
      );
    }
    const capability = this.requireEnabledCapability(bundle.provider);
    if (bundle.accounts.length === 0) {
      throw new ProviderAccountError("Provider account bundle contains no accounts.");
    }

    const config = this.readConfig();
    const entry = config[bundle.provider] ?? {};
    const accounts = entry.accounts ?? [];
    const existingIds = new Set(accounts.map((account) => account.id));
    const existingNames = new Set(accounts.map((account) => account.name));
    const primaryDir = path.join(this.homeDir, capability.primaryDirName);

    // Validate the whole bundle first so a rejection leaves nothing half-applied.
    this.validateImportBundle(bundle, capability, existingIds, existingNames);

    const warnings: string[] = [];
    const imported: ProviderAccount[] = [];
    for (const { account, credentials } of bundle.accounts) {
      const slug = toProviderAccountSlug(account.name) ?? account.id;
      const configDir = `${primaryDir}-${slug}`;
      const linkFolders = account.linkedFolders.filter((folder) =>
        capability.linkableFolders.includes(folder),
      );
      const provisioned = provisionProviderAccount({
        primaryDir,
        accountDir: configDir,
        linkFolders,
        ...this.homeProvisionOptions(capability),
      });
      warnings.push(...provisioned.warnings);

      for (const credential of credentials) {
        const absolute = this.resolveInsideConfigDir(configDir, credential.file);
        writeFileSync(absolute, Buffer.from(credential.contentsBase64, "base64"), { mode: 0o600 });
      }

      imported.push({
        ...account,
        configDir,
        linkedFolders: provisioned.linkedFolders,
        ...(account.allowedModels ? { allowedModels: [...account.allowedModels] } : {}),
        ...(account.preferences ? { preferences: { ...account.preferences } } : {}),
      });
    }

    this.writeConfig({
      ...config,
      [bundle.provider]: {
        ...entry,
        accounts: [...accounts, ...imported],
        activeAccountId: entry.activeAccountId ?? imported[0]?.id ?? null,
      },
    });

    return this.buildResult(warnings);
  }

  /**
   * Rejects a bundle whose accounts collide with each other or with existing
   * accounts, so {@link import} can validate everything before writing.
   */
  private validateImportBundle(
    bundle: ProviderAccountExportBundle,
    capability: ProviderAccountCapability,
    existingIds: Set<string>,
    existingNames: Set<string>,
  ): void {
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    for (const { account, credentials } of bundle.accounts) {
      if (account.provider !== bundle.provider) {
        throw new ProviderAccountError(
          `Bundle account "${account.name}" belongs to provider "${account.provider}", not "${bundle.provider}".`,
        );
      }
      if (existingIds.has(account.id) || seenIds.has(account.id)) {
        throw new ProviderAccountError(
          `Provider account id "${account.id}" already exists for provider "${bundle.provider}". Remove it before importing.`,
        );
      }
      if (existingNames.has(account.name) || seenNames.has(account.name)) {
        throw new ProviderAccountError(
          `Provider account "${account.name}" already exists for provider "${bundle.provider}". Rename or remove it before importing.`,
        );
      }
      if (parseProviderAccountDefaultId(account.id)) {
        throw new ProviderAccountError(
          `Bundle account "${account.name}" carries a reserved default-account id and cannot be imported.`,
        );
      }
      for (const credential of credentials) {
        if (!capability.credentialFiles.includes(credential.file)) {
          throw new ProviderAccountError(
            `Bundle account "${account.name}" carries unexpected credential file "${credential.file}" for provider "${bundle.provider}".`,
          );
        }
      }
      seenIds.add(account.id);
      seenNames.add(account.name);
    }
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

  private locateAccount(
    config: ProviderAccountsConfig,
    accountId: string,
  ): { providerId: string; account: ProviderAccount } | undefined {
    for (const [providerId, entry] of Object.entries(config)) {
      const account = (entry.accounts ?? []).find((candidate) => candidate.id === accountId);
      if (account) return { providerId, account };
    }
    return undefined;
  }

  private requireAccountForMutation(accountId: string): {
    providerId: string;
    account: ProviderAccount;
    capability: ProviderAccountCapability;
  } {
    const located = this.locateAccount(this.readConfig(), accountId);
    if (!located) {
      throw new ProviderAccountError(`Unknown provider account "${accountId}".`);
    }
    return {
      ...located,
      capability: this.requireEnabledCapability(located.providerId),
    };
  }

  /**
   * The stored record standing in for a provider's implicit default account. Its
   * `configDir` is the provider's primary directory and stays that way: the
   * record exists only to hold overrides, never to relocate the directory.
   */
  private materializeDefaultAccount(
    providerId: string,
    overrides: { name: string },
  ): ProviderAccount {
    const capability = this.requireEnabledCapability(providerId);
    return {
      id: providerAccountDefaultId(providerId),
      provider: providerId,
      name: overrides.name,
      configDir: path.join(this.homeDir, capability.primaryDirName),
      linkedFolders: [],
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Absolute paths of the capability's credential files inside this account's
   * config dir. A manifest entry that tried to escape the directory (`../`, an
   * absolute path) is rejected rather than followed.
   */
  private credentialFilePaths(
    account: Pick<ProviderAccount, "configDir">,
    capability: ProviderAccountCapability,
  ): { file: string; absolute: string }[] {
    return capability.credentialFiles.map((file) => ({
      file,
      absolute: this.resolveInsideConfigDir(account.configDir, file),
    }));
  }

  /**
   * Provisioning options for a `configDirMode: "home"` capability, where the
   * account directory is a synthetic HOME rather than the config directory
   * itself. Spreads to nothing for env-mode providers, which are unaffected.
   */
  private homeProvisionOptions(capability: ProviderAccountCapability): {
    home?: {
      realHome: string;
      configSubdir: string;
      homeLinks: readonly string[];
    };
  } {
    if (providerAccountConfigDirMode(capability) !== "home") return {};
    return {
      home: {
        realHome: this.homeDir,
        configSubdir: capability.primaryDirName,
        homeLinks: providerAccountHomeLinks(capability),
      },
    };
  }

  private resolveInsideConfigDir(configDir: string, file: string): string {
    const root = path.resolve(configDir);
    const absolute = path.resolve(root, file);
    if (absolute !== root && !absolute.startsWith(root + path.sep)) {
      throw new ProviderAccountError(
        `Credential file "${file}" resolves outside the account config directory.`,
      );
    }
    return absolute;
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

/**
 * Trims every field and drops the blank ones, so "cleared" is always spelled as
 * an absent field. Returns null when nothing is left.
 */
function normalizePreferences(
  preferences: ProviderAccountPreferences | null,
): ProviderAccountPreferences | null {
  if (!preferences) return null;
  const next: ProviderAccountPreferences = {};
  const color = preferences.color?.trim();
  if (color) next.color = color;
  const systemPrompt = preferences.systemPrompt?.trim();
  if (systemPrompt) next.systemPrompt = systemPrompt;
  const defaultModelId = preferences.defaultModelId?.trim();
  if (defaultModelId) next.defaultModelId = defaultModelId;
  const defaultThinkingOptionId = preferences.defaultThinkingOptionId?.trim();
  if (defaultThinkingOptionId) next.defaultThinkingOptionId = defaultThinkingOptionId;
  return Object.keys(next).length > 0 ? next : null;
}
