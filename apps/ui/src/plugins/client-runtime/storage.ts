import { Platform } from "react-native";
import { getDesktopHost } from "@/desktop/host";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import { isClientPluginRecord, type ClientPluginRecord } from "./records";

/**
 * Where client plugins live on this device. Desktop keeps them under the app data directory via
 * the native bridge; web keeps them in IndexedDB. Mobile has no client plugin runtime.
 */
export interface ClientPluginStorage {
  list(): Promise<ClientPluginRecord[]>;
  put(record: ClientPluginRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

const DB_NAME = "frogg-client-plugins";
const STORE = "plugins";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.addEventListener("success", () => resolve(req.result));
    req.addEventListener("error", () => reject(req.error ?? new Error("IndexedDB request failed")));
  });
}

export function createIndexedDbStorage(factory: IDBFactory): ClientPluginStorage {
  let dbPromise: Promise<IDBDatabase> | null = null;
  const open = () => {
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, 1);
      req.addEventListener("upgradeneeded", () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: "id" });
        }
      });
      req.addEventListener("success", () => resolve(req.result));
      req.addEventListener("error", () => {
        dbPromise = null;
        reject(req.error ?? new Error("IndexedDB open failed"));
      });
    });
    return dbPromise;
  };
  const tx = async (mode: IDBTransactionMode) =>
    (await open()).transaction(STORE, mode).objectStore(STORE);
  return {
    async list() {
      const all = await request((await tx("readonly")).getAll());
      return all.filter(isClientPluginRecord);
    },
    async put(record) {
      await request((await tx("readwrite")).put(record));
    },
    async remove(id) {
      await request((await tx("readwrite")).delete(id));
    },
  };
}

/** Desktop: one JSON file per plugin under `<userData>/client-plugins/`. */
export function createDesktopStorage(
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> = invokeDesktopCommand,
): ClientPluginStorage {
  return {
    async list() {
      const raw = await invoke<unknown[]>("client_plugins_list");
      return (Array.isArray(raw) ? raw : []).filter(isClientPluginRecord);
    },
    async put(record) {
      await invoke("client_plugins_put", { record });
    },
    async remove(id) {
      await invoke("client_plugins_remove", { id });
    },
  };
}

export function isDesktopApp(): boolean {
  return typeof getDesktopHost()?.invoke === "function";
}

/** The client plugin runtime exists on desktop and web only. */
export function isClientPluginRuntimeSupported(): boolean {
  return Platform.OS === "web" && typeof document !== "undefined";
}

let storage: ClientPluginStorage | null = null;

export function getClientPluginStorage(): ClientPluginStorage | null {
  if (!isClientPluginRuntimeSupported()) return null;
  if (storage) return storage;
  if (isDesktopApp()) {
    storage = createDesktopStorage();
  } else if (typeof indexedDB !== "undefined") {
    storage = createIndexedDbStorage(indexedDB);
  }
  return storage;
}
