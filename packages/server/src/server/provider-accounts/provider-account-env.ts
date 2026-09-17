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
