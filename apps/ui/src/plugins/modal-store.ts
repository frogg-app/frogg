import { create } from "zustand";
import type { PluginCatalogEntry, PluginInstalled } from "@frogg/client/internal/daemon-client";

/** `client` is this device; any other value is a host server id. */
export type PluginsTarget = { kind: "client" } | { kind: "host"; serverId: string };
export type PluginsTab = "installed" | "browse" | "repositories";

/** Second-level views inside the modal, reached from a row and left with the header back arrow. */
export type PluginsView =
  | { kind: "tabs" }
  | { kind: "settings"; pluginId: string; pluginName: string }
  | { kind: "developer" }
  | { kind: "consent"; mode: "install"; entry: PluginCatalogEntry }
  | { kind: "consent"; mode: "update"; plugin: PluginInstalled; addedCapabilities: string[] };

interface PluginsModalState {
  visible: boolean;
  target: PluginsTarget | null;
  tab: PluginsTab;
  view: PluginsView;
  open: (input?: { target?: PluginsTarget; view?: PluginsView }) => void;
  close: () => void;
  setTarget: (target: PluginsTarget) => void;
  setTab: (tab: PluginsTab) => void;
  setView: (view: PluginsView) => void;
}

export const usePluginsModalStore = create<PluginsModalState>((set) => ({
  visible: false,
  target: null,
  tab: "installed",
  view: { kind: "tabs" },
  open: (input) =>
    set((state) => ({
      visible: true,
      target: input?.target ?? state.target,
      view: input?.view ?? { kind: "tabs" },
    })),
  close: () => set({ visible: false, view: { kind: "tabs" } }),
  setTarget: (target) => set({ target, view: { kind: "tabs" } }),
  setTab: (tab) => set({ tab }),
  setView: (view) => set({ view }),
}));

export function openPluginsModal(input?: { target?: PluginsTarget; view?: PluginsView }): void {
  usePluginsModalStore.getState().open(input);
}
