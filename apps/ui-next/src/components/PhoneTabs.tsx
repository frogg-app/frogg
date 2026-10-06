import {
  Bell,
  FolderGit2,
  Layers,
  MoreHorizontal,
  Search,
  Settings,
  type LucideIcon,
} from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, font } from "../theme/tokens";
import { useUi, type Tool } from "../ui-store";
import { Cut } from "./Cut";
import { TOOLS, type ToolMeta } from "./Rail";
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
  { id: "more", icon: MoreHorizontal, label: "More" },
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
      {more && (
        <View style={s.sheetLayer}>
          <Pressable style={s.scrim} onPress={closeMore} />
          <Cut size={14} flip style={s.sheet}>
            <T v="label" style={s.sheetTitle}>
              all tools
            </T>
            <View style={s.grid}>
              {TOOLS.map((t) => (
                <SheetCell key={t.id} meta={t} on={tool === t.id} onPick={pick} />
              ))}
            </View>
          </Cut>
        </View>
      )}
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

function SheetCell({
  meta,
  on,
  onPick,
}: {
  meta: ToolMeta;
  on: boolean;
  onPick: (id: TabId) => void;
}) {
  const { id, icon: Icon, label } = meta;
  const onPress = useCallback(() => onPick(id), [id, onPick]);
  return (
    <Pressable style={s.cell} onPress={onPress}>
      <Cut size={8} style={[s.cellIn, on && s.on]}>
        <Icon size={20} strokeWidth={1.6} color={on ? color.cyan2 : color.muted} />
        <T style={[s.cellT, on && s.lOn]}>{label}</T>
      </Cut>
    </Pressable>
  );
}

const s = StyleSheet.create({
  sheetLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    zIndex: 20,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    backgroundColor: color.panel,
    padding: 16,
    paddingBottom: 90,
    borderTopWidth: 1,
    borderColor: color.line2,
  },
  sheetTitle: { marginBottom: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: 10 },
  cell: { width: "25%", paddingHorizontal: 4 },
  cellIn: {
    alignItems: "center",
    gap: 6,
    paddingVertical: 12,
    backgroundColor: color.wash,
  },
  cellT: { fontSize: 11.5, color: color.text, textAlign: "center" },
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
