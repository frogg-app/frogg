import { useCallback, useState } from "react";
import { StyleSheet, TextInput } from "react-native";
import { color, font, web } from "../../theme/tokens";
import { Button } from "../Button";
import { T } from "../Text";
import { Dialog } from "./Dialog";

export interface PromptSpec {
  eyebrow?: string;
  title: string;
  label?: string;
  initial?: string;
  placeholder?: string;
  action: string;
  /** Resolves to an error message to show, or null to close. */
  run: (value: string) => Promise<string | null>;
}

/** A one-field dialog (rename, new file, new folder). `ask(spec)` opens it. */
export function usePrompt() {
  const [spec, setSpec] = useState<PromptSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ask = useCallback((next: PromptSpec) => {
    setSpec(next);
    setValue(next.initial ?? "");
    setError(null);
  }, []);
  const close = useCallback(() => {
    if (!busy) setSpec(null);
  }, [busy]);
  const go = useCallback(() => {
    if (!spec || !value.trim() || busy) return;
    setBusy(true);
    setError(null);
    void spec
      .run(value.trim())
      .then((err) => (err ? setError(err) : setSpec(null)))
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setBusy(false));
  }, [spec, value, busy]);
  const dialog = (
    <Dialog
      open={!!spec}
      onClose={close}
      eyebrow={spec?.eyebrow}
      title={spec?.title ?? ""}
      footer={
        <>
          <Button label="Cancel" onPress={close} />
          <Button
            label={spec?.action ?? "OK"}
            kind="primary"
            onPress={go}
            disabled={busy || !value.trim()}
          />
        </>
      }
    >
      {spec?.label && <T v="label">{spec.label}</T>}
      <TextInput
        value={value}
        onChangeText={setValue}
        onSubmitEditing={go}
        placeholder={spec?.placeholder}
        placeholderTextColor={color.faint}
        autoFocus
        selectTextOnFocus
        style={s.input}
      />
      {error && (
        <T v="mono" style={s.error}>
          {error}
        </T>
      )}
    </Dialog>
  );
  return { ask, dialog };
}

const s = StyleSheet.create({
  input: {
    height: 36,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: color.line2,
    backgroundColor: color.bg2,
    color: color.text,
    fontFamily: font.mono,
    fontSize: 13,
    ...web({ outlineStyle: "none" }),
  },
  error: { color: color.coral },
});
