import { useCallback } from "react";
import { OverlayLayerProvider } from "@/lib/overlay-root";
import { ProviderSettingsModal } from "@/screens/settings/provider-settings-modal/provider-settings-modal";
import { useProviderSettingsStore } from "@/stores/provider-settings-store";

export function ProviderSettingsHost() {
  const serverId = useProviderSettingsStore((state) => state.serverId);
  const provider = useProviderSettingsStore((state) => state.provider);
  const visible = useProviderSettingsStore((state) => state.visible);
  const overlayParentLayer = useProviderSettingsStore((state) => state.overlayParentLayer);
  const close = useProviderSettingsStore((state) => state.close);

  const handleClose = useCallback(() => {
    close();
  }, [close]);

  if (!serverId || !provider) {
    return null;
  }

  return (
    <OverlayLayerProvider layer={overlayParentLayer}>
      {visible ? (
        <ProviderSettingsModal
          key={`${serverId}:${provider}`}
          serverId={serverId}
          providerId={provider}
          visible
          onClose={handleClose}
        />
      ) : null}
    </OverlayLayerProvider>
  );
}
