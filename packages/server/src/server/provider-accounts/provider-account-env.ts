import path from "node:path";

import {
  parseProviderAccountDefaultId,
  providerAccountConfigDirMode,
} from "@frogg/protocol/provider-accounts";

import type { ProviderAccountStore } from "./provider-account-store.js";

/**
 * Variables to add to ONE provider process's environment.
 *
 * Every overlay here is per-provider and per-account: callers spread it onto the
 * environment of the child process they are about to launch for that provider
 * (see `AgentManager.resolveProviderAccountLaunchEnv`) and nowhere else. That
 * matters for `configDirMode: "home"` capabilities, whose overlay sets `HOME`:
 * it must reach only that provider's process, never another provider's process
 * and never the daemon itself, which keeps the real home.
 */
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

  // `configDirEnv` is HOME for a home-mode capability, and the account dir is
  // that provider's synthetic home, so one expression covers both modes.
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
 * primary config dir (in home mode: the real home, i.e. no override) so a
 * daemon-wide active account does NOT leak into this agent. `undefined` falls
 * back to the daemon-wide active account.
 *
 * An account id that no longer exists (deleted while a picker was open, or an
 * agent rehydrated after its account was removed) must never fail a launch: it
 * falls back to default resolution and reports the fallback to the caller.
 *
 * `resolvedAccountId` is present whenever the provider has an enabled accounts
 * capability and names the account the overlay actually points at for an
 * absent `accountId` (the active account id, or `null` for the primary dir).
 * The agent manager pins it onto the agent so a later change of the daemon-wide
 * active account cannot silently move an existing conversation.
 */
export function resolveAgentProviderAccountEnv(
  store: Pick<
    ProviderAccountStore,
    "getCapability" | "activeAccountIds" | "findAccount" | "primaryConfigDir"
  >,
  provider: string,
  accountId: string | null | undefined,
): {
  env: ProviderAccountEnvOverlay;
  unknownAccountId?: string;
  resolvedAccountId?: string | null;
} {
  const capability = store.getCapability(provider);
  if (!capability || !capability.enabled) {
    return { env: {} };
  }

  if (accountId === undefined) {
    return {
      env: resolveProviderAccountEnv(store, provider),
      resolvedAccountId: resolveActiveProviderAccountId(store, provider),
    };
  }

  if (accountId === null) {
    // In home mode the primary "config dir" (`~/.gemini`) is a directory inside
    // the real home, not a home itself, so it must never be used as HOME. The
    // default account simply inherits the daemon's real HOME: an empty overlay.
    if (providerAccountConfigDirMode(capability) === "home") {
      return { env: {}, resolvedAccountId: null };
    }
    const primaryDir = store.primaryConfigDir(provider);
    return primaryDir
      ? {
          env: { [capability.configDirEnv]: primaryDir },
          resolvedAccountId: null,
        }
      : { env: {}, resolvedAccountId: null };
  }

  const account = store.findAccount(accountId);
  if (!account || account.provider !== provider) {
    // Deleted (or foreign-provider) account: fall back to default resolution.
    return { env: resolveProviderAccountEnv(store, provider), unknownAccountId: accountId };
  }

  return {
    env: { [capability.configDirEnv]: account.configDir },
    resolvedAccountId: accountId,
  };
}

/**
 * The account an absent `providerAccountId` resolves to right now: the
 * daemon-wide active account when it still exists for this provider, otherwise
 * `null` (the primary config dir) — mirroring {@link resolveProviderAccountEnv}.
 */
function resolveActiveProviderAccountId(
  store: Pick<ProviderAccountStore, "activeAccountIds" | "findAccount">,
  provider: string,
): string | null {
  const activeId = store.activeAccountIds()[provider];
  if (!activeId) return null;
  const account = store.findAccount(activeId);
  return account && account.provider === provider ? activeId : null;
}

/**
 * The provider's config directory for one account, for daemon-side readers that
 * open the credential files themselves rather than launching the CLI (today:
 * the usage/quota fetchers).
 *
 * Resolution matches {@link resolveAgentProviderAccountEnv} exactly — absent
 * means the daemon-wide active account, `null` the primary directory, a string
 * that account — so the figures reported for an agent describe the very
 * directory that agent's provider process runs against.
 *
 * Unlike the env overlay this always names a directory, including in home mode:
 * there the account directory is a synthetic home and the config dir is
 * `<accountDir>/<primaryDirName>` nested inside it.
 *
 * Returns undefined when the provider has no enabled accounts capability, or
 * when nothing narrows it down to a directory other than the default one — in
 * both cases the caller should read whatever it reads by default.
 */
export function resolveProviderAccountConfigDir(
  store: Pick<
    ProviderAccountStore,
    "getCapability" | "activeAccountIds" | "findAccount" | "primaryConfigDir"
  >,
  provider: string,
  accountId: string | null | undefined,
): string | undefined {
  const capability = store.getCapability(provider);
  if (!capability || !capability.enabled) return undefined;

  const homeMode = providerAccountConfigDirMode(capability) === "home";
  const configDirOf = (accountDir: string): string =>
    homeMode ? path.join(accountDir, capability.primaryDirName) : accountDir;

  const resolvedId = accountId === undefined ? store.activeAccountIds()[provider] : accountId;
  if (resolvedId == null) {
    // `null` is the explicit primary-directory pick; an absent active account
    // lands here too and means the same directory.
    return store.primaryConfigDir(provider);
  }

  // The provider's implicit default account names the primary directory even
  // when nothing has been stored about it yet. Falling through to the active
  // account below would hand back another sign-in's directory entirely.
  if (parseProviderAccountDefaultId(resolvedId) === provider) {
    return store.primaryConfigDir(provider);
  }

  const account = store.findAccount(resolvedId);
  if (!account || account.provider !== provider) {
    // Deleted or foreign account: fall back the same way a launch would.
    const activeId = store.activeAccountIds()[provider];
    const active = activeId ? store.findAccount(activeId) : undefined;
    return active && active.provider === provider
      ? configDirOf(active.configDir)
      : store.primaryConfigDir(provider);
  }

  return configDirOf(account.configDir);
}
