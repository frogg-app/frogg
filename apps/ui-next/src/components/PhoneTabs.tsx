import {
  Bell,
  ChevronRight,
  FolderGit2,
  Layers,
  Menu,
  X,
  Search,
  Settings,
  type LucideIcon,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  BackHandler,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, font } from "../theme/tokens";
import { useUi, type Tool } from "../ui-store";
import { Cut } from "./Cut";
import { GROUP_NAMES, GROUPS, type ToolMeta } from "./Rail";
import { T } from "./Text";

type TabId = Tool | "more";

interface Tab {
  id: TabId;
  icon: LucideIcon;
  label: string;
}

const TABS: Tab[] = [
  { id: "sessions", icon: Layers, label: "Sessions" },
  { id: "search", icon: Search, label: "Search" },
  { id: "scm", icon: FolderGit2, label: "Source" },
  { id: "inbox", icon: Bell, label: "Inbox" },
  { id: "settings", icon: Settings, label: "Settings" },
  { id: "more", icon: Menu, label: "More" },
];

export function PhoneTabs({ badges }: { badges: Partial<Record<Tool, number>> }) {
  const tool = useUi((s) => s.tool);
  const insets = useSafeAreaInsets();
  const [more, setMore] = useState(false);
  const inTabs = TABS.some((t) => t.id === tool);
  const closeMore = useCallback(() => setMore(false), []);
  const pick = useCallback((id: TabId) => {
    if (id === "more") {
      setMore((m) => !m);
      return;
    }
    setMore(false);
    useUi.getState().setTool(id);
  }, []);
  const barStyle = useMemo(
    () => [s.bar, { paddingBottom: Math.max(insets.bottom, 6) }],
    [insets.bottom],
  );
  return (
    <>
      {more && <ToolMenu tool={tool} badges={badges} onPick={pick} onClose={closeMore} />}
      <View style={barStyle}>
        {TABS.map((t) => (
          <TabButton
            key={t.id}
            tab={t}
            on={t.id === "more" ? more || !inTabs : tool === t.id}
            badge={t.id === "more" ? undefined : badges[t.id]}
            onPick={pick}
          />
        ))}
      </View>
    </>
  );
}

function TabButton({
  tab,
  on,
  badge,
  onPick,
}: {
  tab: Tab;
  on: boolean;
  badge?: number;
  onPick: (id: TabId) => void;
}) {
  const { id, icon: Icon, label } = tab;
  const onPress = useCallback(() => onPick(id), [id, onPick]);
  return (
    <Pressable style={s.tabWrap} onPress={onPress}>
      <Cut size={8} style={[s.tab, on && s.on]}>
        <Icon size={18} strokeWidth={1.6} color={on ? color.cyan2 : color.faint} />
        <T style={[s.l, on && s.lOn]}>{label}</T>
        {!!badge && (
          <View style={s.badge}>
            <T style={s.bt}>{badge}</T>
          </View>
        )}
      </Cut>
    </Pressable>
  );
}

/**
 * Phone: every tool as a full-screen menu, grouped like the desktop rail. Slides in from the
 * right; Android back and the close button dismiss it.
 */
function ToolMenu({
  tool,
  badges,
  onPick,
  onClose,
}: {
  tool: Tool;
  badges: Partial<Record<Tool, number>>;
  onPick: (id: TabId) => void;
  onClose: () => void;
}) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (!live) return undefined;
        Animated.timing(t, {
          toValue: 1,
          duration: reduce ? 0 : 220,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
          useNativeDriver: Platform.OS !== "web",
        }).start();
        return undefined;
      });
    return () => {
      live = false;
    };
  }, [t]);
  useEffect(() => {
    // Registered after the shell's handler, so it runs first.
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);
  const anim = useMemo(
    () => [
      s.menu,
      {
        opacity: t,
        transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [48, 0] }) }],
      },
    ],
    [t],
  );
  return (
    <Animated.View style={anim}>
      <View style={s.menuHead}>
        <T v="display" style={s.menuTitle}>
          All tools
        </T>
        <Pressable onPress={onClose} accessibilityLabel="Close menu" style={s.close}>
          <X size={20} strokeWidth={1.6} color={color.muted} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={s.menuBody}>
        {GROUPS.map((g, i) => (
          <View key={GROUP_NAMES[i]} style={s.group}>
            <T v="label" style={s.groupT}>
              {GROUP_NAMES[i]}
            </T>
            {g.map((m) => (
              <MenuRow
                key={m.id}
                meta={m}
                on={tool === m.id}
                badge={badges[m.id]}
                onPick={onPick}
              />
            ))}
          </View>
        ))}
      </ScrollView>
    </Animated.View>
  );
}

function MenuRow({
  meta,
  on,
  badge,
  onPick,
}: {
  meta: ToolMeta;
  on: boolean;
  badge?: number;
  onPick: (id: TabId) => void;
}) {
  const { id, icon: Icon, label } = meta;
  const onPress = useCallback(() => onPick(id), [id, onPick]);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      {({ pressed }) => (
        <Cut size={10} style={[s.row, pressed && s.rowPressed, on && s.on]}>
          <Cut size={6} style={[s.rowIcon, on && s.rowIconOn]}>
            <Icon size={18} strokeWidth={1.6} color={on ? color.cyan2 : color.muted} />
          </Cut>
          <T style={[s.rowT, on && s.lOn]}>{label}</T>
          {!!badge && (
            <View style={s.rowBadge}>
              <T style={s.bt}>{badge}</T>
            </View>
          )}
          <ChevronRight size={16} strokeWidth={1.6} color={color.faint} />
        </Cut>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  menu: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    backgroundColor: color.bg,
  },
  menuHead: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  menuTitle: { flex: 1, fontSize: 18 },
  close: { padding: 8, marginRight: -8 },
  menuBody: { paddingHorizontal: 12, paddingBottom: 96 },
  group: { marginTop: 10, gap: 4 },
  groupT: { paddingHorizontal: 4, marginBottom: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 8,
    paddingVertical: 7,
    backgroundColor: color.wash,
  },
  rowPressed: { backgroundColor: color.wash3 },
  rowIcon: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.wash2,
  },
  rowIconOn: { backgroundColor: "rgba(37,181,200,0.16)" },
  rowT: { flex: 1, fontSize: 14.5, color: color.text },
  rowBadge: {
    minWidth: 18,
    height: 16,
    paddingHorizontal: 4,
    justifyContent: "center",
    backgroundColor: color.amber,
  },
  bar: {
    zIndex: 30,
    flexDirection: "row",
    gap: 2,
    paddingHorizontal: 4,
    paddingTop: 6,
    backgroundColor: color.bg,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  tabWrap: { flex: 1 },
  tab: { alignItems: "center", gap: 4, paddingVertical: 6 },
  on: { backgroundColor: "rgba(127,217,230,0.1)" },
  l: { fontSize: 10.5, color: color.faint },
  lOn: { color: color.cyan2 },
  badge: {
    position: "absolute",
    top: 2,
    right: "22%",
    minWidth: 14,
    height: 14,
    paddingHorizontal: 3,
    backgroundColor: color.amber,
  },
  bt: {
    fontFamily: font.mono,
    fontSize: 9,
    lineHeight: 14,
    fontWeight: "600",
    color: "#1a1204",
    textAlign: "center",
  },
});
