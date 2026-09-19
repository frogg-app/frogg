import { create } from "zustand";

/**
 * Which provider surface the host renders: the full settings modal (accounts,
 * models, removal) or the model/status diagnostics sheet.
 */
export type ProviderSettingsSurface = "settings" | "diagnostics";

interface ProviderSettingsTarget {
  serverId: string;
  provider: string;
  overlayParentLayer?: number;
  surface?: ProviderSettingsSurface;
}

interface ProviderSettingsStoreState {
  serverId: string | null;
  provider: string | null;
  overlayParentLayer: number;
  surface: ProviderSettingsSurface;
  visible: boolean;
  open: (target: ProviderSettingsTarget) => void;
  close: () => void;
}

export const useProviderSettingsStore = create<ProviderSettingsStoreState>()((set) => ({
  serverId: null,
  provider: null,
  overlayParentLayer: 0,
  surface: "diagnostics",
  visible: false,
  open: ({ serverId, provider, overlayParentLayer = 0, surface = "diagnostics" }) => {
    set({ serverId, provider, overlayParentLayer, surface, visible: true });
  },
  close: () => {
    set({ visible: false });
  },
}));
