/**
 * The two sub-sheets the provider settings sheet opens over itself: adding a
 * custom model id, and reading the provider's diagnostic report.
 */

import * as Clipboard from "expo-clipboard";
import { Copy, RotateCw } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, type PressableStateCallbackType, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ScrollableCodeSurface, SurfaceCard } from "@/components/ui/scrollable-code-surface";
import { isWeb } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { AgentProvider } from "@frogg/protocol/agent-types";

const ThemedCopy = withUnistyles(Copy, (theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.foregroundMuted,
}));
const ThemedRotateCw = withUnistyles(RotateCw, (theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.foregroundMuted,
}));
const ThemedSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

const ADD_SNAP_POINTS = ["40%"];
const DIAGNOSTIC_SNAP_POINTS = ["50%", "85%"];

export function AddCustomModelSheet({
  provider,
  serverId,
  visible,
  onClose,
  refresh,
}: {
  provider: string;
  serverId: string;
  visible: boolean;
  onClose: () => void;
  refresh: (providers?: AgentProvider[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const additionalModels = useMemo(
    () => config?.providers?.[provider]?.additionalModels ?? [],
    [config?.providers, provider],
  );
  const trimmed = input.trim();
  const canAdd = trimmed.length > 0 && !additionalModels.some((model) => model.id === trimmed);

  useEffect(() => {
    if (!visible) {
      setInput("");
      setError(null);
    }
  }, [visible]);

  const handleAdd = useCallback(() => {
    if (!canAdd) return;
    setError(null);
    setSaving(true);
    void patchConfig({
      providers: {
        [provider]: {
          additionalModels: [...additionalModels, { id: trimmed, label: trimmed }],
        },
      },
    })
      .then(() => refresh([provider]))
      .then(() => onClose())
      .catch((err) => {
        setError(err instanceof Error ? err.message : t("settings.providers.models.failedToSave"));
      })
      .finally(() => setSaving(false));
  }, [additionalModels, canAdd, onClose, patchConfig, provider, refresh, t, trimmed]);

  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.providers.models.addCustomTitle") }),
    [t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      desktopMaxWidth={420}
      snapPoints={ADD_SNAP_POINTS}
      testID="add-custom-model-sheet"
    >
      <View style={styles.formGroup}>
        <Text style={styles.formLabel}>{t("settings.providers.models.modelId")}</Text>
        <AdaptiveTextInput
          initialValue={input}
          resetKey={`add-custom-${visible}`}
          onChangeText={setInput}
          onSubmitEditing={handleAdd}
          placeholder={t("settings.providers.models.modelIdPlaceholder")}
          placeholderTextColor={styles.placeholderColor.color}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          // @ts-expect-error - outlineStyle is web-only
          style={[styles.formInput, isWeb && { outlineStyle: "none" }]}
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <View style={styles.formActions}>
          <Button variant="secondary" size="sm" onPress={onClose} disabled={saving}>
            {t("common.actions.cancel")}
          </Button>
          <Button variant="default" size="sm" onPress={handleAdd} disabled={!canAdd || saving}>
            {saving ? t("settings.providers.models.adding") : t("settings.providers.models.add")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

export function ProviderDiagnosticReportSheet({
  provider,
  serverId,
  visible,
  onClose,
}: {
  provider: string;
  serverId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useHostRuntimeClient(serverId);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchDiagnostic = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      const result = await client.getProviderDiagnostic(provider);
      setDiagnostic(result.diagnostic);
    } catch (err) {
      setDiagnostic(
        err instanceof Error ? err.message : t("settings.providers.diagnostic.failedToFetch"),
      );
    } finally {
      setLoading(false);
    }
  }, [client, provider, t]);

  useEffect(() => {
    if (visible) {
      void fetchDiagnostic();
    } else {
      setDiagnostic(null);
    }
  }, [visible, fetchDiagnostic]);

  const refreshButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.iconButton,
      (Boolean(hovered) || pressed) && styles.iconButtonHovered,
      loading ? styles.disabled : null,
    ],
    [loading],
  );

  const handleRefreshPress = useCallback(() => {
    void fetchDiagnostic();
  }, [fetchDiagnostic]);

  const copyButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.iconButton,
      (Boolean(hovered) || pressed) && Boolean(diagnostic) && styles.iconButtonHovered,
      diagnostic ? null : styles.disabled,
    ],
    [diagnostic],
  );

  const handleCopyPress = useCallback(() => {
    if (!diagnostic) return;
    void Clipboard.setStringAsync(diagnostic)
      .then(() => toast.copied(t("settings.providers.diagnostic.copyLabel")))
      .catch(() => toast.error(t("settings.providers.diagnostic.copyFailed")));
  }, [diagnostic, t, toast]);

  const header = useMemo<SheetHeader>(
    () => ({
      title: t("settings.providers.diagnostic.title"),
      actions: (
        <View style={styles.headerActions}>
          <Pressable
            onPress={handleCopyPress}
            disabled={!diagnostic}
            hitSlop={8}
            style={copyButtonStyle}
            accessibilityRole="button"
            accessibilityLabel={t("settings.providers.diagnostic.copyAccessibility")}
          >
            <ThemedCopy />
          </Pressable>
          <Pressable
            onPress={handleRefreshPress}
            disabled={loading}
            hitSlop={8}
            style={refreshButtonStyle}
            accessibilityRole="button"
            accessibilityLabel={
              loading
                ? t("settings.providers.diagnostic.refreshingAccessibility")
                : t("settings.providers.diagnostic.refreshAccessibility")
            }
          >
            {loading ? <ThemedSpinner size={16} /> : <ThemedRotateCw />}
          </Pressable>
        </View>
      ),
    }),
    [
      copyButtonStyle,
      diagnostic,
      handleCopyPress,
      handleRefreshPress,
      loading,
      refreshButtonStyle,
      t,
    ],
  );

  let body: React.ReactNode;
  if (loading && !diagnostic) {
    body = (
      <SurfaceCard key={visible ? "visible" : "hidden"}>
        <View style={styles.codeBlockLoading}>
          <ThemedSpinner size="small" />
          <Text style={styles.mutedText}>{t("settings.providers.diagnostic.running")}</Text>
        </View>
      </SurfaceCard>
    );
  } else if (diagnostic) {
    body = (
      <ScrollableCodeSurface key={visible ? "visible" : "hidden"} maxHeight={480}>
        {diagnostic}
      </ScrollableCodeSurface>
    );
  } else {
    body = (
      <SurfaceCard key={visible ? "visible" : "hidden"}>
        <View style={styles.codeBlockLoading}>
          <Text style={styles.mutedText}>{t("settings.providers.diagnostic.none")}</Text>
        </View>
      </SurfaceCard>
    );
  }

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      snapPoints={DIAGNOSTIC_SNAP_POINTS}
      scrollable={false}
      testID="provider-diagnostic-sheet"
    >
      {body}
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  placeholderColor: {
    color: theme.colors.foregroundMuted,
  },
  mutedText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
  errorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
  formGroup: {
    gap: theme.spacing[3],
  },
  formLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  formInput: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: theme.fontSize.base,
  },
  formActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  disabled: {
    opacity: 0.5,
  },
  codeBlockLoading: {
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));
