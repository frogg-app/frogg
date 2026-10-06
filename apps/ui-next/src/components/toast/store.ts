import { create } from "zustand";

/** `ok` is a plain confirmation; the others borrow the session status glyphs. */
export type ToastKind = "ok" | "done" | "error" | "needs" | "info";

export interface Toast {
  id: string;
  title: string;
  detail?: string;
  kind: ToastKind;
  action?: { label: string; onPress: () => void };
  /** Stays until dismissed instead of fading after a few seconds. */
  sticky?: boolean;
}

interface ToastState {
  toasts: Toast[];
}

export const useToasts = create<ToastState>(() => ({ toasts: [] }));

const LIFETIME_MS = 4200;
const MAX = 4;
let seq = 0;

/** Shows a transient toast and returns its id. Toasts are copies; the Inbox stays the record. */
export function toast(input: Omit<Toast, "id" | "kind"> & { kind?: ToastKind }): string {
  seq += 1;
  const id = `t${seq}`;
  const next: Toast = { kind: "ok", ...input, id };
  useToasts.setState((st) => ({ toasts: [...st.toasts, next].slice(-MAX) }));
  if (!next.sticky) setTimeout(() => dismissToast(id), LIFETIME_MS);
  return id;
}

export function dismissToast(id: string): void {
  useToasts.setState((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) }));
}

/** Error toast from a failed action: the message of whatever was thrown. */
export function toastError(title: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  toast({ title, detail, kind: "error" });
}
