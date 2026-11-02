import { CornerDownLeft, X } from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import { jumpToPath, pinTab } from "../../daemon/files";
import { color, font, motion, web } from "../../theme/tokens";
import { useUi } from "../../ui-store";
import { T } from "../Text";

/**
 * The Files tab's "go to" field: type a folder (`~/projects`, `/etc`, `C:/Users/Desktop`, or a
 * path relative to the current folder) and Enter roots the tree there. A file path opens it.
 */
export function FilePathField({ initial, onClose }: { initial: string; onClose: () => void }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await jumpToPath(value);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (res.file) {
      useUi.getState().openFile(res.file);
      pinTab(res.file);
    }
    onClose();
  }, [busy, value, onClose]);
  const submit = useCallback(() => void go(), [go]);
  const onKey = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (e.nativeEvent.key === "Escape") onClose();
    },
    [onClose],
  );
  const change = useCallback((v: string) => {
    setValue(v);
    setError(null);
  }, []);
  return (
    <View style={motion.enter}>
      <View style={[st.field, error ? st.fieldError : null]}>
        <TextInput
          accessibilityLabel="Go to folder"
          placeholder="~/projects, /etc or C:/Users/Desktop"
          placeholderTextColor={color.faint}
          value={value}
          onChangeText={change}
          onKeyPress={onKey}
          onSubmitEditing={submit}
          selectTextOnFocus
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="go"
          style={st.input}
        />
        <Pressable onPress={submit} accessibilityLabel="Go" hitSlop={6} disabled={busy}>
          {({ hovered }) => (
            <CornerDownLeft size={13} color={hovered && !busy ? color.text : color.faint} />
          )}
        </Pressable>
        <Pressable onPress={onClose} accessibilityLabel="Close go to folder" hitSlop={6}>
          <X size={13} color={color.faint} />
        </Pressable>
      </View>
      {error && (
        <T v="mono" style={st.error} numberOfLines={2}>
          {error}
        </T>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: color.line2,
    backgroundColor: color.bg,
    ...web({ transition: "border-color 120ms ease-out" }),
  },
  fieldError: { borderColor: color.coral },
  input: {
    flex: 1,
    paddingVertical: 8,
    color: color.text,
    fontFamily: font.mono,
    fontSize: 12,
    ...web({ outlineStyle: "none" }),
  },
  error: { color: color.coral, fontSize: 11, paddingHorizontal: 16, paddingBottom: 8 },
});
