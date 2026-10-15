import { Linking, Platform } from "react-native";
import { isPairUrl, offerPairLink } from "../../daemon/pairing";
import { useUi } from "../../ui-store";
import { openSheet } from "./state";
import { desktopBridge } from "../../desktop-bridge";

/**
 * Pairing links that open the app (`<scheme>://pair…` for any scheme in PAIR_SCHEMES, a
 * `pair.frogg.app/code/…` link, or a web page URL carrying `#offer=`) queue the
 * offer and open the confirm sheet in the Hosts tool. Nothing pairs without a press.
 */
function receive(url: string | null): void {
  if (!url || !isPairUrl(url)) return;
  offerPairLink(url);
  useUi.getState().setTool("hosts");
  openSheet({ kind: "confirm" });
}

let installed = false;
export function installPairLinks(): void {
  if (installed) return;
  installed = true;
  if (Platform.OS === "web") {
    const href = (globalThis as { location?: { href: string } }).location?.href ?? null;
    if (href && /#offer=|[?&]pair=/.test(href)) {
      const fromQuery = /[?&]pair=([^&#]+)/.exec(href)?.[1];
      receive(fromQuery ? decodeURIComponent(fromQuery) : href);
    }
    // The desktop shell hands over links the OS opened while the app was already running.
    desktopBridge()?.onOpenUrl(receive);
    return;
  }
  void Linking.getInitialURL().then(receive);
  Linking.addEventListener("url", (e) => receive(e.url));
}
