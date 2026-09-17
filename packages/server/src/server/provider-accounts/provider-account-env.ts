import type { ProviderAccountStore } from "./provider-account-store.js";

export type ProviderAccountEnvOverlay = Record<string, string>;

/**
 * The environment overlay that points a provider's CLI at the active account's
 * config directory. Returns an empty overlay — never a partial one — when the
 * provider has no accounts capability, has accounts disabled, or has no active
 * account, so callers can spread it unconditionally.
 */
export function resolveProviderAccountEnv(
  store: Pick<ProviderAccountStore, "getCapability" | "activeAccountIds" | "findAccount">,
  provider: string,
): ProviderAccountEnvOverlay {
  const capability = store.getCapability(provider);
  if (!capability || !capability.enabled) {
    return {};
  }

  const activeId = store.activeAccountIds()[provider];
  if (!activeId) {
    return {};
  }

  const account = store.findAccount(activeId);
  if (!account || account.provider !== provider) {
    return {};
  }

  return { [capability.configDirEnv]: account.configDir };
}

/**
 * The overlay for one specific account, used by the terminal login path where
 * the client names the account explicitly.
 */
export function resolveProviderAccountEnvById(
  store: Pick<ProviderAccountStore, "getCapability" | "findAccount">,
  accountId: string,
): {
  env: ProviderAccountEnvOverlay;
  loginCommand: { command: string; args: string[] };
} | null {
  const account = store.findAccount(accountId);
  if (!account) return null;
  const capability = store.getCapability(account.provider);
  if (!capability || !capability.enabled) return null;
  return {
    env: { [capability.configDirEnv]: account.configDir },
    loginCommand: {
      command: capability.loginCommand.command,
      args: [...capability.loginCommand.args],
    },
  };
}

/**
 * The env overlay for one agent, given the account the agent was launched with.
 *
 * Precedence, highest first:
 *   1. an explicit `agents.providers.<id>.env` from config.json (applied by the
 *      caller, which strips those keys from this overlay),
 *   2. the agent's own `providerAccountId`,
 *   3. the provider's daemon-wide active account.
 *
 * `accountId === null` is the explicit "Default" pick: it pins the provider's
 * primary config dir so a daemon-wide active account does NOT leak into this
 * agent. `undefined` falls back to the daemon-wide active account.
 *
 * An account id that no longer exists (deleted while a picker was open, or an
 * agent rehydrated after its account was removed) must never fail a launch: it
 * falls back to default resolution and reports the fallback to the caller.
 */
export function resolveAgentProviderAccountEnv(
  store: Pick<
    ProviderAccountStore,
    "getCapability" | "activeAccountIds" | "findAccount" | "primaryConfigDir"
  >,
  provider: string,
  accountId: string | null | undefined,
): { env: ProviderAccountEnvOverlay; unknownAccountId?: string } {
  const capability = store.getCapability(provider);
  if (!capability || !capability.enabled) {
    return { env: {} };
  }

  if (accountId === undefined) {
    return { env: resolveProviderAccountEnv(store, provider) };
  }

  if (accountId === null) {
    const primaryDir = store.primaryConfigDir(provider);
    return primaryDir ? { env: { [capability.configDirEnv]: primaryDir } } : { env: {} };
  }

  const account = store.findAccount(accountId);
  if (!account || account.provider !== provider) {
    // Deleted (or foreign-provider) account: fall back to default resolution.
    return { env: resolveProviderAccountEnv(store, provider), unknownAccountId: accountId };
  }

  return { env: { [capability.configDirEnv]: account.configDir } };
}
