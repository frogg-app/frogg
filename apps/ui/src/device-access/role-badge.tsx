import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Crown, Eye, Wrench } from "lucide-react-native";
import type { DeviceRole } from "@frogg/protocol/device-access";
import { Button } from "@/components/ui/button";
import type { Theme } from "@/styles/theme";
import { DEVICE_ROLE_ORDER } from "./capabilities";

export const ROLE_ICON = { owner: Crown, operator: Wrench, viewer: Eye } as const;

export function roleLabelKey(role: DeviceRole): string {
  return `deviceAccess.roles.${role}.label`;
}

export function roleDescriptionKey(role: DeviceRole): string {
  return `deviceAccess.roles.${role}.description`;
}

export function RoleBadge({ role, testID }: { role: DeviceRole; testID?: string }) {
  const { t } = useTranslation();
  return (
    <View style={[styles.badge, styles[role]]} testID={testID}>
      <Text style={styles.badgeText}>{t(roleLabelKey(role))}</Text>
    </View>
  );
}

export interface RolePickerProps {
  value: DeviceRole;
  onChange: (role: DeviceRole) => void;
  /** Disabled with a reason shown by the caller, rather than hidden. */
  disabled?: boolean;
  pending?: boolean;
  testID?: string;
}

/**
 * Three explicit choices rather than a dropdown: each role's consequence is
 * spelled out, because picking the wrong one silently widens what a device can
 * do to the host machine.
 */
export function RolePicker({ value, onChange, disabled, pending, testID }: RolePickerProps) {
  const { t } = useTranslation();
  const roles = useMemo(() => DEVICE_ROLE_ORDER, []);
  return (
    <View style={styles.picker} testID={testID}>
      {roles.map((role) => (
        <RoleOption
          key={role}
          role={role}
          selected={role === value}
          disabled={disabled === true}
          pending={pending === true && role === value}
          label={t(roleLabelKey(role))}
          description={t(roleDescriptionKey(role))}
          onChange={onChange}
        />
      ))}
    </View>
  );
}

function RoleOption({
  role,
  selected,
  disabled,
  pending,
  label,
  description,
  onChange,
}: {
  role: DeviceRole;
  selected: boolean;
  disabled: boolean;
  pending: boolean;
  label: string;
  description: string;
  onChange: (role: DeviceRole) => void;
}) {
  const handlePress = useCallback(() => onChange(role), [onChange, role]);
  return (
    <Button
      variant={selected ? "default" : "outline"}
      size="sm"
      leftIcon={ROLE_ICON[role]}
      disabled={disabled}
      loading={pending}
      onPress={handlePress}
      style={styles.option}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityHint={description}
      testID={`device-role-option-${role}`}
    >
      {label}
    </Button>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  badge: {
    alignSelf: "flex-start",
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[0.5],
  },
  owner: { borderColor: theme.colors.accentBright },
  operator: { borderColor: theme.colors.border },
  viewer: { borderColor: theme.colors.border },
  badgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  picker: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  option: { flexGrow: 1, flexBasis: 100 },
}));
