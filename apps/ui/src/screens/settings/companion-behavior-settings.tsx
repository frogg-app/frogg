import { useCallback } from "react";
import { ChevronDown } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Platform, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSettings, type Settings } from "@/hooks/use-settings";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";

const ThemedChevronDown = withUnistyles(ChevronDown, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

export function Choice<T extends string | number>({
  label,
  hint,
  hintIsError,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  hintIsError?: boolean;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      {hint ? (
        <View style={[settingsStyles.rowContent, styles.label]}>
          <Text style={settingsStyles.rowTitle}>{label}</Text>
          <Text style={hintIsError ? settingsStyles.rowError : settingsStyles.rowHint}>{hint}</Text>
        </View>
      ) : (
        <Text style={[settingsStyles.rowTitle, styles.label]}>{label}</Text>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          style={styles.choice}
          accessibilityRole="button"
          accessibilityLabel={label}
        >
          <Text style={[settingsStyles.rowHint, styles.value]}>
            {options.find((option) => option.value === value)?.label}
          </Text>
          <ThemedChevronDown size={14} />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {options.map((option) => (
            <ChoiceItem
              key={option.value}
              option={option}
              selected={option.value === value}
              onChange={onChange}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { flex: 1, marginRight: 12 },
  choice: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "55%", minHeight: 44 },
  value: { flexShrink: 1, textAlign: "right" },
});

function ChoiceItem<T extends string | number>({
  option,
  selected,
  onChange,
}: {
  option: { value: T; label: string };
  selected: boolean;
  onChange: (value: T) => void;
}) {
  const select = useCallback(() => onChange(option.value), [onChange, option.value]);
  return (
    <DropdownMenuItem selected={selected} onSelect={select}>
      {option.label}
    </DropdownMenuItem>
  );
}

function useSetting<K extends keyof Settings>(key: K) {
  const { updateSettings } = useSettings();
  return useCallback(
    (value: Settings[K]) => {
      void updateSettings({ [key]: value });
    },
    [key, updateSettings],
  );
}

function ToggleRow({
  title,
  hint,
  value,
  onChange,
  testID,
}: {
  title: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  testID?: string;
}) {
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        {hint ? <Text style={settingsStyles.rowHint}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={title} testID={testID} />
    </View>
  );
}

function VoiceSettings() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const changeAudioMode = useSetting("companionAudioMode");
  const changeSpeechSpeed = useSetting("companionSpeechSpeed");
  const changePauseMs = useSetting("companionPauseMs");
  const changeInterruptible = useSetting("companionInterruptible");
  const changeInterruptDelay = useSetting("companionInterruptDelayMs");
  const nativeVoice = settings.companionNativeVoice;
  // Web without the native transport has no voice-level controls to show.
  if (nativeVoice && Platform.OS === "web") return null;
  return (
    <SettingsSection title={t("companion.behavior.groups.voice")} testID="companion-voice-section">
      <View style={settingsStyles.card}>
        {Platform.OS !== "web" ? (
          <>
            <Choice<"call" | "media">
              label={t("companion.behavior.audioMode")}
              value={settings.companionAudioMode}
              options={[
                { value: "call", label: t("companion.behavior.callMode") },
                { value: "media", label: t("companion.behavior.mediaMode") },
              ]}
              onChange={changeAudioMode}
            />
            <View style={settingsStyles.row}>
              <Text style={settingsStyles.rowHint}>{t("companion.behavior.audioModeHint")}</Text>
            </View>
          </>
        ) : null}
        {!nativeVoice ? (
          <>
            <Choice<number>
              label={t("companion.behavior.speechSpeed")}
              value={settings.companionSpeechSpeed}
              options={[0.75, 1, 1.15, 1.3, 1.5, 1.75, 2].map((value) => ({
                value,
                label: `${value}×`,
              }))}
              onChange={changeSpeechSpeed}
            />
            <Choice<number>
              label={t("companion.behavior.pause")}
              value={settings.companionPauseMs}
              options={[
                { value: 800, label: t("companion.behavior.quick") },
                { value: 1400, label: t("companion.behavior.natural") },
                { value: 2400, label: t("companion.behavior.relaxed") },
              ]}
              onChange={changePauseMs}
            />
            <ToggleRow
              title={t("companion.behavior.interruptible")}
              value={settings.companionInterruptible}
              onChange={changeInterruptible}
            />
            {settings.companionInterruptible ? (
              <Choice<number>
                label={t("companion.behavior.interruptDelay")}
                value={settings.companionInterruptDelayMs}
                options={[
                  { value: 120, label: t("companion.behavior.interruptInstant") },
                  { value: 300, label: t("companion.behavior.interruptShort") },
                  { value: 600, label: t("companion.behavior.interruptDeliberate") },
                ]}
                onChange={changeInterruptDelay}
              />
            ) : null}
          </>
        ) : null}
      </View>
    </SettingsSection>
  );
}

function ConversationSettings() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const changeVerbosity = useSetting("companionVerbosity");
  const changeUpdates = useSetting("companionUpdates");
  const changeAcknowledgeTasks = useSetting("companionAcknowledgeTasks");
  return (
    <SettingsSection
      title={t("companion.behavior.groups.conversation")}
      info={t("companion.behavior.nextSession")}
      testID="companion-conversation-section"
    >
      <View style={settingsStyles.card}>
        <Choice<"brief" | "detailed">
          label={t("companion.behavior.verbosity")}
          value={settings.companionVerbosity}
          options={[
            { value: "brief", label: t("companion.behavior.brief") },
            { value: "detailed", label: t("companion.behavior.detailed") },
          ]}
          onChange={changeVerbosity}
        />
        <Choice<"important" | "completion" | "off">
          label={t("companion.behavior.updates")}
          value={settings.companionUpdates}
          options={[
            { value: "important", label: t("companion.behavior.important") },
            { value: "completion", label: t("companion.behavior.completion") },
            { value: "off", label: t("companion.behavior.off") },
          ]}
          onChange={changeUpdates}
        />
        <ToggleRow
          title={t("companion.behavior.acknowledge")}
          hint={t("companion.behavior.permissions")}
          value={settings.companionAcknowledgeTasks}
          onChange={changeAcknowledgeTasks}
        />
      </View>
    </SettingsSection>
  );
}

function AppearanceSettings() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const changeReplyText = useSetting("companionShowReplyText");
  const changeAnimated = useSetting("companionAnimated");
  return (
    <SettingsSection
      title={t("companion.behavior.groups.appearance")}
      testID="companion-appearance-section"
    >
      <View style={settingsStyles.card}>
        <ToggleRow
          title={t("companion.settings.replyText.label")}
          hint={t("companion.settings.replyText.description")}
          value={settings.companionShowReplyText}
          onChange={changeReplyText}
          testID="settings-companion-show-reply-text"
        />
        <ToggleRow
          title={t("companion.settings.animated.label")}
          hint={t("companion.settings.animated.description")}
          value={settings.companionAnimated}
          onChange={changeAnimated}
          testID="settings-companion-animated"
        />
      </View>
    </SettingsSection>
  );
}

/** Companion preferences, grouped as Voice, Conversation and Appearance. */
export function CompanionBehaviorSettings() {
  const { settings } = useSettings();
  if (!settings.companionEnabled) return null;
  return (
    <>
      <VoiceSettings />
      <ConversationSettings />
      <AppearanceSettings />
    </>
  );
}
