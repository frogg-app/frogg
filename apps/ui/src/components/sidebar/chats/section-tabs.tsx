import { FolderClosed, MessageCircle } from "lucide-react-native";
import { memo, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  StyleSheet as RNStyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type PressableStateCallbackType,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SidebarDisplayPreferencesMenu } from "@/components/sidebar/display-preferences/menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSessionStore } from "@/stores/session-store";
import { type SidebarSection, useSidebarSectionStore } from "@/stores/sidebar-section-store";
import type { Theme } from "@/styles/theme";

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

const SECTION_INDEX: Record<SidebarSection, number> = { projects: 0, chats: 1 };
// Ease-out-quint: leaves fast and glides into place, which reads as a physical capsule.
const PILL_TIMING = { duration: 280, easing: Easing.bezier(0.22, 1, 0.36, 1) } as const;
const CONTENT_SHIFT_PX = 12;
const CONTENT_TIMING = { duration: 220, easing: Easing.out(Easing.cubic) } as const;

const ThemedFolder = withUnistyles(FolderClosed);
const ThemedMessage = withUnistyles(MessageCircle);
const selectedIconColor = (theme: Theme) => ({ color: theme.colors.foreground });
const idleIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface TabGeometry {
  x: SharedValue<number>;
  width: SharedValue<number>;
}

/**
 * The sidebar's section header: Projects | Chats as label-sized tabs where the section title
 * used to sit, with the display menu as a plain trailing action. A capsule behind the selected
 * tab slides and resizes between the two measured labels. Rendered once above both lists so the
 * capsule animates instead of remounting. The menu only applies to Projects and fades on Chats.
 */
export function SidebarSectionBar() {
  const { t } = useTranslation();
  const section = useEffectiveSidebarSection();
  const setSection = useSidebarSectionStore((state) => state.setSection);
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(SECTION_INDEX[section]);
  const projectsX = useSharedValue(0);
  const projectsWidth = useSharedValue(0);
  const chatsX = useSharedValue(0);
  const chatsWidth = useSharedValue(0);
  const projectsGeometry = useMemo(
    (): TabGeometry => ({ x: projectsX, width: projectsWidth }),
    [projectsWidth, projectsX],
  );
  const chatsGeometry = useMemo(
    (): TabGeometry => ({ x: chatsX, width: chatsWidth }),
    [chatsWidth, chatsX],
  );

  useEffect(() => {
    const target = SECTION_INDEX[section];
    progress.value = reducedMotion ? target : withTiming(target, PILL_TIMING);
  }, [progress, reducedMotion, section]);

  const isProjects = section === "projects";
  const menuSlotStyle = useMemo(
    () => [styles.menuSlot, !isProjects && styles.menuSlotHidden],
    [isProjects],
  );

  return (
    <View style={styles.bar}>
      <View style={styles.tabs} accessibilityRole="tablist">
        <SectionPill progress={progress} from={projectsGeometry} to={chatsGeometry} />
        <SectionTab
          section="projects"
          icon={ThemedFolder}
          label={t("sidebar.sections.projects")}
          selected={isProjects}
          onSelect={setSection}
          geometry={projectsGeometry}
        />
        <SectionTab
          section="chats"
          icon={ThemedMessage}
          label={t("sidebar.sections.chats")}
          selected={!isProjects}
          onSelect={setSection}
          geometry={chatsGeometry}
        />
      </View>
      <View style={menuSlotStyle} pointerEvents={isProjects ? "auto" : "none"}>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <View>
              <SidebarDisplayPreferencesMenu />
            </View>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" offset={8}>
            <Text style={styles.tooltipText}>{t("sidebar.display.trigger")}</Text>
          </TooltipContent>
        </Tooltip>
      </View>
    </View>
  );
}

/**
 * Memoized on its shared values alone so a section change never re-renders it: on web a
 * re-render re-applies the style snapshot and flashes the capsule for a frame mid-slide.
 */
const SectionPill = memo(function SectionPill({
  progress,
  from,
  to,
}: {
  progress: SharedValue<number>;
  from: TabGeometry;
  to: TabGeometry;
}) {
  const pillStyle = useAnimatedStyle(() => {
    // Clamped: reanimated-web can evaluate an animation's first frame before its start time.
    const t = Math.min(1, Math.max(0, progress.value));
    return {
      width: from.width.value + (to.width.value - from.width.value) * t,
      opacity: from.width.value > 0 && to.width.value > 0 ? 1 : 0,
      transform: [{ translateX: from.x.value + (to.x.value - from.x.value) * t }],
    };
  });
  const style = useMemo(() => [staticStyles.pill, pillStyle], [pillStyle]);
  return (
    <Animated.View style={style} pointerEvents="none" testID="sidebar-section-pill">
      <View style={styles.pillSurface} />
    </Animated.View>
  );
});

const SectionTab = memo(function SectionTab({
  section,
  icon: Icon,
  label,
  selected,
  onSelect,
  geometry,
}: {
  section: SidebarSection;
  icon: typeof ThemedFolder;
  label: string;
  selected: boolean;
  onSelect: (section: SidebarSection) => void;
  geometry: TabGeometry;
}) {
  const handlePress = useCallback(() => onSelect(section), [onSelect, section]);
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      geometry.x.value = event.nativeEvent.layout.x;
      geometry.width.value = event.nativeEvent.layout.width;
    },
    [geometry],
  );
  const style = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.tab,
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
      onLayout={handleLayout}
    >
      <Icon
        size={13}
        strokeWidth={selected ? 2.25 : 2}
        uniProps={selected ? selectedIconColor : idleIconColor}
      />
      <Text numberOfLines={1} style={[styles.tabLabel, selected && styles.tabLabelSelected]}>
        {label}
      </Text>
    </Pressable>
  );
});

/**
 * Wraps the sidebar list. On a section change the incoming list crossfades in while gliding a
 * few pixels from the side of the tab that was picked, so the swap reads as lateral movement
 * that matches the pill. Honours reduced motion.
 */
export function SidebarSectionTransition({
  section,
  children,
}: {
  section: SidebarSection;
  children: ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  // 0 = just swapped in, 1 = settled. One value drives both channels so they cannot drift.
  const enter = useSharedValue(1);
  const direction = useSharedValue(1);
  const previous = useRef(section);

  useEffect(() => {
    if (previous.current === section) return;
    direction.value = SECTION_INDEX[section] > SECTION_INDEX[previous.current] ? 1 : -1;
    previous.current = section;
    if (reducedMotion) return;
    enter.value = 0;
    enter.value = withTiming(1, CONTENT_TIMING);
  }, [direction, enter, reducedMotion, section]);

  const animatedStyle = useAnimatedStyle(() => {
    const t = Math.min(1, Math.max(0, enter.value));
    return {
      opacity: t,
      transform: [{ translateX: (1 - t) * direction.value * CONTENT_SHIFT_PX }],
    };
  });
  const style = useMemo(() => [staticStyles.content, animatedStyle], [animatedStyle]);
  return (
    <Animated.View style={style} testID="sidebar-section-content">
      {children}
    </Animated.View>
  );
}

// Static styles for Animated.Views: Unistyles must not patch nodes Reanimated also drives.
const staticStyles = RNStyleSheet.create({
  pill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
  },
  content: {
    flex: 1,
    minHeight: 0,
  },
});

const styles = StyleSheet.create((theme) => ({
  // Insets match the project rows so the first tab's icon sits on the row icon rail.
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  tabs: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  pillSurface: {
    flex: 1,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.05) inset, 0 1px 2px rgba(0, 0, 0, 0.3)",
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: theme.borderRadius.md,
  },
  tabHovered: {
    backgroundColor: theme.colors.surface1,
  },
  tabLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  tabLabelSelected: {
    color: theme.colors.foreground,
  },
  menuSlot: {
    flexShrink: 0,
  },
  menuSlotHidden: {
    opacity: 0,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
