import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AlarmClock, X } from "lucide-react-native";
import { useToast } from "@/contexts/toast-api-context";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import { formatAutoResumeCountdown, formatAutoResumeDuration } from "./countdown";

const TICK_MS = 15_000;

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const handle = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(handle);
  }, [active]);
  return now;
}

/**
 * Countdown to the daemon's queued resume after a provider usage limit. Hover turns it into a
 * cancel affordance; pressing explains the resume and confirms before cancelling it.
 */
export function ComposerAutoResumeButton({
  serverId,
  agentId,
}: {
  serverId: string;
  agentId: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const resumeAt = useSessionStore(
    (state) => state.sessions[serverId]?.agents?.get(agentId)?.autoResume?.resumeAt ?? null,
  );
  const now = useNow(resumeAt !== null);
  const [hovered, setHovered] = useState(false);

  const countdown = resumeAt ? formatAutoResumeCountdown(resumeAt.getTime() - now) : "";

  const handlePress = useCallback(async () => {
    if (!resumeAt) return;
    const confirmed = await confirmDialog({
      title: t("composer.autoResume.dialog.title"),
      message: t("composer.autoResume.dialog.message", {
        countdown: formatAutoResumeDuration(resumeAt.getTime() - Date.now()),
        time: resumeAt.toLocaleString(undefined, {
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
        }),
      }),
      confirmLabel: t("composer.autoResume.dialog.confirm"),
      cancelLabel: t("composer.autoResume.dialog.keep"),
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) throw new Error(t("composer.autoResume.cancelFailed"));
      await client.cancelAgentAutoResume(agentId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("composer.autoResume.cancelFailed"));
    }
  }, [agentId, resumeAt, serverId, t, toast]);

  const handleButtonPress = useCallback(() => void handlePress(), [handlePress]);
  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);

  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.button,
      (hovered || pressed) && styles.buttonCancel,
    ],
    [hovered],
  );

  if (!resumeAt) return null;

  const Icon = hovered ? X : AlarmClock;
  const color = hovered ? styles.cancelColor.color : styles.mutedColor.color;
  return (
    <Pressable
      onPress={handleButtonPress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={pressableStyle}
      accessibilityRole="button"
      accessibilityLabel={t("composer.autoResume.accessibilityLabel", { countdown })}
      testID="composer-auto-resume"
    >
      <Icon size={14} color={color} />
      <Text
        style={[styles.label, hovered ? styles.cancelColor : styles.mutedColor]}
        numberOfLines={1}
      >
        {hovered ? t("composer.autoResume.cancel") : countdown}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  button: {
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius["2xl"],
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "transparent",
  },
  buttonCancel: {
    borderColor: theme.colors.destructive,
  },
  mutedColor: {
    color: theme.colors.foregroundMuted,
  },
  cancelColor: {
    color: theme.colors.destructive,
  },
  label: {
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
}));
