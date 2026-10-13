import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

/**
 * This install's identity on every daemon. A daemon binds a password session to the device it
 * registered under the hello clientId, so the id must survive restarts and reconnects: a fresh
 * one would register a new device every time. Pairing labels and the hello deviceName share one
 * name so a paired device and a password-registered one read the same in the device list.
 */
const KEY = "frogg-next.client-id.v1";

const PLATFORM: Record<string, string> = { web: "web", android: "Android", ios: "iOS" };

/** The name this app is registered under on a daemon. */
export const deviceLabel = () => `Frogg Next on ${PLATFORM[Platform.OS] ?? Platform.OS}`;

const newClientId = () => `cid_${globalThis.crypto.randomUUID().replace(/-/g, "")}`;

let cached: string | null = null;

/** Resolves to the saved client id, creating and saving one on first run. */
export const clientIdReady: Promise<string> = AsyncStorage.getItem(KEY)
  .catch(() => null)
  .then(async (saved) => {
    if (saved?.trim()) return saved.trim();
    const next = newClientId();
    await AsyncStorage.setItem(KEY, next).catch(() => undefined);
    return next;
  })
  .then((id) => {
    cached = id;
    return id;
  });

/** The client id once `clientIdReady` has settled; a random one only if storage never answered. */
export function clientId(): string {
  cached ??= newClientId();
  return cached;
}
