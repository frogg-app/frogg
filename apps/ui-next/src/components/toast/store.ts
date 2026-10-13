import { create } from "zustand";
import { usePrefs } from "../../prefs";
import { toastMs } from "../../theme/tokens";
import { recordToast } from "./history";
import { isNative, nativeMotionOn } from "../nativeMotion";

/** `ok` is a plain confirmation; the others borrow the session status glyphs. */
export type ToastKind = "ok" | "done" | "error" | "needs" | "info";

/** Visual direction: `bracket` chamfered card, `hud` terminal frame, `facet` mesh edge. */
export type ToastVariant = "bracket" | "hud" | "facet";

export interface Toast {
  id: string;
  title: string;
  detail?: string;
  kind: ToastKind;
  action?: { label: string; onPress: () => void };
  /** Stays until dismissed instead of fading after a few seconds. */
  sticky?: boolean;
  /** The action leaves the toast up (e.g. Retry on a condition that may persist). */
  keepOnAction?: boolean;
  /** Where it came from (a session id), shown in the HUD header. */
  source?: string;
  /** Epoch ms it was raised. */
  at: number;
  /** Playing its exit; removed once that finishes. */
  leaving?: boolean;
  /** Ms on screen before it fades (the drain line runs this long); unset when sticky. */
  life?: number;
}

interface ToastState {
  toasts: Toast[];
  /** Pointer is over the stack: timers and drain lines hold. */
  paused: boolean;
  /** Explicit override (the lab); null follows the `toastStyle` preference. */
  variant: ToastVariant | null;
}

export const DEFAULT_TOAST_VARIANT: ToastVariant = "bracket";

export const useToasts = create<ToastState>(() => ({
  toasts: [],
  paused: false,
  variant: null,
}));

export const LIFETIME_MS = toastMs.life;

/** On-screen time from Settings → Notifications; 0 means stay until dismissed. */
function lifetime(): number {
  const sec = usePrefs.getState().toastSeconds;
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec < 0) return LIFETIME_MS;
  return sec * 1000;
}
const MAX = 4;
let seq = 0;

interface Timer {
  left: number;
  since: number;
  handle: ReturnType<typeof setTimeout> | null;
}
const timers = new Map<string, Timer>();

function arm(id: string, t: Timer) {
  t.since = Date.now();
  t.handle = setTimeout(() => dismissToast(id), t.left);
}

interface MQ {
  document?: unknown;
  matchMedia?: (q: string) => { matches: boolean };
}
/** Exit animations run unless the OS asks for reduced motion (web: matchMedia, native: AccessibilityInfo). */
export function toastsAnimate(): boolean {
  const g = globalThis as MQ;
  if (isNative) return nativeMotionOn();
  if (!g.document) return false;
  return !g.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Shows a transient toast and returns its id. Every toast is also kept in the Inbox history. */
export function toast(
  input: Omit<Toast, "id" | "kind" | "at" | "leaving" | "life"> & { kind?: ToastKind },
): string {
  seq += 1;
  const id = `t${seq}`;
  const life = lifetime();
  const next: Toast = { kind: "ok", ...input, id, at: Date.now() };
  if (!life) next.sticky = true;
  if (!next.sticky) next.life = life;
  useToasts.setState((st) => ({ toasts: [...st.toasts, next] }));
  recordToast(next);
  if (next.life) {
    const t: Timer = { left: next.life, since: 0, handle: null };
    timers.set(id, t);
    if (!useToasts.getState().paused) arm(id, t);
  }
  // Over the cap the oldest plays its exit rather than vanishing.
  const live = useToasts.getState().toasts.filter((x) => !x.leaving);
  for (const old of live.slice(0, Math.max(0, live.length - MAX))) dismissToast(old.id);
  return id;
}

/** Live copy change on a toast already up (e.g. an offline timer); not re-recorded. */
export function updateToast(id: string, patch: Partial<Pick<Toast, "title" | "detail">>): void {
  useToasts.setState((st) => ({
    toasts: st.toasts.map((x) => (x.id === id ? { ...x, ...patch } : x)),
  }));
}

/** True while the toast is still up and not playing its exit. */
export function toastShowing(id: string): boolean {
  return useToasts.getState().toasts.some((x) => x.id === id && !x.leaving);
}

export function dismissToast(id: string): void {
  const t = timers.get(id);
  if (t?.handle) clearTimeout(t.handle);
  timers.delete(id);
  const cur = useToasts.getState().toasts.find((x) => x.id === id);
  if (!cur || cur.leaving) return;
  if (!toastsAnimate()) {
    remove(id);
    return;
  }
  useToasts.setState((st) => ({
    toasts: st.toasts.map((x) => (x.id === id ? { ...x, leaving: true } : x)),
  }));
  // Card fades on `out`; its slot collapses on `reflow`, so keep it until both finish.
  setTimeout(() => remove(id), Math.max(toastMs.out, toastMs.reflow));
}

function remove(id: string) {
  useToasts.setState((st) => {
    const toasts = st.toasts.filter((x) => x.id !== id);
    return { toasts, paused: toasts.length ? st.paused : false };
  });
  if (useToasts.getState().toasts.length === 0) resumeToasts();
}

/** Holds every auto-dismiss timer (pointer over the stack). */
export function pauseToasts(): void {
  if (useToasts.getState().paused) return;
  const now = Date.now();
  for (const t of timers.values()) {
    if (!t.handle) continue;
    clearTimeout(t.handle);
    t.handle = null;
    t.left = Math.max(0, t.left - (now - t.since));
  }
  useToasts.setState({ paused: true });
}

export function resumeToasts(): void {
  for (const [id, t] of timers) if (!t.handle) arm(id, t);
  if (useToasts.getState().paused) useToasts.setState({ paused: false });
}

/** Lab hook: switch the visual direction live; null goes back to the preference. */
export function setToastVariant(variant: ToastVariant | null): void {
  useToasts.setState({ variant });
}

/** Error toast from a failed action: the message of whatever was thrown. */
export function toastError(title: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  toast({ title, detail, kind: "error" });
}

/** Drops every toast at once (no exit), e.g. the lab's Clear. */
export function clearToasts(): void {
  for (const t of timers.values()) if (t.handle) clearTimeout(t.handle);
  timers.clear();
  useToasts.setState({ toasts: [], paused: false });
}
