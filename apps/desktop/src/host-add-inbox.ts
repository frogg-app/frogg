import { brand } from "@frogg/branding";
import { parseHostAddDeepLink } from "@frogg/protocol/host-add-deep-link";

export function isHostAddLink(value: string): boolean {
  return (
    parseHostAddDeepLink(value, brand.scheme) !== null ||
    parseHostAddDeepLink(value, "frogg") !== null
  );
}

/**
 * Holds a `host/add` deep link until a renderer asks for it, mirroring the
 * pairing inbox: the link can arrive from argv before any window exists.
 */
export class HostAddInbox {
  private pending: string | null = null;
  private listeners = new Map<number, (url: string) => void>();

  receive(url: string): boolean {
    if (!isHostAddLink(url)) return false;
    const listener = [...this.listeners.values()].at(-1);
    if (listener) listener(url);
    else this.pending = url;
    return true;
  }

  ready(id: number, listener: (url: string) => void): void {
    this.listeners.set(id, listener);
    if (this.pending) {
      const url = this.pending;
      this.pending = null;
      listener(url);
    }
  }

  remove(id: number): void {
    this.listeners.delete(id);
  }
}

export const hostAddInbox = new HostAddInbox();
