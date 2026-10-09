import {
  Bell,
  Bot,
  CircleGauge,
  Files,
  FolderGit2,
  GitPullRequest,
  Layers,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
  Puzzle,
  Search,
  Server,
  Settings,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { usePrefs, setPref } from "../prefs";
import { color, ease, font, web } from "../theme/tokens";
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

export const GROUP_NAMES = ["Work", "Host", "App"] as const;
export const GROUPS = [0, 1, 2].map((g) => TOOLS.filter((t) => t.group === g));

/** Hover-intent delay before the rail expands; leaving closes at once. */
const OPEN_DELAY = 140;
const COLLAPSED = 58;
const EXPANDED = 212;

export function Rail({ badges }: { badges: Partial<Record<Tool, number>> }) {
  const tool = useUi((s) => s.tool);
  const pinned = usePrefs((p) => p.railPinned);
  const logoMotion = usePrefs((p) => p.logoMotion);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  // After a pick the rail folds away until the pointer reaches another item, leaves, or
  // keyboard focus moves on.
  const [suppressed, setSuppressed] = useState(false);
  const picked = useRef<Tool | null>(null);
  const inside = useRef(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (openTimer.current) clearTimeout(openTimer.current);
      if (blurTimer.current) clearTimeout(blurTimer.current);
    },
    [],
  );
  const open = pinned || ((hover || focus) && !suppressed);

  const onEnter = useCallback(() => {
    inside.current = true;
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => setHover(true), OPEN_DELAY);
  }, []);
  const onLeave = useCallback(() => {
    inside.current = false;
    if (openTimer.current) clearTimeout(openTimer.current);
    setHover(false);
    setSuppressed(false);
    picked.current = null;
  }, []);
  const onItemHover = useCallback((id: Tool) => {
    if (picked.current === null || picked.current === id) return;
    picked.current = null;
    setSuppressed(false);
  }, []);
  const onItemFocus = useCallback(() => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    // Mouse clicks focus too; only keyboard focus (pointer elsewhere) opens the rail.
    if (inside.current) return;
    setSuppressed(false);
    setFocus(true);
  }, []);
  const onItemBlur = useCallback(() => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    blurTimer.current = setTimeout(() => setFocus(false), 60);
  }, []);
  const onPick = useCallback((id: Tool) => {
    useUi.getState().setTool(id);
    picked.current = id;
    setSuppressed(true);
    setFocus(false);
  }, []);
  const togglePin = useCallback(() => {
    const next = !usePrefs.getState().railPinned;
    setPref("railPinned", next);
    if (!next) setSuppressed(true);
  }, []);

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
      <RailItem
        key={t.id}
        meta={t}
        on={tool === t.id}
        open={open}
        kbd={focus}
        badge={badges[t.id]}
        onMeasure={measure}
        onPick={onPick}
        onHover={onItemHover}
        onFocus={onItemFocus}
        onBlur={onItemBlur}
      />
    ));
  return (
    <View style={[s.slot, pinned && s.slotPinned]}>
      <View
        style={[s.rail, open && s.railOpen, open && !pinned && s.railFloat]}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
      >
        {glide && <View style={glide} />}
        <View style={s.logo}>
          <View style={s.logoMark}>
            <Logo size={26} motion={logoMotion} />
          </View>
          <T v="display" style={[s.word, open && s.labelOn]} numberOfLines={1}>
            frogg
          </T>
        </View>
        {items(0)}
        <View style={s.sep} />
        {items(1)}
        <View style={s.spacer} />
        {items(2)}
        <PinButton pinned={pinned} open={open} onPress={togglePin} />
      </View>
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
  open,
  kbd,
  badge,
  onMeasure,
  onPick,
  onHover,
  onFocus,
  onBlur,
}: {
  meta: ToolMeta;
  on: boolean;
  open: boolean;
  kbd: boolean;
  badge?: number;
  onMeasure: (id: Tool, y: number) => void;
  onPick: (id: Tool) => void;
  onHover: (id: Tool) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const { id, icon: Icon, label } = meta;
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => onMeasure(id, e.nativeEvent.layout.y),
    [id, onMeasure],
  );
  const onPress = useCallback(() => onPick(id), [id, onPick]);
  const onHoverIn = useCallback(() => onHover(id), [id, onHover]);
  const a11y = useMemo(() => ({ selected: on }), [on]);
  return (
    <View onLayout={onLayout} style={s.itemWrap}>
      <Pressable
        onPress={onPress}
        onHoverIn={onHoverIn}
        onFocus={onFocus}
        onBlur={onBlur}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={a11y}
        style={s.press}
      >
        {({ hovered, focused }) => (
          <Cut
            size={on ? 12 : 8}
            style={[s.ri, hovered && s.riHover, on && s.riOn, kbd && focused && s.riFocus]}
          >
            <View style={s.icon}>
              <Icon size={18} strokeWidth={1.6} color={iconTint(on, !!hovered)} />
              {!!badge && (
                <View style={s.badge}>
                  <T style={s.badgeT}>{badge}</T>
                </View>
              )}
            </View>
            <T style={[s.label, on && s.labelActive, open && s.labelOn]} numberOfLines={1}>
              {label}
            </T>
          </Cut>
        )}
      </Pressable>
    </View>
  );
}

function PinButton({
  pinned,
  open,
  onPress,
}: {
  pinned: boolean;
  open: boolean;
  onPress: () => void;
}) {
  const Icon = pinned ? PanelLeftClose : PanelLeftOpen;
  const label = pinned ? "Collapse rail" : "Keep rail open";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[s.press, s.pin]}
    >
      {({ hovered }) => (
        <View style={s.pinIn}>
          <View style={s.icon}>
            <Icon size={15} strokeWidth={1.6} color={hovered ? color.text : color.faint} />
          </View>
          <T style={[s.pinT, open && s.labelOn]} numberOfLines={1}>
            {label}
          </T>
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  // In-flow footprint: always the collapsed width unless pinned, so hovering never reflows.
  slot: { width: COLLAPSED, zIndex: 40, elevation: 12 },
  slotPinned: { width: EXPANDED },
  rail: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: COLLAPSED,
    overflow: "hidden",
    gap: 4,
    paddingTop: 12,
    paddingBottom: 8,
    paddingHorizontal: 9,
    backgroundColor: color.bg,
    borderRightWidth: 1,
    borderRightColor: color.line,
    ...web({ transition: `width 200ms ${ease}, box-shadow 200ms ease-out` }),
  },
  railOpen: { width: EXPANDED },
  railFloat: {
    borderRightColor: color.line2,
    shadowColor: "#000",
    shadowOpacity: 0.55,
    shadowRadius: 24,
    shadowOffset: { width: 8, height: 0 },
    elevation: 16,
    ...web({ boxShadow: "10px 0 28px rgba(0,0,0,0.55), 1px 0 0 rgba(127,217,230,0.08)" }),
  },
  logo: { flexDirection: "row", alignItems: "center", height: 30, marginBottom: 10 },
  logoMark: { width: 40, alignItems: "center" },
  word: {
    marginLeft: 6,
    fontSize: 16,
    opacity: 0,
    ...web({ transition: "opacity 180ms ease-out" }),
  },
  spacer: { flex: 1 },
  sep: {
    alignSelf: "stretch",
    height: 1,
    marginLeft: 6,
    marginVertical: 8,
    backgroundColor: color.line2,
    ...web({
      backgroundColor: "transparent",
      backgroundImage: `linear-gradient(90deg, ${color.line2}, transparent)`,
    }),
  },
  itemWrap: { alignSelf: "stretch" },
  press: { ...web({ outlineStyle: "none" }) },
  ri: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: color.wash,
  },
  icon: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  riHover: { backgroundColor: color.wash3 },
  riFocus: { borderWidth: 1, borderColor: "rgba(127,217,230,0.45)" },
  riOn: {
    backgroundColor: "rgba(37,181,200,0.16)",
    ...web({
      backgroundImage: "linear-gradient(135deg, #7fd9e62e, #25b5c81a)",
    }),
  },
  label: {
    flex: 1,
    marginLeft: 4,
    marginRight: 10,
    fontSize: 13,
    color: color.muted,
    opacity: 0,
    ...web({ transition: "opacity 160ms ease-out", whiteSpace: "nowrap" }),
  },
  labelActive: { color: color.cyan2 },
  labelOn: { opacity: 1, ...web({ transition: "opacity 200ms ease-out 60ms" }) },
  pin: { marginTop: 4 },
  pinIn: { height: 28, flexDirection: "row", alignItems: "center" },
  pinT: {
    marginLeft: 4,
    fontSize: 11.5,
    color: color.faint,
    opacity: 0,
    ...web({ transition: "opacity 160ms ease-out", whiteSpace: "nowrap" }),
  },
  glide: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 2,
    height: 28,
    backgroundColor: color.cyan2,
    ...web({
      backgroundImage: "linear-gradient(#7fd9e6, #25b5c8)",
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
