import {
  Bell, Bot, CircleGauge, Files, FolderGit2, GitPullRequest, Layers, ListChecks, Puzzle,
  Search, Server, Settings, SquareTerminal, type LucideIcon,
} from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { color, font, web } from "../theme/tokens";
import { useUi, type Tool } from "../ui-store";
import { Cut } from "./Cut";
import { Logo } from "./Logo";
import { T } from "./Text";

export const TOOLS: Array<{ id: Tool; icon: LucideIcon; label: string; group: 0 | 1 | 2 }> = [
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

export function Rail({ badges }: { badges: Partial<Record<Tool, number>> }) {
  const tool = useUi((s) => s.tool);
  const setTool = useUi((s) => s.setTool);
  const group = (g: number) =>
    TOOLS.filter((t) => t.group === g).map((t) => (
      <RailItem key={t.id} {...t} on={tool === t.id} badge={badges[t.id]} onPress={() => setTool(t.id)} />
    ));
  return (
    <View style={s.rail}>
      <View style={{ marginBottom: 10 }}>
        <Logo size={26} />
      </View>
      {group(0)}
      <View style={s.sep} />
      {group(1)}
      <View style={{ flex: 1 }} />
      {group(2)}
    </View>
  );
}

function RailItem({ icon: Icon, label, on, badge, onPress }: {
  icon: LucideIcon; label: string; on: boolean; badge?: number; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} style={{ position: "relative" }}>
      {({ hovered }) => (
        <>
          {on && <View style={s.ind} />}
          <Cut size={on ? 12 : 8} style={[s.ri, hovered && s.riHover, on && s.riOn]}>
            <Icon size={18} strokeWidth={1.6} color={on ? color.cyan2 : hovered ? color.text : color.faint} />
          </Cut>
          {!!badge && (
            <View style={s.badge}>
              <T style={s.badgeT}>{badge}</T>
            </View>
          )}
        </>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  rail: {
    width: 58, alignItems: "center", gap: 4, paddingTop: 12, paddingBottom: 10,
    backgroundColor: color.bg, borderRightWidth: 1, borderRightColor: color.line,
  },
  sep: { width: 22, borderTopWidth: 1, borderStyle: "dashed", borderTopColor: color.line2, marginVertical: 6 },
  ri: { width: 40, height: 40, alignItems: "center", justifyContent: "center", backgroundColor: color.wash },
  riHover: { backgroundColor: "rgba(255,255,255,0.08)" },
  riOn: {
    backgroundColor: "rgba(37,181,200,0.16)",
    ...web({ backgroundImage: "linear-gradient(135deg, #7fd9e633, #045b9d33)" }),
  },
  ind: { position: "absolute", left: -9, top: 6, bottom: 6, width: 2, backgroundColor: color.cyan2 },
  badge: { position: "absolute", right: 1, top: 1, minWidth: 14, height: 14, paddingHorizontal: 3, backgroundColor: color.amber },
  badgeT: { fontFamily: font.mono, fontSize: 9, lineHeight: 14, fontWeight: "600", color: "#1a1204", textAlign: "center" },
});
