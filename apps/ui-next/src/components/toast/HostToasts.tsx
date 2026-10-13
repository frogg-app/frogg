import { useEffect, useState } from "react";
import { useHostLink, useHosts } from "../../daemon/hosts";
import { connect, getClient, useDaemon } from "../../daemon/store";
import { useUi } from "../../ui-store";
import { dismissToast, toast, toastShowing, updateToast } from "./store";

const APP_VERSION: string = require("../../../package.json").version;

/** A first connect that lands within this long never shows the offline toast. */
const GRACE_MS = 2000;

/**
 * The toast ids of the host conditions currently up, and the incidents already announced.
 * Module state so the phone/desktop shell swap (which remounts HostToasts) neither repeats a
 * toast nor loses track of the one it must update or retire.
 */
const live = { offline: null as string | null, storage: null as string | null };
let offlineKey: string | null = null;
/** Bumps every time the link comes up, so one outage is one incident however it retries. */
let onlineEpoch = 0;
let storageKey: string | null = null;
const announced = new Set<string>();

function retire(which: keyof typeof live) {
  const id = live[which];
  if (id) dismissToast(id);
  live[which] = null;
}

const retry = () => void connect();
// The update itself lives on the host's Daemon & updates page (channel, version, progress).
const openUpdate = () => {
  useUi.getState().setTool("settings");
  useUi.getState().openSettings("daemon");
};
function openResources() {
  useUi.getState().setTool("settings");
  useUi.getState().openSettings("resources");
}

/**
 * Host-wide conditions as toasts (they used to be full-width banners): daemon older than the
 * app (a normal toast, once per host and version), reconnecting (a sticky toast whose timer
 * ticks; Retry keeps it up; it retires itself with a short "Reconnected" when the link is back)
 * and storage alerts (sticky while critical, retired when the alert clears). Renders nothing.
 */
export function HostToasts() {
  const conn = useDaemon((st) => st.conn);
  const url = useDaemon((st) => st.url);
  const droppedAt = useHostLink((st) => st.droppedAt);
  const hostName = useHosts((st) => st.hosts.find((h) => h.id === st.activeId)?.name ?? "host");
  const offlineFor = useElapsed(conn === "online" ? null : droppedAt);
  const [version, setVersion] = useState<string | null>(null);
  const [storage, setStorage] = useState<{ level: string; bytes: number } | null>(null);

  useEffect(() => {
    setStorage(null);
    setVersion(null);
    const client = getClient();
    if (!client || conn !== "online") return;
    const info = client.getLastServerInfoMessage() as { version?: string } | null;
    setVersion(info?.version ?? null);
    return client.subscribe((event) => {
      if (event.type !== "status") return;
      const p = event.payload as { status: string; alert?: { level: string; totalBytes: number } };
      if (p.status === "storage_alert" && p.alert)
        setStorage(
          p.alert.level === "ok" ? null : { level: p.alert.level, bytes: p.alert.totalBytes },
        );
    });
  }, [conn, url]);

  // Daemon older than the app.
  const older = conn === "online" && !!version && compareVersions(version, APP_VERSION) < 0;
  useEffect(() => {
    if (!older || !version) return;
    const key = `version:${url}:${version}:${APP_VERSION}`;
    if (announced.has(key)) return;
    announced.add(key);
    toast({
      kind: "needs",
      title: `${hostName} runs daemon ${version}`,
      detail: `Older than this app (${APP_VERSION}); some features are hidden.`,
      action: { label: "Update host…", onPress: openUpdate },
    });
  }, [older, url, version, hostName]);

  // Offline / reconnecting.
  const offTitle = `${conn === "connecting" ? "Connecting to" : "Disconnected from"} ${hostName}`;
  const offDetail = offlineFor
    ? `Offline for ${offlineFor}. Reconnect before sending messages.`
    : "Reconnect before sending messages.";
  const online = conn === "online";
  useEffect(() => {
    if (online) {
      const wasUp = !!live.offline && toastShowing(live.offline);
      retire("offline");
      offlineKey = null;
      onlineEpoch += 1;
      if (wasUp) toast({ kind: "ok", title: `Reconnected to ${hostName}` });
      return undefined;
    }
    const key = `offline:${url}:${onlineEpoch}`;
    if (key === offlineKey) return undefined;
    // A different incident (or host): the old toast no longer describes anything.
    retire("offline");
    if (announced.has(key)) return undefined;
    const t = setTimeout(() => {
      announced.add(key);
      offlineKey = key;
      live.offline = toast({
        kind: "info",
        sticky: true,
        keepOnAction: true,
        title: offTitle,
        detail: offDetail,
        action: { label: "Retry now", onPress: retry },
      });
    }, GRACE_MS);
    return () => clearTimeout(t);
    // Copy changes go through the update effect below, not a new toast.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, url]);
  useEffect(() => {
    if (live.offline && toastShowing(live.offline))
      updateToast(live.offline, { title: offTitle, detail: offDetail });
  }, [offTitle, offDetail]);

  // Storage alerts.
  useEffect(() => {
    const key = storage ? `storage:${url}:${storage.level}` : null;
    if (key === storageKey) return;
    retire("storage");
    storageKey = key;
    if (!storage || !key) return;
    const critical = storage.level === "critical";
    live.storage = toast({
      kind: critical ? "error" : "needs",
      sticky: critical,
      title: `Frogg storage on ${hostName} is ${formatBytes(storage.bytes)}`,
      detail: "Clean up worktrees, logs and caches to free space.",
      action: { label: "Review storage…", onPress: openResources },
    });
  }, [storage, url, hostName]);

  return null;
}

function useElapsed(since: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  if (!since) return null;
  const sec = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, "0")}`;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  return `${Math.round(n / 1e6)} MB`;
}
