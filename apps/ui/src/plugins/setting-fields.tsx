import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import {
  SelectField,
  type SelectFieldDisplay,
  type SelectFieldOption,
} from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { pluginStyles as styles } from "./shared-styles";
import {
  changedFieldValues,
  initialFieldValues,
  type FieldValues,
  type PluginSettingField,
} from "./setting-values";

export type { FieldValues, PluginSettingField } from "./setting-values";

/**
 * Renders a plugin-declared field list (settings page and form panels) and submits changes.
 * Keeps the user's edits on failure; the caller passes the error.
 */
export function PluginFieldsForm({
  fields,
  values,
  submitLabel,
  pending,
  error,
  onSubmit,
  testID,
}: {
  fields: readonly PluginSettingField[];
  values: FieldValues | undefined;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  onSubmit: (changed: FieldValues, all: FieldValues) => void;
  testID?: string;
}): ReactElement {
  const initial = useMemo(() => initialFieldValues(fields, values), [fields, values]);
  const [current, setCurrent] = useState<FieldValues>(initial);
  const setField = useCallback(
    (key: string, value: unknown) => setCurrent((prev) => ({ ...prev, [key]: value })),
    [],
  );
  const submit = useCallback(
    () =>
      onSubmit(
        changedFieldValues(fields, initial, current),
        changedFieldValues(fields, {}, current),
      ),
    [current, fields, initial, onSubmit],
  );
  return (
    <View style={styles.list} testID={testID}>
      {fields.map((field) => (
        <FieldControl
          key={field.key}
          field={field}
          value={current[field.key]}
          onChange={setField}
          disabled={pending}
        />
      ))}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.actions}>
        <Button
          size="sm"
          onPress={submit}
          loading={pending}
          testID={`${testID ?? "fields"}-submit`}
        >
          {submitLabel}
        </Button>
      </View>
    </View>
  );
}

function FieldControl({
  field,
  value,
  onChange,
  disabled,
}: {
  field: PluginSettingField;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  disabled: boolean;
}): ReactElement {
  const handle = useCallback((next: unknown) => onChange(field.key, next), [field.key, onChange]);
  if (field.type === "boolean") {
    return (
      <View style={styles.rowHeader}>
        <View style={styles.rowTitleBlock}>
          <Text style={styles.title}>{field.title}</Text>
          {field.description ? <Text style={styles.meta}>{field.description}</Text> : null}
        </View>
        <Switch
          value={value === true}
          onValueChange={handle}
          disabled={disabled}
          accessibilityLabel={field.title}
          testID={`plugin-field-${field.key}`}
        />
      </View>
    );
  }
  if (field.type === "select") {
    return <SelectControl field={field} value={value} onChange={handle} disabled={disabled} />;
  }
  return (
    <Field label={field.title} hint={field.description}>
      <FormTextInput
        size="sm"
        initialValue={value === null || value === undefined ? "" : String(value)}
        onChangeText={handle}
        secureTextEntry={field.type === "secret"}
        keyboardType={field.type === "number" ? "numeric" : "default"}
        editable={!disabled}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={field.title}
        testID={`plugin-field-${field.key}`}
      />
    </Field>
  );
}

function SelectControl({
  field,
  value,
  onChange,
  disabled,
}: {
  field: PluginSettingField;
  value: unknown;
  onChange: (value: string) => void;
  disabled: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const options = useMemo<SelectFieldOption<string>[]>(
    () =>
      (field.options ?? []).map((option) => ({
        id: option.value,
        value: option.value,
        label: option.label,
      })),
    [field.options],
  );
  const selected = typeof value === "string" ? value : null;
  const display = useMemo<SelectFieldDisplay | null>(() => {
    const option = options.find((entry) => entry.value === selected);
    return option ? { label: option.label } : null;
  }, [options, selected]);
  return (
    <SelectField
      label={field.title}
      hint={field.description}
      value={selected}
      selectedDisplay={display}
      options={options}
      onChange={onChange}
      placeholder={t("plugins.fields.choose")}
      emptyText={t("plugins.fields.noOptions")}
      disabled={disabled}
      triggerTestID={`plugin-field-${field.key}`}
    />
  );
}
