import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, Plus, Settings2 } from "lucide-react-native";
import { HostStatusDot } from "@/components/host-status-dot";
import { MenuItem, MenuLabel, MenuRoot, MenuSeparator, MenuSurface, MenuTrigger } from "@/components/ui/menu";
import type { MenuTriggerState } from "@/components/ui/menu";
import { openAddHostFlow } from "@/hosts/add-host-flow";
import { openHostSettings } from "@/navigation/settings-navigation";
import { useHosts } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import { useFocusHostStore } from "./focus-data";

const ICON = 14;
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedChevron = withUnistyles(ChevronDown);
const ThemedPlus = withUnistyles(Plus);
const ThemedSettings = withUnistyles(Settings2);
const ADD_ICON = <ThemedPlus size={ICON} uniProps={mutedIcon} />;
const SETTINGS_ICON = <ThemedSettings size={ICON} uniProps={mutedIcon} />;

/**
 * Devin's org switcher, pointed at hosts: a letter avatar, the host name and a chevron. Picking a
 * host scopes the Recent list and the home composer to it.
 * preview copy
 */
export function FocusHostSwitcher({
  serverId,
  onBeforeAction,
}: {
  serverId: string | null;
  onBeforeAction?: () => void;
}) {
  const hosts = useHosts();
  const setServerId = useFocusHostStore((state) => state.setServerId);
  const current = hosts.find((host) => host.serverId === serverId) ?? null;
  const label = current ? current.label?.trim() || current.serverId : "No host";
  const initial = label.slice(0, 1).toUpperCase();

  const handleAddHost = useCallback(() => {
    onBeforeAction?.();
    openAddHostFlow("direct");
  }, [onBeforeAction]);
  const handleSettings = useCallback(() => {
    if (!serverId) return;
    onBeforeAction?.();
    openHostSettings(serverId);
  }, [onBeforeAction, serverId]);

  const triggerStyle = useCallback(
    ({ hovered, pressed, open }: MenuTriggerState) => [
      styles.trigger,
      (hovered || pressed || open) && styles.triggerActive,
    ],
    [],
  );

  return (
    <MenuRoot compactMode="sheet">
      <MenuTrigger
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={label}
        testID="focus-host-switcher"
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        <ThemedChevron size={ICON} uniProps={mutedIcon} />
      </MenuTrigger>
      <MenuSurface side="bottom" align="start" width={240} sheetTitle="Hosts">
        <MenuLabel>Hosts</MenuLabel>
        {hosts.map((host) => (
          <HostItem
            key={host.serverId}
            serverId={host.serverId}
            label={host.label?.trim() || host.serverId}
            selected={host.serverId === serverId}
            onSelect={setServerId}
          />
        ))}
        <MenuSeparator />
        <MenuItem leading={ADD_ICON} onSelect={handleAddHost}>
          Add a host
        </MenuItem>
        {serverId ? (
          <MenuItem leading={SETTINGS_ICON} onSelect={handleSettings}>
            Host settings
          </MenuItem>
        ) : null}
      </MenuSurface>
    </MenuRoot>
  );
}

function HostItem({
  serverId,
  label,
  selected,
  onSelect,
}: {
  serverId: string;
  label: string;
  selected: boolean;
  onSelect: (serverId: string) => void;
}) {
  const leading = useMemo(
    () => (
      <View style={styles.dotSlot}>
        <HostStatusDot serverId={serverId} />
      </View>
    ),
    [serverId],
  );
  const handleSelect = useCallback(() => onSelect(serverId), [onSelect, serverId]);
  return (
    <MenuItem leading={leading} selected={selected} onSelect={handleSelect}>
      {label}
    </MenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
    flexShrink: 1,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.md,
  },
  triggerActive: {
    backgroundColor: theme.colors.surface2,
  },
  avatar: {
    width: 20,
    height: 20,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface3,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: theme.colors.foreground,
    fontSize: 11,
    fontWeight: theme.fontWeight.semibold,
  },
  label: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: 13,
    fontWeight: theme.fontWeight.medium,
  },
  dotSlot: {
    width: ICON,
    height: ICON,
    alignItems: "center",
    justifyContent: "center",
  },
}));
