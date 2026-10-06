import type { MutableDaemonConfigPatch } from "@frogg/protocol/messages";
import { useConfig } from "../../../daemon/config";
import { getClient, onHostSwitch } from "../../../daemon/store";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { useCallback, useRef, type ComponentType } from "react";
import { useDaemon } from "../../../daemon/store";
import { ErrorLine } from "./kit";
import { Note } from "../controls";
import { useAction, useRpc } from "./kit";

/** A settings form belongs to one connection; never carry passwords or drafts to another host. */
export function HostPage({ body: Body }: { body: ComponentType }) {
  const url = useDaemon((s) => s.url);
  const conn = useDaemon((s) => s.conn);
  const error = useConfig((s) => s.error);
  if (conn !== "online") return <Note>Host offline. Connect to load and change its settings.</Note>;
  return (
    <>
      <ErrorLine text={error} />
      <Body key={url} />
    </>
  );
}

export async function checked<T>(promise: Promise<T>): Promise<T> {
  const result = await promise;
  const r = result as { error?: unknown; accepted?: boolean; success?: boolean } | null;
  if (r?.error) {
    const message = typeof r.error === "string" ? r.error : JSON.stringify(r.error);
    throw new Error(message);
  }
  if (r?.accepted === false || r?.success === false)
    throw new Error("The host did not accept this change.");
  return result;
}

export function useHostRpc<D>(
  load: (client: DaemonClient) => Promise<D>,
  opts: { pollMs?: number; enabled?: boolean } = {},
) {
  const read = useCallback((client: DaemonClient) => checked(load(client)), [load]);
  return useRpc(read, opts);
}

export function useHostAction() {
  const action = useAction();
  const { run: execute } = action;
  const lock = useRef(false);
  const run = useCallback(
    async (key: string, fn: () => Promise<unknown>) => {
      if (lock.current) return false;
      lock.current = true;
      try {
        return await execute(key, () => checked(fn()));
      } finally {
        lock.current = false;
      }
    },
    [execute],
  );
  return { ...action, run };
}

/** Keep the server-confirmed config visible while saving; partial nested patches aren't snapshots. */
export async function patchHostConfig(patch: MutableDaemonConfigPatch): Promise<boolean> {
  const client = getClient();
  if (!client || useDaemon.getState().conn !== "online") {
    useConfig.setState({ error: "Host offline. Reconnect before saving." });
    return false;
  }
  if (useConfig.getState().saving) return false;
  useConfig.setState({ saving: true, error: null });
  try {
    const result = await client.patchDaemonConfig(patch);
    if (getClient() !== client) return false;
    useConfig.setState({ config: result.config });
    return true;
  } catch (e) {
    if (getClient() === client)
      useConfig.setState({ error: e instanceof Error ? e.message : String(e) });
    return false;
  } finally {
    if (getClient() === client) useConfig.setState({ saving: false });
  }
}

// A request on the old client must not leave the new host’s forms locked.
onHostSwitch(() => useConfig.setState({ saving: false }));
