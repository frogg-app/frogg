import type { HostAddDeepLinkTarget } from "@frogg/protocol/host-add-deep-link";

/**
 * A `host/add` deep link that arrived from outside the app waits here until
 * the `/host-add` screen picks it up, mirroring the pending pairing offer.
 */
let pendingHostAdd: HostAddDeepLinkTarget | null = null;

export function setPendingHostAdd(target: HostAddDeepLinkTarget): void {
  pendingHostAdd = target;
}

export function takePendingHostAdd(): HostAddDeepLinkTarget | null {
  const target = pendingHostAdd;
  pendingHostAdd = null;
  return target;
}
