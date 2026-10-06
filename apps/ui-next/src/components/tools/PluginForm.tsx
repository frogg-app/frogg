import type { PluginPanelContent, PluginSettingValue } from "@frogg/protocol/plugins/manifest";
import { useCallback, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { color, font } from "../../theme/tokens";
import { Button } from "../Button";
import { Select } from "../Select";
import { Toggle } from "../settings/controls";
import { T } from "../Text";

type PluginSettingField = Extract<PluginPanelContent, { kind: "form" }>["fields"][number];
type Values = Record<string, PluginSettingValue>;
export function PluginForm({
  fields,
  initial,
  submit,
  label,
}: {
  fields: PluginSettingField[];
  initial?: Values;
  submit: (values: Values) => Promise<void>;
  label: string;
}) {
  const [values, setValues] = useState<Values>(() =>
    Object.fromEntries(
      fields.map((f) => [
        f.key,
        initial?.[f.key] ?? f.default ?? (f.type === "boolean" ? false : ""),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const change = useCallback((key: string, value: PluginSettingValue) => {
    setValues((v) => ({ ...v, [key]: value }));
    setSaved(false);
  }, []);
  const save = useCallback(async () => {
    if (busy) return;
    const output = { ...values };
    for (const f of fields) {
      const v = output[f.key];
      if (f.required && (v === "" || v === null || v === undefined)) {
        setError(`${f.title} is required.`);
        return;
      }
      if (f.type === "number" && v !== "") {
        if (!Number.isFinite(Number(v))) {
          setError(`${f.title} must be a number.`);
          return;
        }
        output[f.key] = Number(v);
      }
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await submit(output);
      setSaved(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, values, fields, submit]);
  return (
    <View style={s.stack}>
      {fields.map((field) => (
        <Field key={field.key} field={field} value={values[field.key]} onChange={change} />
      ))}
      {error && <T style={s.error}>{error}</T>}
      {saved && <T>Saved.</T>}
      <Button label={busy ? "Saving…" : label} onPress={save} disabled={busy} />
    </View>
  );
}
function Field({
  field,
  value,
  onChange,
}: {
  field: PluginSettingField;
  value: PluginSettingValue;
  onChange: (key: string, value: PluginSettingValue) => void;
}) {
  const text = useCallback((v: string) => onChange(field.key, v), [field.key, onChange]);
  const toggle = useCallback((v: boolean) => onChange(field.key, v), [field.key, onChange]);
  let control = (
    <TextInput
      accessibilityLabel={field.title}
      value={String(value ?? "")}
      onChangeText={text}
      secureTextEntry={field.type === "secret"}
      autoCapitalize="none"
      keyboardType={field.type === "number" ? "numeric" : "default"}
      style={s.input}
    />
  );
  if (field.type === "boolean") control = <Toggle value={value === true} onChange={toggle} />;
  if (field.type === "select")
    control = (
      <Select
        value={String(value ?? "")}
        options={field.options ?? []}
        onChange={text}
        width="100%"
      />
    );
  return (
    <View style={s.stack}>
      <T>
        {field.title}
        {field.required ? " *" : ""}
      </T>
      {field.description && <T v="mono">{field.description}</T>}
      {control}
    </View>
  );
}
const s = StyleSheet.create({
  stack: { gap: 10 },
  input: {
    borderWidth: 1,
    borderColor: color.line2,
    padding: 10,
    color: color.text,
    fontFamily: font.body,
  },
  error: { color: color.coral },
});
