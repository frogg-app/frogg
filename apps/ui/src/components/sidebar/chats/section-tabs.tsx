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
const TRACK_PADDING = 3;
// Ease-out-quint: leaves fast and glides into place, which reads as a physical pill.
const PILL_TIMING = { duration: 280, easing: Easing.bezier(0.22, 1, 0.36, 1) } as const;
const CONTENT_SHIFT_PX = 12;
const CONTENT_TIMING = { duration: 220, easing: Easing.out(Easing.cubic) } as const;

const ThemedFolder = withUnistyles(FolderClosed);
const ThemedMessage = withUnistyles(MessageCircle);
const selectedIconColor = (theme: Theme) => ({ color: theme.colors.foreground });
const idleIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * The Projects | Chats segmented control that heads the sidebar, with the display menu beside it.
 * Rendered once above both lists so the pill can slide between them. The menu keeps its slot on
 * Chats (faded and inert) so the control never changes width mid-switch.
 */
export function SidebarSectionBar() {
  const { t } = useTranslation();
  const section = useEffectiveSidebarSection();
  const setSection = useSidebarSectionStore((state) => state.setSection);
  const reducedMotion = useReducedMotion();
  const trackWidth = useSharedValue(0);
  const progress = useSharedValue(SECTION_INDEX[section]);

  useEffect(() => {
    const target = SECTION_INDEX[section];
    progress.value = reducedMotion ? target : withTiming(target, PILL_TIMING);
  }, [progress, reducedMotion, section]);

  const handleTrackLayout = useCallback(
    (event: LayoutChangeEvent) => {
      trackWidth.value = event.nativeEvent.layout.width;
    },
    [trackWidth],
  );

  const isProjects = section === "projects";
  const menuSlotStyle = useMemo(
    () => [styles.menuSlot, !isProjects && styles.menuSlotHidden],
    [isProjects],
  );

  return (
    <View style={styles.bar}>
      <View style={styles.track} accessibilityRole="tablist" onLayout={handleTrackLayout}>
        <SectionPill trackWidth={trackWidth} progress={progress} />
        <SectionTab
          section="projects"
          icon={ThemedFolder}
          label={t("sidebar.sections.projects")}
          selected={isProjects}
          onSelect={setSection}
        />
        <SectionTab
          section="chats"
          icon={ThemedMessage}
          label={t("sidebar.sections.chats")}
          selected={!isProjects}
          onSelect={setSection}
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
 * re-render re-applies the style snapshot and flashes the pill for a frame mid-spring.
 */
const SectionPill = memo(function SectionPill({
  trackWidth,
  progress,
}: {
  trackWidth: SharedValue<number>;
  progress: SharedValue<number>;
}) {
  const pillStyle = useAnimatedStyle(() => {
    const segment = Math.max(0, (trackWidth.value - TRACK_PADDING * 2) / 2);
    return {
      width: segment,
      opacity: trackWidth.value > 0 ? 1 : 0,
      // Clamped: reanimated-web can evaluate an animation's first frame before its start time.
      transform: [{ translateX: Math.min(1, Math.max(0, progress.value)) * segment }],
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
}: {
  section: SidebarSection;
  icon: typeof ThemedFolder;
  label: string;
  selected: boolean;
  onSelect: (section: SidebarSection) => void;
}) {
  const handlePress = useCallback(() => onSelect(section), [onSelect, section]);
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
    top: TRACK_PADDING,
    bottom: TRACK_PADDING,
    left: TRACK_PADDING,
  },
  content: {
    flex: 1,
    minHeight: 0,
  },
});

const styles = StyleSheet.create((theme) => ({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  track: {
    position: "relative",
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    padding: TRACK_PADDING,
    borderRadius: 10,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  pillSurface: {
    flex: 1,
    borderRadius: 7,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.35), 0 1px 0 rgba(255, 255, 255, 0.04) inset",
  },
  tab: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 26,
    borderRadius: 7,
  },
  tabHovered: {
    opacity: 0.85,
  },
  tabLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    letterSpacing: 0.1,
  },
  tabLabelSelected: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
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
