import { useCallback } from "react";
import { ProviderDiagnosticSheet } from "@/components/provider-diagnostic-sheet";
import { OverlayLayerProvider } from "@/lib/overlay-root";
import { ProviderSettingsModal } from "@/screens/settings/provider-settings-modal/provider-settings-modal";
import { useProviderSettingsStore } from "@/stores/provider-settings-store";

export function ProviderSettingsHost() {
  const serverId = useProviderSettingsStore((state) => state.serverId);
  const provider = useProviderSettingsStore((state) => state.provider);
  const surface = useProviderSettingsStore((state) => state.surface);
  const visible = useProviderSettingsStore((state) => state.visible);
  const overlayParentLayer = useProviderSettingsStore((state) => state.overlayParentLayer);
  const close = useProviderSettingsStore((state) => state.close);

  const handleClose = useCallback(() => {
    close();
  }, [close]);

  if (!serverId || !provider) {
    return null;
  }

  if (surface === "settings") {
    return (
      <OverlayLayerProvider layer={overlayParentLayer}>
        {visible ? (
          <ProviderSettingsModal
            key={`${serverId}:${provider}:settings`}
            serverId={serverId}
            providerId={provider}
            visible
            onClose={handleClose}
          />
        ) : null}
      </OverlayLayerProvider>
    );
  }

  return (
    <OverlayLayerProvider layer={overlayParentLayer}>
      <ProviderDiagnosticSheet
        key={`${serverId}:${provider}`}
        provider={provider}
        serverId={serverId}
        visible={visible}
        onClose={handleClose}
      />
    </OverlayLayerProvider>
  );
}
