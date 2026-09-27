import { ArrowUp } from "lucide-react-native";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { useSoftStartChat } from "./use-soft-start-chat";
import { softEdge, softRaised, SOFT_PILL } from "./soft-surface";

const ThemedArrow = withUnistyles(ArrowUp);
const ThemedSpinner = withUnistyles(ActivityIndicator);
const ThemedInput = withUnistyles(TextInput);
const onAccentMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });
const placeholderMapping = (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundExtraMuted,
});

/**
 * The floating pill composer (ChatGPT/Perplexity iOS): one rounded field with a round accent send
 * button. Sending starts a real chat on `serverId` and opens it.
 */
export function SoftPillComposer({ serverId }: { serverId: string | null }) {
  const { t } = useTranslation();
  const { text, setText, submit, isPending } = useSoftStartChat(serverId);
  const canSend = Boolean(submit) && text.trim().length > 0 && !isPending;
  const send = useCallback(() => {
    if (canSend) submit?.();
  }, [canSend, submit]);
  // Enter sends on web/desktop; Shift+Enter keeps a newline.
  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData & { shiftKey?: boolean }>) => {
      if (event.nativeEvent.key !== "Enter" || event.nativeEvent.shiftKey) return;
      event.preventDefault();
      send();
    },
    [send],
  );
  return (
    <View style={styles.pill} testID="soft-home-composer">
      <ThemedInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        onKeyPress={handleKeyPress}
        placeholder={t("newChat.placeholder")}
        uniProps={placeholderMapping}
        multiline
        editable={!isPending}
        accessibilityLabel={t("newChat.placeholder")}
        testID="soft-home-composer-input"
      />
      <Pressable
        onPress={send}
        disabled={!canSend}
        style={canSend ? styles.send : sendDisabledStyle()}
        accessibilityRole="button"
        accessibilityLabel={t("newChat.send")}
        accessibilityState={{ disabled: !canSend, busy: isPending }}
        testID="soft-home-composer-send"
      >
        {isPending ? (
          <ThemedSpinner size="small" uniProps={onAccentMapping} />
        ) : (
          <ThemedArrow size={18} strokeWidth={2.4} uniProps={onAccentMapping} />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme, rt) => ({
  pill: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingLeft: 20,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: 28,
    ...softRaised(rt.themeName, "lg"),
    ...softEdge(rt.themeName),
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
    fontFamily: theme.fontFamily.ui,
    color: theme.colors.foreground,
    outlineStyle: "none",
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: SOFT_PILL,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.accent,
  },
  sendDisabled: {
    opacity: 0.35,
  },
}));

// Composed at render: reading style proxies at module scope is not allowed.
const sendDisabledStyle = () => [styles.send, styles.sendDisabled];
