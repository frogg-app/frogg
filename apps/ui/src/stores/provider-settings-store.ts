import { create } from "zustand";

interface ProviderSettingsTarget {
  serverId: string;
  provider: string;
  overlayParentLayer?: number;
}

interface ProviderSettingsStoreState {
  serverId: string | null;
  provider: string | null;
  overlayParentLayer: number;
  visible: boolean;
  open: (target: ProviderSettingsTarget) => void;
  close: () => void;
}

/** Opens the provider settings sheet from outside the settings screen. */
export const useProviderSettingsStore = create<ProviderSettingsStoreState>()((set) => ({
  serverId: null,
  provider: null,
  overlayParentLayer: 0,
  visible: false,
  open: ({ serverId, provider, overlayParentLayer = 0 }) => {
    set({ serverId, provider, overlayParentLayer, visible: true });
  },
  close: () => {
    set({ visible: false });
  },
}));
