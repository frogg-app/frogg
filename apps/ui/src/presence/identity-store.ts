/**
 * COMPAT(connectedClients): added in v1.5.51.
 *
 * Who this app is to everyone else on a daemon, and what this app calls
 * everyone else. Both are local: the display name is sent to daemons (in the
 * hello and on every presence report), the nicknames never leave the device.
 *
 * Nicknames are keyed by the daemon's `clientKey`, a hash of the other app's
 * install id, so a nickname follows that app across reconnects and across
 * every daemon it shares with this one.
 */
import AsyncStorage from "@/storage/brand-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { resolveDeviceLabel } from "@/pairing/device-label";

/** Matches the daemon's hello `deviceName` cap. */
export const DISPLAY_NAME_MAX_LENGTH = 60;
export const NICKNAME_MAX_LENGTH = 60;

const PersistedIdentitySchema = z.strictObject({
  displayName: z.string().max(DISPLAY_NAME_MAX_LENGTH),
  nicknames: z.record(z.string(), z.string().max(NICKNAME_MAX_LENGTH)),
});
type PersistedIdentity = z.infer<typeof PersistedIdentitySchema>;

interface PresenceIdentityState extends PersistedIdentity {
  setDisplayName: (name: string) => void;
  /** An empty name clears the nickname. */
  setNickname: (clientKey: string, name: string) => void;
}

export const usePresenceIdentityStore = create<PresenceIdentityState>()(
  persist<PresenceIdentityState, [], [], PersistedIdentity>(
    (set) => ({
      displayName: "",
      nicknames: {},
      setDisplayName: (name) => set({ displayName: name.trim().slice(0, DISPLAY_NAME_MAX_LENGTH) }),
      setNickname: (clientKey, name) =>
        set((state) => ({ nicknames: withNickname(state.nicknames, clientKey, name) })),
    }),
    {
      name: "presence-identity",
      storage: createValidatedPersistStorage(AsyncStorage, PersistedIdentitySchema),
      partialize: (state) => ({ displayName: state.displayName, nicknames: state.nicknames }),
    },
  ),
);

export function withNickname(
  nicknames: Readonly<Record<string, string>>,
  clientKey: string,
  name: string,
): Record<string, string> {
  const trimmed = name.trim().slice(0, NICKNAME_MAX_LENGTH);
  const next = { ...nicknames };
  if (trimmed) next[clientKey] = trimmed;
  else delete next[clientKey];
  return next;
}

/** The name this app goes by on daemons: the chosen one, else the platform's. */
export function resolveSelfDisplayName(displayName: string = readDisplayName()): string {
  return displayName.trim() || resolveDeviceLabel();
}

function readDisplayName(): string {
  return usePresenceIdentityStore.getState().displayName;
}

/**
 * What to call another client, most personal first: this user's nickname for
 * it, the name it goes by, and only then an empty string for the renderer to
 * replace with a translated placeholder.
 */
export function resolveParticipantName(
  input: { clientKey?: string | null; deviceName: string },
  nicknames: Readonly<Record<string, string>>,
): string {
  const nickname = input.clientKey ? nicknames[input.clientKey] : undefined;
  return nickname?.trim() || input.deviceName;
}

export function useParticipantName(input: {
  clientKey?: string | null;
  deviceName: string;
}): string {
  const nickname = usePresenceIdentityStore((state) =>
    input.clientKey ? state.nicknames[input.clientKey] : undefined,
  );
  return nickname?.trim() || input.deviceName;
}
