import {
  Bell,
  Bot,
  CircleGauge,
  Files,
  FolderGit2,
  GitPullRequest,
  Layers,
  ListChecks,
  Puzzle,
  Search,
  Server,
  Settings,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { color, font, web } from "../theme/tokens";
import { useUi, type Tool } from "../ui-store";
import { Cut } from "./Cut";
import { Logo } from "./Logo";
import { T } from "./Text";

export interface ToolMeta {
  id: Tool;
  icon: LucideIcon;
  label: string;
  group: 0 | 1 | 2;
}

export const TOOLS: ToolMeta[] = [
  { id: "sessions", icon: Layers, label: "Sessions", group: 0 },
  { id: "search", icon: Search, label: "Search", group: 0 },
  { id: "files", icon: Files, label: "Files", group: 0 },
  { id: "scm", icon: FolderGit2, label: "Source control", group: 0 },
  { id: "prs", icon: GitPullRequest, label: "PRs & CI", group: 0 },
  { id: "terminals", icon: SquareTerminal, label: "Terminals", group: 0 },
  { id: "tasks", icon: ListChecks, label: "Tasks", group: 0 },
  { id: "hosts", icon: Server, label: "Hosts", group: 1 },
  { id: "usage", icon: CircleGauge, label: "Usage", group: 1 },
  { id: "plugins", icon: Puzzle, label: "Plugins", group: 1 },
  { id: "inbox", icon: Bell, label: "Inbox", group: 2 },
  { id: "companion", icon: Bot, label: "Companion", group: 2 },
  { id: "settings", icon: Settings, label: "Settings", group: 2 },
];

const GROUPS = [0, 1, 2].map((g) => TOOLS.filter((t) => t.group === g));

export function Rail({ badges }: { badges: Partial<Record<Tool, number>> }) {
  const tool = useUi((s) => s.tool);
  // Item offsets within the rail, so one indicator can glide between them.
  const [ys, setYs] = useState<Partial<Record<Tool, number>>>({});
  const measure = useCallback(
    (id: Tool, y: number) => setYs((m) => (m[id] === y ? m : { ...m, [id]: y })),
    [],
  );
  const y = ys[tool];
  const glide = useMemo(
    () => (y === undefined ? null : [s.glide, { transform: [{ translateY: y + 6 }] }]),
    [y],
  );
  const items = (g: number) =>
    GROUPS[g].map((t) => (
      <RailItem key={t.id} meta={t} on={tool === t.id} badge={badges[t.id]} onMeasure={measure} />
    ));
  return (
    <View style={s.rail}>
      {glide && <View style={glide} />}
      <View style={s.logo}>
        <Logo size={26} />
      </View>
      {items(0)}
      <View style={s.sep} />
      {items(1)}
      <View style={s.spacer} />
      {items(2)}
    </View>
  );
}

function iconTint(on: boolean, hovered: boolean): string {
  if (on) return color.cyan2;
  return hovered ? color.text : color.faint;
}

function RailItem({
  meta,
  on,
  badge,
  onMeasure,
}: {
  meta: ToolMeta;
  on: boolean;
  badge?: number;
  onMeasure: (id: Tool, y: number) => void;
}) {
  const { id, icon: Icon, label } = meta;
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => onMeasure(id, e.nativeEvent.layout.y),
    [id, onMeasure],
  );
  const onPress = useCallback(() => useUi.getState().setTool(id), [id]);
  return (
    <View onLayout={onLayout}>
      <Pressable onPress={onPress} accessibilityLabel={label}>
        {({ hovered }) => (
          <>
            <Cut size={on ? 12 : 8} style={[s.ri, hovered && s.riHover, on && s.riOn]}>
              <Icon size={18} strokeWidth={1.6} color={iconTint(on, !!hovered)} />
            </Cut>
            {!!badge && (
              <View style={s.badge}>
                <T style={s.badgeT}>{badge}</T>
              </View>
            )}
          </>
        )}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  rail: {
    width: 58,
    alignItems: "center",
    gap: 4,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: color.bg,
    borderRightWidth: 1,
    borderRightColor: color.line,
  },
  logo: { marginBottom: 10 },
  spacer: { flex: 1 },
  sep: {
    width: 22,
    borderTopWidth: 1,
    borderStyle: "dashed",
    borderTopColor: color.line2,
    marginVertical: 6,
  },
  ri: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.wash,
  },
  riHover: { backgroundColor: "rgba(255,255,255,0.08)" },
  riOn: {
    backgroundColor: "rgba(37,181,200,0.16)",
    ...web({
      backgroundImage: "linear-gradient(135deg, #7fd9e633, #045b9d33)",
    }),
  },
  glide: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 2,
    height: 28,
    backgroundColor: color.cyan2,
    ...web({
      backgroundImage: "linear-gradient(#7fd9e6, #045b9d)",
      transition: "transform 450ms cubic-bezier(0.22, 1, 0.36, 1)",
    }),
  },
  badge: {
    position: "absolute",
    right: 1,
    top: 1,
    minWidth: 14,
    height: 14,
    paddingHorizontal: 3,
    backgroundColor: color.amber,
  },
  badgeT: {
    fontFamily: font.mono,
    fontSize: 9,
    lineHeight: 14,
    fontWeight: "600",
    color: "#1a1204",
    textAlign: "center",
  },
});
