import { ChevronDown, Search, SquarePen } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { HostStatusDot } from "@/components/host-status-dot";
import {
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuSurface,
  MenuTrigger,
  type MenuTriggerState,
} from "@/components/ui/menu";
import { useHosts } from "@/runtime/host-runtime";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import type { Theme } from "@/styles/theme";

type HoverState = PressableStateCallbackType & { hovered?: boolean };

const ThemedChevron = withUnistyles(ChevronDown);
const ThemedSearch = withUnistyles(Search);
const ThemedPen = withUnistyles(SquarePen);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function triggerStyle({ hovered, pressed, open }: MenuTriggerState) {
  return [styles.switcher, (hovered || pressed || open) && styles.hovered];
}
function iconButtonStyle({ hovered, pressed }: HoverState) {
  return [styles.iconButton, (Boolean(hovered) || pressed) && styles.hovered];
}

/**
 * Linear's workspace switcher, as a host switcher: the host in view with a chevron that scopes
 * the whole app to one host (the sidebar's existing host filter), then search and new-session
 * icon buttons.
 */
export function InsetSidebarHeader({
  onSearch,
  onNewSession,
}: {
  onSearch: () => void;
  onNewSession: () => void;
}) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const hostFilters = useSidebarViewStore((state) => state.hostFilters);
  const toggleHostFilter = useSidebarViewStore((state) => state.toggleHostFilter);
  const clearHostFilters = useSidebarViewStore((state) => state.clearHostFilters);

  const scopedHost =
    hostFilters.length === 1
      ? hosts.find((host) => host.serverId === hostFilters[0])
      : hosts.length === 1
        ? hosts[0]
        : undefined;
  const label = scopedHost
    ? scopedHost.label?.trim() || scopedHost.serverId
    : t("sidebar.display.hostFilter.all");
  const initial = label.trim().charAt(0).toUpperCase() || "·";

  const selectAll = useCallback(() => clearHostFilters(), [clearHostFilters]);
  const selectHost = useCallback(
    (serverId: string) => {
      clearHostFilters();
      toggleHostFilter(serverId);
    },
    [clearHostFilters, toggleHostFilter],
  );

  return (
    <View style={styles.root}>
      <MenuRoot compactMode="sheet">
        <MenuTrigger
          style={triggerStyle}
          accessibilityLabel={t("sidebar.host.switchTitle")}
          testID="inset-host-switcher"
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <Text style={styles.switcherLabel} numberOfLines={1}>
            {label}
          </Text>
          <ThemedChevron size={12} uniProps={mutedMapping} />
        </MenuTrigger>
        <MenuSurface
          side="bottom"
          align="start"
          width={240}
          sheetTitle={t("sidebar.host.switchTitle")}
          testID="inset-host-switcher-menu"
        >
          <MenuItem selected={hostFilters.length === 0} showSelectedCheck onSelect={selectAll}>
            {t("sidebar.display.hostFilter.all")}
          </MenuItem>
          {hosts.length > 0 ? <MenuSeparator /> : null}
          {hosts.map((host) => (
            <HostItem
              key={host.serverId}
              serverId={host.serverId}
              label={host.label?.trim() || host.serverId}
              selected={hostFilters.length === 1 && hostFilters[0] === host.serverId}
              onSelect={selectHost}
            />
          ))}
        </MenuSurface>
      </MenuRoot>
      <View style={styles.actions}>
        <Pressable
          onPress={onSearch}
          style={iconButtonStyle}
          accessibilityRole="button"
          accessibilityLabel={t("sidebar.sections.search")}
          testID="inset-sidebar-search"
        >
          <ThemedSearch size={14} uniProps={mutedMapping} />
        </Pressable>
        <Pressable
          onPress={onNewSession}
          style={iconButtonStyle}
          accessibilityRole="button"
          accessibilityLabel={t("sidebar.actions.newWorkspace")}
          testID="inset-sidebar-new-session"
        >
          <ThemedPen size={14} uniProps={mutedMapping} />
        </Pressable>
      </View>
    </View>
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
  const handleSelect = useCallback(() => onSelect(serverId), [onSelect, serverId]);
  const leading = useMemo(() => <HostStatusDot serverId={serverId} />, [serverId]);
  return (
    <MenuItem
      selected={selected}
      showSelectedCheck
      leading={leading}
      onSelect={handleSelect}
      testID={`inset-host-${serverId}`}
    >
      {label}
    </MenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  switcher: {
    flex: 1,
    minWidth: 0,
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  hovered: {
    backgroundColor: theme.colors.surface3,
  },
  avatar: {
    width: 18,
    height: 18,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.accent,
  },
  avatarText: {
    fontSize: 10,
    fontWeight: "700",
    color: theme.colors.accentForeground,
  },
  switcherLabel: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
}));
