import { ArrowUp } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import { useSoftStartChat } from "./use-soft-start-chat";
import { softEdge, softRaised, SOFT_PILL } from "./soft-surface";

const ThemedArrow = withUnistyles(ArrowUp);
const ThemedSpinner = withUnistyles(ActivityIndicator);
const ThemedInput = withUnistyles(EditingTextInput);
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
  const inputRef = useRef<EditingTextInputHandle | null>(null);
  // The field is uncontrolled (IME safety); mirror draft changes made elsewhere into it: the
  // draft hydrating after mount, or being cleared once a chat starts.
  useEffect(() => {
    const input = inputRef.current;
    if (input && input.getText() !== text) input.replaceText(text);
  }, [text]);
  const canSend = Boolean(submit) && text.trim().length > 0 && !isPending;
  const send = useCallback(() => {
    if (canSend) submit?.();
  }, [canSend, submit]);
  // Web: Enter sends from the key event (the input's submit event does not fire reliably there);
  // native: the keyboard's send key.
  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (event.nativeEvent.key !== "Enter") return;
      event.preventDefault();
      send();
    },
    [send],
  );
  const sendState = useMemo(() => ({ disabled: !canSend, busy: isPending }), [canSend, isPending]);
  return (
    <View style={styles.pill} testID="soft-home-composer">
      <ThemedInput
        style={styles.input}
        ref={inputRef}
        initialValue={text}
        onChangeText={setText}
        onSubmitEditing={isWeb ? undefined : send}
        onKeyPress={isWeb ? handleKeyPress : undefined}
        returnKeyType="send"
        submitBehavior="submit"
        placeholder={t("newChat.placeholder")}
        uniProps={placeholderMapping}
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
        accessibilityState={sendState}
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
    alignItems: "center",
    gap: 8,
    paddingLeft: 20,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: 28,
    ...softRaised(rt.themeName, "md"),
    ...softEdge(rt.themeName),
  },
  input: {
    flex: 1,
    height: 40,
    fontSize: 16,
    fontFamily: theme.fontFamily.ui,
    color: theme.colors.foreground,
    outlineWidth: 0,
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
