import { Linking, Platform } from "react-native";
import { isPairUrl, offerPairLink } from "../../daemon/pairing";
import { useUi } from "../../ui-store";
import { openSheet } from "./state";

/**
 * Pairing links that open the app (`frogg-next://pair…`, `frogg://pair…`, a
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
    return;
  }
  void Linking.getInitialURL().then(receive);
  Linking.addEventListener("url", (e) => receive(e.url));
}
