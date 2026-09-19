import { isNative } from "@/constants/platform";

export interface ConfirmDialogInput {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface ConfirmDialogRequest {
  /** Stable identity, so the host can settle exactly the request it rendered. */
  id: number;
  input: ConfirmDialogInput;
}

interface PendingConfirmDialog extends ConfirmDialogRequest {
  resolve: (confirmed: boolean) => void;
  /** The web element that had focus when the question was asked, restored on close. */
  returnFocusTo: HTMLElement | null;
}

type Listener = () => void;

/**
 * Confirmations are asked through a module-level queue rather than a platform dialog, so the
 * question renders in Frogg's own modal on desktop, web and mobile alike.
 *
 * Concurrency: a second request raised while one is open is **serialised**, not dropped. The
 * queue keeps every pending request in arrival order and only the head is rendered; each one is
 * answered in turn. Callers therefore always get their own answer, never a stale neighbour's.
 *
 * A request raised before `ConfirmDialogHost` mounts simply sits at the head of the queue; the
 * host renders it as soon as it subscribes, because the queue lives outside React.
 */
const queue: PendingConfirmDialog[] = [];
const listeners = new Set<Listener>();

let nextRequestId = 1;
let activeSnapshot: ConfirmDialogRequest | null = null;

function captureActiveWebElement(): HTMLElement | null {
  if (isNative) {
    return null;
  }
  const activeElement = (globalThis as { document?: Document }).document
    ?.activeElement as HTMLElement | null;
  // Drop focus from the invoking control while the question is up, so Enter answers the modal
  // instead of pressing the button underneath it a second time.
  activeElement?.blur?.();
  return activeElement ?? null;
}

function restoreWebFocus(element: HTMLElement | null): void {
  if (isNative || !element) {
    return;
  }
  const ownerDocument = (globalThis as { document?: Document }).document;
  // A node removed while the modal was up must not steal focus back into a detached tree.
  if (ownerDocument && !ownerDocument.contains(element)) {
    return;
  }
  element.focus?.();
}

function syncSnapshot(): void {
  const head = queue[0];
  if (!head) {
    activeSnapshot = null;
  } else if (activeSnapshot?.id !== head.id) {
    activeSnapshot = { id: head.id, input: head.input };
  }
}

function emit(): void {
  syncSnapshot();
  // Copied first: a listener may unsubscribe while being notified.
  const notified = Array.from(listeners);
  for (const listener of notified) {
    listener();
  }
}

export function subscribeConfirmDialogRequests(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The request the host should render, or `null` when nothing is pending. */
export function getActiveConfirmDialogRequest(): ConfirmDialogRequest | null {
  return activeSnapshot;
}

/** Answer the rendered request and hand the modal to the next queued one, if any. */
export function settleConfirmDialogRequest(id: number, confirmed: boolean): void {
  const index = queue.findIndex((pending) => pending.id === id);
  if (index === -1) {
    return;
  }
  const [settled] = queue.splice(index, 1);
  emit();
  restoreWebFocus(settled.returnFocusTo);
  settled.resolve(confirmed);
}

export function confirmDialog(input: ConfirmDialogInput): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    queue.push({
      id: nextRequestId++,
      input,
      resolve,
      returnFocusTo: captureActiveWebElement(),
    });
    emit();
  });
}

export const __private__ = {
  /** Test-only: drop every queued request without answering it. */
  reset(): void {
    queue.length = 0;
    activeSnapshot = null;
    listeners.clear();
  },
  pendingCount(): number {
    return queue.length;
  },
};
