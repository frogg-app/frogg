import AsyncStorage from "@react-native-async-storage/async-storage";
import type { UsageEvent, UsageStatsBatch } from "@frogg/protocol/usage-stats/events";
import { usageEventTime, usageStatsEndpoint } from "@frogg/protocol/usage-stats/events";
import { Platform } from "react-native";
import { create } from "zustand";
import { desktopBridge } from "../desktop-bridge";
import { buildAppBatch, newInstallId, productSlug, type AppIdentity } from "./batch";

/**
 * Opt-in usage statistics for this device ("Send usage statistics"). Off until the user turns
 * it on; with no collector in this build's brand.json it never sends anything. Events are app
 * interactions from the allowlist in @frogg/protocol/usage-stats/events, queued and sent in
 * small batches. The last batches sent are kept on the device so Settings can show exactly
 * what left it. Turning it off drops the queue, the sent log and the install id.
 */
export type Consent = "unset" | "on" | "off";

export const COLLECTOR_URL = process.env.EXPO_PUBLIC_FROGG_COLLECTOR_URL?.trim() || null;
const ENDPOINT = usageStatsEndpoint(COLLECTOR_URL);
const KEY = "frogg.next.usage-stats";
const SENT_KEEP = 20;
const FLUSH_MS = 30_000;
const APP_VERSION: string = require("../../package.json").version;

export interface SentBatch {
  at: string;
  batch: UsageStatsBatch;
}

interface UsageStatsState {
  loaded: boolean;
  consent: Consent;
  /** The "Help improve Frogg" prompt was shown once already. */
  prompted: boolean;
  installId: string | null;
  lastActiveDay: string | null;
  sent: SentBatch[];
}

type Saved = Omit<UsageStatsState, "loaded">;

export const useUsageStats = create<UsageStatsState>(() => ({
  loaded: false,
  consent: "unset",
  prompted: false,
  installId: null,
  lastActiveDay: null,
  sent: [],
}));

let queue: UsageEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function save() {
  const { loaded: _loaded, ...rest } = useUsageStats.getState();
  void AsyncStorage.setItem(KEY, JSON.stringify(rest satisfies Saved));
}

export const usageStatsReady: Promise<void> = AsyncStorage.getItem(KEY)
  .then((raw) => {
    const saved = raw ? (JSON.parse(raw) as Partial<Saved>) : {};
    useUsageStats.setState({
      loaded: true,
      consent: saved.consent === "on" || saved.consent === "off" ? saved.consent : "unset",
      prompted: saved.prompted === true,
      installId: typeof saved.installId === "string" ? saved.installId : null,
      lastActiveDay: typeof saved.lastActiveDay === "string" ? saved.lastActiveDay : null,
      sent: Array.isArray(saved.sent) ? saved.sent.slice(-SENT_KEEP) : [],
    });
    return undefined;
  })
  .catch(() => useUsageStats.setState({ loaded: true }));

/** True when this build has a collector, so the setting can do anything. */
export const usageStatsAvailable = (): boolean => ENDPOINT !== null;

function desktopOs(): string {
  const ua = (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent ?? "";
  if (/Windows/i.test(ua)) return "win32";
  if (/Mac OS X|Macintosh/i.test(ua)) return "darwin";
  if (/Linux|X11/i.test(ua)) return "linux";
  return "other";
}

export function appIdentity(): AppIdentity {
  const desktop = Platform.OS === "web" && !!desktopBridge();
  let os: string = Platform.OS;
  if (Platform.OS === "web") os = desktop ? desktopOs() : "web";
  return {
    product: productSlug(process.env.EXPO_PUBLIC_FROGG_ARTIFACT_PREFIX || "frogg-next"),
    version: APP_VERSION,
    os,
    platform: desktop ? "desktop" : Platform.OS,
  };
}

function enabled(): boolean {
  const st = useUsageStats.getState();
  return !!ENDPOINT && st.loaded && st.consent === "on" && !!st.installId;
}

/** An id-like value as an event property; anything that is not a short slug becomes `other`. */
export function usageSlug(value: string | null | undefined): string {
  const v = (value ?? "").toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,39}$/.test(v) ? v : "other";
}

/** Records one allowlisted event; a no-op unless statistics are on and a collector is set. */
export function track<E extends UsageEvent>(name: E["name"], props: E["props"]): void {
  if (!enabled()) return;
  queue.push({ name, at: usageEventTime(), props } as UsageEvent);
  if (queue.length >= 50) void flushUsageStats();
  else if (!timer) timer = setTimeout(() => void flushUsageStats(), FLUSH_MS);
}

/** Records `app_active` once per day. */
function trackActiveDay() {
  const day = new Date().toISOString().slice(0, 10);
  if (useUsageStats.getState().lastActiveDay === day) return;
  useUsageStats.setState({ lastActiveDay: day });
  save();
  track("app_active", {});
}

export async function flushUsageStats(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const { installId } = useUsageStats.getState();
  if (!enabled() || !installId || !ENDPOINT || queue.length === 0) return;
  const events = queue;
  queue = [];
  const batch = buildAppBatch(installId, appIdentity(), events);
  // Off-schema means something tried to record a value it should not; drop it, never send it.
  if (!batch) return;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    // Offline or refused: keep the events for the next flush, bounded.
    queue = [...events, ...queue].slice(-200);
    return;
  }
  if (useUsageStats.getState().consent !== "on") return;
  useUsageStats.setState((st) => ({
    sent: [...st.sent, { at: new Date().toISOString(), batch }].slice(-SENT_KEEP),
  }));
  save();
}

export function setUsageStatsConsent(on: boolean): void {
  if (on) {
    const st = useUsageStats.getState();
    useUsageStats.setState({
      consent: "on",
      prompted: true,
      installId: st.installId ?? newInstallId(),
    });
    save();
    track("app_opened", {});
    trackActiveDay();
    return;
  }
  queue = [];
  if (timer) clearTimeout(timer);
  timer = null;
  useUsageStats.setState({
    consent: "off",
    prompted: true,
    installId: null,
    lastActiveDay: null,
    sent: [],
  });
  save();
}

export function markUsageStatsPrompted(): void {
  if (useUsageStats.getState().prompted) return;
  useUsageStats.setState({ prompted: true });
  save();
}

/** App start: `app_opened`, the day's `app_active`, and a flush when the app is backgrounded. */
export function startUsageStats(): void {
  void usageStatsReady.then(() => {
    track("app_opened", {});
    trackActiveDay();
    return undefined;
  });
  const doc = (globalThis as { document?: Document }).document;
  doc?.addEventListener?.("visibilitychange", () => {
    if (doc.visibilityState === "hidden") void flushUsageStats();
  });
}
