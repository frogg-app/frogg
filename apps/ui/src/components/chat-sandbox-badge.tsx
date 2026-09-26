import { Lock } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const ThemedLock = withUnistyles(Lock);
const warningColorMapping = (theme: Theme) => ({ color: theme.colors.statusDotWarning });

/** Header pill on a chat: what the chat's agents may and may not do. */
export function ChatSandboxBadge() {
  const { t } = useTranslation();
  const rules = [
    t("chats.sandbox.readAnywhere"),
    t("chats.sandbox.writeChatOnly"),
    t("chats.sandbox.noShell"),
    t("chats.sandbox.noSkills"),
  ];
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <View
          style={styles.badge}
          testID="chat-sandbox-badge"
          accessibilityLabel={rules.join(". ")}
        >
          <ThemedLock size={12} uniProps={warningColorMapping} />
          <Text style={styles.label}>{t("chats.sandbox.badge")}</Text>
        </View>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" offset={8}>
        <View style={styles.rules}>
          {rules.map((rule) => (
            <Text key={rule} style={styles.rule}>
              {rule}
            </Text>
          ))}
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  label: {
    color: theme.colors.statusDotWarning,
    fontSize: theme.fontSize.sm,
  },
  rules: {
    gap: theme.spacing[1],
  },
  rule: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
