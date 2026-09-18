import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import { useHostFeature } from "@/runtime/host-features";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { buildProviderDefinitions } from "@/utils/provider-definitions";
import { getProviderIcon } from "@/components/provider-icons";
import { confirmDialog } from "@/utils/confirm-dialog";
import { filterSelectableModels } from "@/provider-selection/model-catalog";
import { getProviderStatus, type StatusTone } from "@/screens/settings/providers-section";
import type { Theme } from "@/styles/theme";
import { ModelsSection } from "./models-section";
import { AccountsSection } from "./accounts-section";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const loadingSpinnerMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const providerIconMapping = (theme: Theme) => ({
  size: theme.iconSize.md,
  color: theme.colors.foreground,
});

function statusDotToneStyle(tone: StatusTone) {
  switch (tone) {
    case "success":
      return styles.statusDotSuccess;
    case "warning":
      return styles.statusDotWarning;
    case "danger":
      return styles.statusDotDanger;
    default:
      return styles.statusDotMuted;
  }
}

export interface ProviderSettingsModalProps {
  serverId: string;
  providerId: string;
  visible: boolean;
  onClose: () => void;
}

export function ProviderSettingsModal({
  serverId,
  providerId,
  visible,
  onClose,
}: ProviderSettingsModalProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const supportsProviderRemoval = useHostFeature(serverId, "providerRemoval");
  const { entries } = useProvidersSnapshot(serverId);
  const { patchConfig } = useDaemonConfig(serverId);
  const [isRemoving, setIsRemoving] = useState(false);
  const removingRef = useRef(false);

  const providerDefinitions = useMemo(() => buildProviderDefinitions(entries), [entries]);
  const def = useMemo(
    () => providerDefinitions.find((candidate) => candidate.id === providerId),
    [providerDefinitions, providerId],
  );
  const entry = useMemo(
    () => entries?.find((candidate) => candidate.provider === providerId),
    [entries, providerId],
  );

  const enabled = entry?.enabled ?? true;
  const modelCount = filterSelectableModels(entry?.models ?? null)?.length ?? 0;
  const providerStatus = entry ? getProviderStatus(entry.status, enabled, modelCount, t) : null;
  const canRemove = supportsProviderRemoval && entry?.source === "custom";

  const sheetHeader = useMemo<SheetHeader>(
    () => ({
      title: def?.label ?? "",
    }),
    [def?.label],
  );

  const handleRemove = useCallback(async () => {
    if (!def || removingRef.current) return;
    removingRef.current = true;
    setIsRemoving(true);
    try {
      const confirmed = await confirmDialog({
        title: t("settings.providers.remove.confirmTitle", {
          name: def.label,
        }),
        message: t("settings.providers.remove.confirmMessage"),
        confirmLabel: t("settings.providers.remove.confirm"),
        destructive: true,
      });
      if (!confirmed) {
        return;
      }

      await patchConfig({ removeProviders: [providerId] });
      onClose();
    } catch (error) {
      Alert.alert(
        t("settings.providers.remove.errorTitle"),
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      removingRef.current = false;
      setIsRemoving(false);
    }
  }, [def, onClose, patchConfig, providerId, t]);

  const ProviderIcon = def ? getProviderIcon(def.id) : null;
  const ThemedProviderIcon = useMemo(
    () => (ProviderIcon ? withUnistyles(ProviderIcon) : null),
    [ProviderIcon],
  );

  if (!def || !ThemedProviderIcon) {
    return null;
  }

  return (
    <AdaptiveModalSheet
      visible={visible}
      header={sheetHeader}
      onClose={onClose}
      testID="provider-settings-modal"
      desktopMaxWidth={520}
    >
      <View style={styles.body}>
        <View style={styles.headerRow} testID="provider-settings-modal-header">
          <ThemedProviderIcon uniProps={providerIconMapping} />
          <View style={styles.headerText}>
            <Text style={settingsStyles.rowTitle} numberOfLines={1}>
              {def.label}
            </Text>
            {providerStatus ? (
              <View style={styles.statusRow}>
                {providerStatus.tone === "loading" ? (
                  <ThemedLoadingSpinner size={10} uniProps={loadingSpinnerMapping} />
                ) : (
                  <View style={[styles.statusDot, statusDotToneStyle(providerStatus.tone)]} />
                )}
                <Text style={styles.statusLabel}>{providerStatus.label}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={isCompact ? styles.sectionCompact : styles.section}>
          <ModelsSection serverId={serverId} providerId={providerId} />
        </View>

        <View style={isCompact ? styles.sectionCompact : styles.section}>
          <AccountsSection serverId={serverId} providerId={providerId} />
        </View>

        {canRemove ? (
          <View style={styles.dangerZone} testID="provider-settings-modal-danger-zone">
            <Text style={styles.dangerZoneTitle}>
              {t("settings.providers.settingsModal.dangerZoneTitle")}
            </Text>
            <Button
              variant="destructive"
              onPress={handleRemove}
              disabled={isRemoving}
              testID="provider-settings-modal-uninstall-button"
            >
              {isRemoving
                ? t("settings.providers.actions.removing")
                : t("settings.providers.settingsModal.uninstallTitle")}
            </Button>
          </View>
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[4],
    paddingBottom: theme.spacing[6],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusDotSuccess: {
    backgroundColor: theme.colors.statusSuccess,
  },
  statusDotWarning: {
    backgroundColor: theme.colors.statusWarning,
  },
  statusDotDanger: {
    backgroundColor: theme.colors.statusDanger,
  },
  statusDotMuted: {
    backgroundColor: theme.colors.foregroundMuted,
  },
  statusLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  section: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing[4],
  },
  sectionCompact: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing[3],
  },
  dangerZone: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing[4],
    gap: theme.spacing[3],
  },
  dangerZoneTitle: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
}));
