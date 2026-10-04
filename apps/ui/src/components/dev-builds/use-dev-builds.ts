/**
 * Dev builds on a host, polled once per host however many components read them: the top bar's
 * Dev menu and every sidebar row that may carry a dev build badge.
 */
import { isDev } from "@/constants/platform";
import { useCallback, useSyncExternalStore } from "react";
import type { DaemonDevDaemonStatusPayload } from "@frogg/client";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import type { DaemonDevBuild } from "@frogg/protocol/messages";
import { useAppSettings } from "@/hooks/use-settings";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

const POLL_MS = 4000;

export type DevBuildTone = "running" | "stale" | "busy" | "starting";

export interface DevBuildsSnapshot {
  status: DaemonDevDaemonStatusPayload;
  instances: DaemonDevBuild[];
}

interface Poller {
  client: DaemonClient;
  listeners: Set<() => void>;
  snapshot: DevBuildsSnapshot | null;
  timer: ReturnType<typeof setInterval> | null;
}

const pollers = new Map<string, Poller>();

/** COMPAT(devBuilds): a host older than v1.6.10 reports its one dev build in top-level fields. */
export function devBuildsOf(status: DaemonDevDaemonStatusPayload): DaemonDevBuild[] {
  if (status.instances) return status.instances;
  if (!status.running || !status.cwd) return [];
  return [
    {
      cwd: status.cwd,
      name: status.checkouts.find((checkout) => checkout.cwd === status.cwd)?.name ?? status.cwd,
      branch: status.branch,
      startedAt: status.startedAt,
      daemonPort: status.daemonPort,
      webPort: status.webPort,
      logPath: status.logPath,
      ready: status.ready,
      webReady: status.webReady ?? false,
      daemonStale: status.daemonStale ?? [],
      webStale: status.webStale ?? [],
      busy: status.busy ?? null,
      lastError: status.lastError ?? null,
      behindMain: status.behindMain ?? null,
      canRebuild: status.canRebuild ?? false,
    },
  ];
}

async function poll(serverId: string): Promise<void> {
  const poller = pollers.get(serverId);
  if (!poller) return;
  try {
    const status = await poller.client.getDevDaemonStatus();
    if (pollers.get(serverId) !== poller) return;
    poller.snapshot = { status, instances: devBuildsOf(status) };
    for (const listener of poller.listeners) listener();
  } catch {
    // A rebuild restarts the daemon this may be talking to; the next poll catches up.
  }
}

function subscribe(serverId: string, client: DaemonClient, listener: () => void): () => void {
  let poller = pollers.get(serverId);
  if (!poller || poller.client !== client) {
    if (poller?.timer) clearInterval(poller.timer);
    poller = { client, listeners: new Set(), snapshot: null, timer: null };
    pollers.set(serverId, poller);
  }
  poller.listeners.add(listener);
  if (!poller.timer) {
    poller.timer = setInterval(() => void poll(serverId), POLL_MS);
    void poll(serverId);
  }
  const owned = poller;
  return () => {
    owned.listeners.delete(listener);
    if (owned.listeners.size > 0) return;
    if (owned.timer) clearInterval(owned.timer);
    if (pollers.get(serverId) === owned) pollers.delete(serverId);
  };
}

/** Developer options are on (always, in a development build). */
export function useDevBuildsEnabled(): boolean {
  return useAppSettings().settings.developerOptions || isDev;
}

/** The host launches dev builds. */
export function useHostManagesDevBuilds(serverId: string | null): boolean {
  return useSessionStore((state) =>
    serverId ? state.sessions[serverId]?.serverInfo?.features?.devDaemonRebuild === true : false,
  );
}

/** The host's dev builds, or null while unknown or when it does not launch them. */
export function useDevBuilds(serverId: string | null): {
  snapshot: DevBuildsSnapshot | null;
  refresh: () => void;
  client: DaemonClient | null;
} {
  const enabled = useDevBuildsEnabled();
  const managed = useHostManagesDevBuilds(serverId);
  const client = useHostRuntimeClient(serverId ?? "");
  const active = enabled && managed && serverId !== null && client !== null;
  const snapshot = useSyncExternalStore(
    useCallback(
      (listener: () => void) =>
        active && serverId && client ? subscribe(serverId, client, listener) : () => undefined,
      [active, client, serverId],
    ),
    () => (active && serverId ? (pollers.get(serverId)?.snapshot ?? null) : null),
  );
  const refresh = useCallback(() => {
    if (serverId) void poll(serverId);
  }, [serverId]);
  return { snapshot, refresh, client: active ? client : null };
}

/** The dev build running from `cwd` on the host, if any. */
export function useDevBuildFor(serverId: string | null, cwd: string | null): DaemonDevBuild | null {
  const { snapshot } = useDevBuilds(serverId);
  if (!snapshot || !cwd) return null;
  return snapshot.instances.find((instance) => instance.cwd === cwd) ?? null;
}

/** The tone of a running dev build's daemon or web app. */
export function devBuildTone(input: {
  busy: boolean;
  running: boolean;
  stale: boolean;
}): DevBuildTone {
  if (input.busy) return "busy";
  if (!input.running) return "starting";
  return input.stale ? "stale" : "running";
}

/** One tone for a whole dev build, for a single status dot. */
export function overallDevBuildTone(build: DaemonDevBuild): DevBuildTone {
  if (build.busy) return "busy";
  if (!build.ready || !build.webReady) return "starting";
  return build.daemonStale.length > 0 || build.webStale.length > 0 ? "stale" : "running";
}
