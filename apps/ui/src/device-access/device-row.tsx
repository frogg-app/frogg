import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Check, Pencil, X } from "lucide-react-native";
import {
  DEVICE_NAME_MAX_LENGTH,
  type DeviceCredential,
  type DeviceRole,
} from "@frogg/protocol/device-access";
import { Button } from "@/components/ui/button";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";
import type { Theme } from "@/styles/theme";
import { RoleBadge, RolePicker } from "./role-badge";
import { describeLastSeen, lastSeenTranslation } from "./relative-time";
import { sanitizeUntrustedText } from "./untrusted-text";

export interface DeviceRowProps {
  device: DeviceCredential;
  canRename: boolean;
  canRevoke: boolean;
  canChangeRole: boolean;
  /** Explains why the edit controls are missing, when they are. */
  refusal: string | null;
  isPending: boolean;
  onRename: (name: string) => Promise<void>;
  onRevoke: () => void;
  onChangeRole: (role: DeviceRole) => void;
  testID?: string;
}

export function DeviceRow(props: DeviceRowProps) {
  const { t } = useTranslation();
  const { device } = props;
  const [editing, setEditing] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<EditingTextInputHandle>(null);
  const draftRef = useRef(device.name);

  useEffect(() => {
    if (!editing) draftRef.current = device.name;
  }, [device.name, editing]);

  const startEditing = useCallback(() => {
    draftRef.current = device.name;
    setRenameError(null);
    setEditing(true);
  }, [device.name]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setRenameError(null);
  }, []);

  const submitRename = useCallback(async () => {
    const next = draftRef.current.trim();
    if (next.length === 0 || next.length > DEVICE_NAME_MAX_LENGTH) {
      setRenameError(t("deviceAccess.errors.invalidName", { max: DEVICE_NAME_MAX_LENGTH }));
      return;
    }
    if (next === device.name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setRenameError(null);
    try {
      await props.onRename(next);
      setEditing(false);
    } catch (error) {
      // The draft stays in the field: a failed save must not lose the typing.
      setRenameError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [device.name, props, t]);

  const handleSubmit = useCallback(() => {
    void submitRename();
  }, [submitRename]);

  const handleChangeText = useCallback((value: string) => {
    draftRef.current = value;
  }, []);

  const lastSeen = lastSeenTranslation(describeLastSeen(device));
  const displayName = sanitizeUntrustedText(device.name, {
    fallback: t("deviceAccess.unnamedDevice"),
  });

  return (
    <View style={styles.row} testID={props.testID}>
      <View style={styles.header}>
        {editing ? (
          <View style={styles.renameRow}>
            <TextInput
              ref={inputRef}
              style={styles.renameInput}
              initialValue={device.name}
              maxLength={DEVICE_NAME_MAX_LENGTH}
              autoFocus
              onChangeText={handleChangeText}
              onSubmitEditing={handleSubmit}
              accessibilityLabel={t("deviceAccess.renameLabel")}
              testID="device-rename-input"
            />
            <Button
              variant="default"
              size="sm"
              leftIcon={Check}
              loading={saving}
              onPress={handleSubmit}
              testID="device-rename-save"
            >
              {t("deviceAccess.actions.save")}
            </Button>
            <Button variant="ghost" size="sm" leftIcon={X} onPress={cancelEditing}>
              {t("deviceAccess.actions.cancel")}
            </Button>
          </View>
        ) : (
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1} testID="device-name">
              {displayName}
            </Text>
            {device.current ? (
              <View style={styles.youBadge} testID="device-current-badge">
                <Text style={styles.youText}>{t("deviceAccess.thisDevice")}</Text>
              </View>
            ) : null}
            <RoleBadge role={device.role} />
          </View>
        )}
      </View>

      <Text style={styles.meta} testID="device-last-seen">
        {t(lastSeen.key, lastSeen.options)}
      </Text>

      {renameError ? (
        <Text style={styles.error} testID="device-rename-error">
          {renameError}
        </Text>
      ) : null}

      {props.canChangeRole ? (
        <RolePicker
          value={device.role}
          onChange={props.onChangeRole}
          pending={props.isPending}
          testID="device-role-picker"
        />
      ) : null}

      {props.refusal ? (
        <Text style={styles.refusal} testID="device-refusal">
          {props.refusal}
        </Text>
      ) : null}

      {props.canRename || props.canRevoke ? (
        <View style={styles.actions}>
          {props.canRename && !editing ? (
            <Button
              variant="outline"
              size="sm"
              leftIcon={Pencil}
              onPress={startEditing}
              testID="device-rename"
            >
              {t("deviceAccess.actions.rename")}
            </Button>
          ) : null}
          {props.canRevoke ? (
            <Button
              variant="destructive"
              size="sm"
              loading={props.isPending}
              onPress={props.onRevoke}
              testID="device-revoke"
            >
              {device.current
                ? t("deviceAccess.actions.revokeThisDevice")
                : t("deviceAccess.actions.revoke")}
            </Button>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  row: {
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    gap: theme.spacing[2],
    padding: theme.spacing[3],
  },
  header: { gap: theme.spacing[2] },
  nameRow: { alignItems: "center", flexDirection: "row", gap: theme.spacing[2] },
  name: { color: theme.colors.foreground, flexShrink: 1, fontSize: theme.fontSize.base },
  youBadge: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[0.5],
  },
  youText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  renameRow: { alignItems: "center", flexDirection: "row", gap: theme.spacing[2] },
  renameInput: { flex: 1 },
  meta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
  refusal: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  actions: { flexDirection: "row", gap: theme.spacing[2] },
}));
