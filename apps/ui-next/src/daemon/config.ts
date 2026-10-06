import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@frogg/protocol/messages";
import { create } from "zustand";
import { getClient } from "./store";

type Providers = Awaited<ReturnType<NonNullable<ReturnType<typeof getClient>>["getProvidersSnapshot"]>>;
type Status = Awaited<ReturnType<NonNullable<ReturnType<typeof getClient>>["getDaemonStatus"]>>;

interface ConfigState {
  config: MutableDaemonConfig | null;
  providers: Providers | null;
  status: Status | null;
  saving: boolean;
  error: string | null;
}

export const useConfig = create<ConfigState>(() => ({ config: null, providers: null, status: null, saving: false, error: null }));

export async function loadConfig(): Promise<void> {
  const client = getClient();
  if (!client) return;
  try {
    const [cfg, providers, status] = await Promise.all([
      client.getDaemonConfig(),
      client.getProvidersSnapshot(),
      client.getDaemonStatus().catch(() => null),
    ]);
    useConfig.setState({ config: cfg.config, providers, status, error: null });
  } catch (e) {
    useConfig.setState({ error: e instanceof Error ? e.message : String(e) });
  }
}

/** Optimistic: the page reflects the change at once and settles on the daemon's answer. */
export async function patchConfig(patch: MutableDaemonConfigPatch): Promise<void> {
  const client = getClient();
  const prev = useConfig.getState().config;
  if (!client || !prev) return;
  useConfig.setState({ config: { ...prev, ...(patch as object) } as MutableDaemonConfig, saving: true });
  try {
    const res = await client.patchDaemonConfig(patch);
    useConfig.setState({ config: res.config, error: null });
  } catch (e) {
    useConfig.setState({ config: prev, error: e instanceof Error ? e.message : String(e) });
  } finally {
    useConfig.setState({ saving: false });
  }
}
