import { createContext, memo, useCallback, useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { ScissorsLineDashed } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useCleanCut } from "@/composer/clean-cut";
import { useToast } from "@/contexts/toast-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ICON_SIZE, type Theme } from "@/styles/theme";

/**
 * The agent a stream shows, so a turn footer can offer a clean cut on the same
 * account without every footer layer threading it through. Null in read-only
 * or detached streams, where no cut is offered.
 */
export const StreamCleanCutContext = createContext<{ serverId: string; agentId: string } | null>(
  null,
);

const ThemedScissors = withUnistyles(ScissorsLineDashed);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export const AssistantCleanCutButton = memo(function AssistantCleanCutButton() {
  const target = useContext(StreamCleanCutContext);
  if (!target) return null;
  return <CleanCutButton serverId={target.serverId} agentId={target.agentId} />;
});

const CleanCutButton = memo(function CleanCutButton({
  serverId,
  agentId,
}: {
  serverId: string;
  agentId: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const cleanCut = useCleanCut(serverId, agentId);
  const runCleanCut = cleanCut.run;

  const handlePress = useCallback(() => {
    void (async () => {
      // No target: a fresh conversation on the agent's current account and model.
      const error = await runCleanCut();
      if (error) toast.show(error, { variant: "error", testID: "assistant-clean-cut-error" });
    })();
  }, [runCleanCut, toast]);

  const label = cleanCut.pending ? t("composer.cleanCut.pending") : t("message.actions.cleanCut");
  const pressableStyle = useCallback(
    () => [styles.trigger, cleanCut.pending ? styles.triggerDisabled : null],
    [cleanCut.pending],
  );
  const tooltipContent = useMemo(
    () => (
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    ),
    [label],
  );

  if (!cleanCut.available) return null;

  return (
    <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <View style={styles.triggerSlot} collapsable={false}>
          <Pressable
            accessibilityLabel={label}
            accessibilityRole="button"
            disabled={cleanCut.pending}
            onPress={handlePress}
            style={pressableStyle}
            testID="assistant-clean-cut"
          >
            {({ hovered }) => (
              <ThemedScissors
                size={ICON_SIZE.sm}
                uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
              />
            )}
          </Pressable>
        </View>
      </TooltipTrigger>
      {tooltipContent}
    </Tooltip>
  );
});

const styles = StyleSheet.create((theme) => ({
  trigger: {
    padding: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  triggerDisabled: {
    opacity: theme.opacity[50],
  },
  triggerSlot: {
    alignSelf: "center",
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
