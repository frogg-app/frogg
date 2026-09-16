import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import {
  CLAUDE_ACCOUNT_CONTENT,
  type ClaudeAccountContent,
  validateClaudeAccountLabel,
} from "@/screens/settings/claude-account";

export function ClaudeAccountDialog({
  visible,
  onClose,
  onSave,
  saving,
  error,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (label: string, content: ClaudeAccountContent[]) => void;
  saving: boolean;
  error?: string | null;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState("");
  const [selected, setSelected] = useState<ClaudeAccountContent[]>([...CLAUDE_ACCOUNT_CONTENT]);
  const [labelTouched, setLabelTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const labelInputRef = useRef<EditingTextInputHandle>(null);
  const invalid = labelTouched || submitted ? validateClaudeAccountLabel(label) : null;
  const header = useMemo(() => ({ title: t("settings.providers.claudeAccount.title") }), [t]);
  const toggleContent = useCallback((item: ClaudeAccountContent) => {
    setSelected((v) => (v.includes(item) ? v.filter((x) => x !== item) : [...v, item]));
  }, []);
  useEffect(() => {
    setLabel("");
    setSelected([...CLAUDE_ACCOUNT_CONTENT]);
    setLabelTouched(false);
    setSubmitted(false);
    if (!visible) return;
    const timeout = setTimeout(() => labelInputRef.current?.focus(), 50);
    return () => clearTimeout(timeout);
  }, [visible]);
  const save = useCallback(() => {
    setSubmitted(true);
    if (!validateClaudeAccountLabel(label)) onSave(label, selected);
  }, [label, onSave, selected]);
  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      testID="claude-account-dialog"
    >
      <Text style={styles.hint}>{t("settings.providers.claudeAccount.description")}</Text>
      <Field
        label={t("settings.providers.claudeAccount.label")}
        error={invalid ? t("settings.providers.claudeAccount.required") : null}
      >
        <FormTextInput
          ref={labelInputRef}
          initialValue=""
          resetKey={visible ? "open" : "closed"}
          onChangeText={setLabel}
          placeholder={t("settings.providers.claudeAccount.placeholder")}
          testID="claude-account-label"
          editable={!saving}
          // eslint-disable-next-line eslint-plugin-react-perf/jsx-no-new-function-as-prop
          onBlur={() => setLabelTouched(true)}
          nativeID="claude-account-label-input"
          accessibilityLabel={t("settings.providers.claudeAccount.label")}
        />
      </Field>
      <Text style={styles.heading}>{t("settings.providers.claudeAccount.sharedContent")}</Text>
      {CLAUDE_ACCOUNT_CONTENT.map((item) => {
        const checked = selected.includes(item);
        return (
          <View key={item} style={styles.check}>
            <Button
              variant={checked ? "default" : "outline"}
              size="sm"
              // eslint-disable-next-line eslint-plugin-react-perf/jsx-no-new-function-as-prop
              onPress={() => toggleContent(item)}
              accessibilityRole="checkbox"
              // eslint-disable-next-line eslint-plugin-react-perf/jsx-no-new-object-as-prop
              accessibilityState={{ checked, disabled: saving }}
              disabled={saving}
              testID={`claude-account-content-${item}`}
            >
              {checked ? "✓" : "○"}
            </Button>
            <Text style={styles.option}>
              {t(`settings.providers.claudeAccount.content.${item}`)}
            </Text>
          </View>
        );
      })}
      <Text role="alert" aria-live="assertive" style={styles.error} testID="claude-account-error">
        {error ?? ""}
      </Text>
      <View style={styles.footer}>
        <Button
          variant="secondary"
          onPress={onClose}
          disabled={saving}
          testID="claude-account-cancel"
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="default"
          onPress={save}
          disabled={saving}
          loading={saving}
          testID="claude-account-save"
        >
          {saving
            ? t("settings.providers.claudeAccount.saving")
            : t("settings.providers.claudeAccount.save")}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}
const styles = StyleSheet.create((theme) => ({
  hint: { color: theme.colors.foregroundMuted, marginBottom: theme.spacing[4] },
  heading: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.semibold,
    marginTop: theme.spacing[4],
    marginBottom: theme.spacing[2],
  },
  check: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  option: { color: theme.colors.foreground },
  error: { color: theme.colors.statusDanger, marginTop: theme.spacing[2] },
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[4],
    marginTop: theme.spacing[4],
  },
}));
