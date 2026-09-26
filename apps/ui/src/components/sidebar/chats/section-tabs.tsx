import { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useSessionStore } from "@/stores/session-store";
import { type SidebarSection, useSidebarSectionStore } from "@/stores/sidebar-section-store";

/** True when any known host can run chats (features.chats). */
export function useAnyHostSupportsChats(): boolean {
  return useSessionStore((state) =>
    Object.values(state.sessions).some((session) => session?.serverInfo?.features?.chats === true),
  );
}

/**
 * The section the sidebar should show. Falls back to projects when no host can run chats,
 * without forgetting the saved choice, so reconnecting a chat-capable host restores it.
 */
export function useEffectiveSidebarSection(): SidebarSection {
  const section = useSidebarSectionStore((state) => state.section);
  const chatsSupported = useAnyHostSupportsChats();
  return chatsSupported ? section : "projects";
}

/** The Projects | Chats switch that heads the sidebar list; a plain title when chats are unavailable. */
export function SidebarSectionTabs() {
  const { t } = useTranslation();
  const section = useEffectiveSidebarSection();
  const chatsSupported = useAnyHostSupportsChats();
  const setSection = useSidebarSectionStore((state) => state.setSection);

  if (!chatsSupported) {
    return <Text style={styles.title}>{t("sidebar.sections.projects")}</Text>;
  }

  return (
    <View style={styles.track} accessibilityRole="tablist">
      <SectionTab
        section="projects"
        label={t("sidebar.sections.projects")}
        selected={section === "projects"}
        onSelect={setSection}
      />
      <SectionTab
        section="chats"
        label={t("sidebar.sections.chats")}
        selected={section === "chats"}
        onSelect={setSection}
      />
    </View>
  );
}

const SectionTab = memo(function SectionTab({
  section,
  label,
  selected,
  onSelect,
}: {
  section: SidebarSection;
  label: string;
  selected: boolean;
  onSelect: (section: SidebarSection) => void;
}) {
  const handlePress = useCallback(() => onSelect(section), [onSelect, section]);
  const style = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.tab,
      selected && styles.tabSelected,
      !selected && Boolean(hovered) && styles.tabHovered,
    ],
    [selected],
  );
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="tab"
      accessibilityState={accessibilityState}
      testID={`sidebar-section-${section}`}
      style={style}
    >
      <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>{label}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create((theme) => ({
  title: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  track: {
    flexDirection: "row",
    flexShrink: 1,
    padding: 2,
    gap: 2,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  tab: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 3,
    borderRadius: theme.borderRadius.sm,
  },
  tabHovered: {
    backgroundColor: theme.colors.surface2,
  },
  tabSelected: {
    backgroundColor: theme.colors.surface3,
  },
  tabLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  tabLabelSelected: {
    color: theme.colors.foreground,
  },
}));
