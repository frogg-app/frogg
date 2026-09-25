import { brand } from "@frogg/branding";
import { parseDirectPairingDeepLink } from "@frogg/protocol/device-access";

/**
 * A pairing link the renderer's `/pair-offer` screen handles: the offer form
 * (`<scheme>://pair#offer=…`) or the direct form `<cli> pair` prints
 * (`<scheme>://pair/direct?…`), under the brand scheme or the literal `frogg`.
 */
export function isPairingOfferLink(value: string): boolean {
  if (
    parseDirectPairingDeepLink(value, brand.scheme) !== null ||
    parseDirectPairingDeepLink(value, "frogg") !== null
  ) {
    return true;
  }
  try {
    const url = new URL(value);
    return (
      (url.protocol === `${brand.scheme}:` || url.protocol === "frogg:") &&
      url.hostname === "pair" &&
      new URLSearchParams(url.hash.slice(1)).has("offer")
    );
  } catch {
    return false;
  }
}

export class PairingInbox {
  private pending: string | null = null;
  private listeners = new Map<number, (url: string) => void>();

  receive(url: string): boolean {
    if (!isPairingOfferLink(url)) return false;
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

export const pairingInbox = new PairingInbox();
