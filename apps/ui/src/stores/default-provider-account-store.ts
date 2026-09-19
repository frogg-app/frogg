import AsyncStorage from "@/storage/brand-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

/**
 * The account a new agent starts on, per host and provider.
 *
 * This is deliberately a CLIENT preference, not daemon state. Every signed-in
 * account stays usable at the same time — agents can run side by side on
 * different accounts — so nothing daemon-side may be marked "the account in
 * use". All this records is which row the composer's account picker starts on;
 * any other account is one pick away and launching on it changes nothing here.
 *
 * `null` is the explicit "Default" pick (the provider's primary config dir),
 * and a missing key means the user has never chosen, in which case callers fall
 * back to whatever the daemon reports as the provider's default account.
 */
type DefaultAccountId = string | null;

interface DefaultProviderAccountStoreState {
  defaults: Record<string, DefaultAccountId>;
  setDefaultAccountId: (
    scope: { serverId: string; provider: string },
    accountId: DefaultAccountId,
  ) => void;
  clearDefaultAccountId: (scope: { serverId: string; provider: string }) => void;
}

const PersistedStateSchema = z.strictObject({
  defaults: z.record(z.string(), z.string().nullable()).optional(),
});

/** Hosts and providers are free-form ids, so the key uses a separator neither can contain. */
export function defaultProviderAccountKey(serverId: string, provider: string): string {
  return `${serverId}\u0000${provider}`;
}

export const useDefaultProviderAccountStore = create<DefaultProviderAccountStoreState>()(
  persist(
    (set) => ({
      defaults: {},
      setDefaultAccountId: ({ serverId, provider }, accountId) => {
        if (!serverId || !provider) return;
        set((state) => ({
          defaults: {
            ...state.defaults,
            [defaultProviderAccountKey(serverId, provider)]: accountId,
          },
        }));
      },
      clearDefaultAccountId: ({ serverId, provider }) => {
        set((state) => {
          const key = defaultProviderAccountKey(serverId, provider);
          if (!Object.hasOwn(state.defaults, key)) return state;
          const { [key]: _removed, ...rest } = state.defaults;
          return { defaults: rest };
        });
      },
    }),
    {
      name: "default-provider-account",
      storage: createValidatedPersistStorage(AsyncStorage, PersistedStateSchema),
      partialize: (state) => ({ defaults: state.defaults }),
      version: 1,
    },
  ),
);

/**
 * The stored default for a host and provider, or `undefined` when the user has
 * never picked one. `undefined` and `null` are distinct: the caller falls back
 * to the daemon's reported default for `undefined`, while `null` is a chosen
 * "Default" that must not be overridden by it.
 */
export function useDefaultProviderAccountId(
  serverId: string | null | undefined,
  provider: string | null | undefined,
): DefaultAccountId | undefined {
  return useDefaultProviderAccountStore((state) =>
    serverId && provider
      ? state.defaults[defaultProviderAccountKey(serverId, provider)]
      : undefined,
  );
}
