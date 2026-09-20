import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Volume2, VolumeOff } from "lucide-react-native";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import {
  buildWorkspaceVoiceAlertsKey,
  useWorkspaceVoiceAlertsEnabled,
  useWorkspaceVoiceAlertsStore,
} from "@/stores/workspace-voice-alerts-store";

interface ComposerVoiceAlertsToggleProps {
  serverId: string;
  workspaceId?: string | null;
}

/**
 * Spoken alerts stay off until a workspace asks for them, so the composer toolbar carries the
 * opt-in next to the agent controls. Hidden outside a workspace, where there is nothing to key on.
 */
export function ComposerVoiceAlertsToggle({
  serverId,
  workspaceId,
}: ComposerVoiceAlertsToggleProps) {
  const { t } = useTranslation();
  const key = buildWorkspaceVoiceAlertsKey(serverId, workspaceId);
  const enabled = useWorkspaceVoiceAlertsEnabled(serverId, workspaceId);
  const setEnabled = useWorkspaceVoiceAlertsStore((state) => state.setEnabled);

  const handlePress = useCallback(() => {
    setEnabled(key, !enabled);
  }, [enabled, key, setEnabled]);
  const accessibilityState = useMemo(() => ({ checked: enabled }), [enabled]);

  if (!key) return null;

  return (
    <AgentControlTrigger
      icon={enabled ? Volume2 : VolumeOff}
      iconColor={enabled ? styles.iconOn.color : styles.iconOff.color}
      surface="toolbar"
      label={t("spokenAlerts.workspaceToggle.label")}
      // Icon only, at every width: the toggle sits between the meter cluster and the
      // microphone now, and a word of text there pushes the two speech controls apart. The
      // label survives as the tooltip and the accessibility name.
      showToolbarLabel={false}
      onPress={handlePress}
      accessibilityLabel={
        enabled
          ? t("spokenAlerts.workspaceToggle.disable")
          : t("spokenAlerts.workspaceToggle.enable")
      }
      accessibilityState={accessibilityState}
      testID="composer-voice-alerts-toggle"
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  iconOn: {
    color: theme.colors.palette.blue[400],
  },
  iconOff: {
    color: theme.colors.foregroundMuted,
  },
}));
