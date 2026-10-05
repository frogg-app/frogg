import { ClientPluginChannel, type ClientPluginInitInfo } from "./channel";
import type { ClientPluginBridge } from "./bridge";
import { ClientPluginError } from "./errors";
import { sandboxDocument } from "./sandbox-bootstrap";

const BOOT_TIMEOUT_MS = 10_000;

/**
 * Starts one plugin in a `sandbox="allow-scripts"` iframe (opaque origin: no access to the app's
 * DOM, cookies, storage or IndexedDB), hands it a private MessagePort and activates it. The
 * background half is hidden and appended to the body; a view (`info.view`) is visible and goes
 * into `container`. Web only; the caller checks the platform.
 */
export async function startIframeSandbox(input: {
  code: string;
  info: ClientPluginInitInfo;
  bridge: ClientPluginBridge;
  onHandledChange: (methods: ReadonlySet<string>) => void;
  container?: HTMLElement;
}): Promise<{ channel: ClientPluginChannel; dispose: () => void }> {
  const view = Boolean(input.info.view);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.dataset.froggPlugin = input.info.id;
  if (view) {
    iframe.dataset.froggPluginView = input.info.view;
    iframe.title = input.info.view ?? "";
    iframe.style.cssText = "width:100%;height:100%;border:0;display:block;background:transparent";
  } else {
    iframe.setAttribute("aria-hidden", "true");
    iframe.setAttribute("tabindex", "-1");
    iframe.title = "";
    iframe.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
  }
  iframe.srcdoc = sandboxDocument(input.info.capabilities, { view });

  let onBoot: ((event: MessageEvent) => void) | null = null;
  const dispose = () => {
    if (onBoot) window.removeEventListener("message", onBoot);
    iframe.remove();
  };
  const port = await new Promise<MessagePort>((resolve, reject) => {
    const timer = setTimeout(() => {
      dispose();
      reject(new ClientPluginError("timeout", `${input.info.id}: sandbox did not start`));
    }, BOOT_TIMEOUT_MS);
    onBoot = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data as { t?: unknown } | null;
      if (!data || data.t !== "frogg-plugin-boot") return;
      clearTimeout(timer);
      if (onBoot) window.removeEventListener("message", onBoot);
      onBoot = null;
      const channel = new MessageChannel();
      iframe.contentWindow?.postMessage({ t: "frogg-plugin-port" }, "*", [channel.port2]);
      resolve(channel.port1);
    };
    window.addEventListener("message", onBoot);
    (input.container ?? document.body).appendChild(iframe);
  });
  const channel = new ClientPluginChannel(port, input.bridge, input.onHandledChange);
  try {
    await channel.activate(input.code, input.info);
  } catch (error) {
    channel.close();
    dispose();
    throw error;
  }
  return {
    channel,
    dispose: () => {
      channel.close();
      dispose();
    },
  };
}
