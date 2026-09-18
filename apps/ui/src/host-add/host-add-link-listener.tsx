import { useEffect } from "react";
import * as Linking from "expo-linking";
import { useRouter, type Href } from "expo-router";
import { brand } from "@frogg/branding";
import { parseHostAddDeepLink } from "@frogg/protocol/host-add-deep-link";
import { listenToDesktopEvent } from "@/desktop/electron/events";
import { getDesktopHost } from "@/desktop/host";
import { useStableEvent } from "@/hooks/use-stable-event";
import { setPendingHostAdd } from "./pending-host-add";

export const HOST_ADD_ROUTE = "/host-add" as Href;

/**
 * `<scheme>://host/add?type=directTcp&host=…&port=…` links: the registration
 * path for daemons that need no pairing, so a rollout tool can hand the app a
 * daemon it deployed instead of walking the user through Add a host by hand.
 * The link is parked and `/host-add` runs the add, so progress and failures
 * are shown rather than logged.
 */
export function HostAddLinkListener() {
  const router = useRouter();

  const openHostAdd = useStableEvent((rawUrl: string | null | undefined) => {
    if (!rawUrl) return;
    const target =
      parseHostAddDeepLink(rawUrl, brand.scheme) ?? parseHostAddDeepLink(rawUrl, "frogg");
    if (!target) return;
    setPendingHostAdd(target);
    router.push(HOST_ADD_ROUTE);
  });

  useEffect(() => {
    void Linking.getInitialURL()
      .then((url) => openHostAdd(url))
      .catch(() => undefined);
    const subscription = Linking.addEventListener("url", (event) => openHostAdd(event.url));
    return () => subscription.remove();
  }, [openHostAdd]);

  useEffect(() => {
    const host = getDesktopHost();
    const invoke = host?.invoke;
    if (typeof host?.events?.on !== "function" || typeof invoke !== "function") return;

    let disposed = false;
    let unlisten: (() => void) | null = null;
    const readUrl = (payload: unknown): string | null =>
      payload &&
      typeof payload === "object" &&
      typeof (payload as { url?: unknown }).url === "string"
        ? (payload as { url: string }).url
        : null;

    const connect = async () => {
      try {
        const dispose = await listenToDesktopEvent<unknown>("add-host", (payload) =>
          openHostAdd(readUrl(payload)),
        );
        if (disposed) {
          dispose();
          return;
        }
        unlisten = dispose;
        // Anything queued before the listener existed (a link that launched the app).
        const pending = await invoke("host_add_ready");
        if (!disposed) openHostAdd(readUrl(pending));
      } catch (error) {
        console.warn("[HostAdd] Desktop host-add bridge unavailable", error);
      }
    };
    void connect();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [openHostAdd]);

  return null;
}
