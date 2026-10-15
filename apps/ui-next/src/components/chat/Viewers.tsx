import { Globe, Laptop, Smartphone, Terminal } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { isActive, type Viewer } from "../../daemon/viewers";
import { color, motion } from "../../theme/tokens";
import { Cut } from "../Cut";
import { T } from "../Text";
import { Popover, useAnchor } from "../tools/Menu";
import { describeViewers, initials, tintOf } from "./viewersText";

/** Avatars shown before the rest fold into "+N". */
const STACK = 3;
function DeviceIcon({ v }: { v: Viewer }) {
  let Icon = Laptop;
  if (v.clientType === "mobile" || /pixel|phone|android|ios|iphone|galaxy/i.test(v.name))
    Icon = Smartphone;
  else if (v.clientType === "browser" || /web|browser|chrome|firefox|safari/i.test(v.name))
    Icon = Globe;
  else if (v.clientType === "cli" || v.clientType === "mcp") Icon = Terminal;
  return <Icon size={13} color={color.muted} />;
}

function Avatar({ v, first }: { v: Viewer; first: boolean }) {
  const st = useMemo(
    () => [s.avatar, !first && s.overlap, { backgroundColor: tintOf(v.key) }],
    [v.key, first],
  );
  return (
    <Cut size={4} style={st}>
      <T style={s.initials}>{initials(v.name)}</T>
    </Cut>
  );
}

/**
 * "Who else is here" above the composer: a small stack of device avatars and one sentence, led by
 * whoever is typing. Press for the full list. Draws nothing when nobody else has this session
 * open (or the host does not share presence), so a chat never twitches on open.
 */
export function Viewers({ viewers }: { viewers: Viewer[] }) {
  const pop = useAnchor();
  if (!viewers.length) return null;
  return (
    <>
      <View ref={pop.ref} collapsable={false} style={s.anchor}>
        <ViewersRow viewers={viewers} onPress={pop.open} />
      </View>
      <Popover rect={pop.rect} onClose={pop.close} width={260}>
        <ViewerList viewers={viewers} />
      </Popover>
    </>
  );
}

export function ViewersRow({ viewers, onPress }: { viewers: Viewer[]; onPress?: () => void }) {
  const { lead, rest } = describeViewers(viewers);
  const active = viewers.some(isActive);
  const shown = viewers.slice(0, STACK);
  const extra = viewers.length - shown.length;
  const label = `Also here: ${viewers.map((v) => v.name).join(", ")}`;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      {({ hovered }) => (
        <View style={[s.row, hovered && s.rowHover]}>
          <View style={s.stack}>
            {shown.map((v, i) => (
              <Avatar key={v.id} v={v} first={i === 0} />
            ))}
            {extra > 0 && (
              <Cut size={4} style={[s.avatar, s.overlap, s.more]}>
                <T style={s.moreT}>{`+${extra}`}</T>
              </Cut>
            )}
          </View>
          {active && <View style={s.live} />}
          <T numberOfLines={1} style={[s.lead, active && s.leadActive]}>
            {lead}
          </T>
          {!!rest && (
            <T numberOfLines={1} style={s.rest}>
              {`· ${rest}`}
            </T>
          )}
        </View>
      )}
    </Pressable>
  );
}

const ACTIVITY_TEXT: Record<Viewer["activity"], string> = {
  typing: "typing",
  sending: "sending",
  input: "answering",
  viewing: "viewing",
  idle: "idle",
};

/** Everyone else with this session open, for the popover. */
export function ViewerList({ viewers }: { viewers: Viewer[] }) {
  return (
    <View style={s.list}>
      <T v="label" style={s.listHead}>{`Also here · ${viewers.length}`}</T>
      {viewers.map((v) => (
        <ViewerRow key={v.id} v={v} />
      ))}
    </View>
  );
}

function ViewerRow({ v }: { v: Viewer }) {
  const active = isActive(v);
  return (
    <View style={s.item}>
      <Avatar v={v} first />
      <DeviceIcon v={v} />
      <T numberOfLines={1} style={s.itemName}>
        {v.name}
      </T>
      <T v="mono" style={[s.itemState, active && s.leadActive]}>
        {ACTIVITY_TEXT[v.activity]}
      </T>
    </View>
  );
}

const SIZE = 18;
const s = StyleSheet.create({
  anchor: { alignSelf: "flex-start", maxWidth: "100%", ...motion.enter },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  rowHover: { backgroundColor: color.wash2 },
  stack: { flexDirection: "row", alignItems: "center" },
  avatar: {
    width: SIZE,
    height: SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  overlap: { marginLeft: 2 },
  initials: { fontSize: 8.5, fontWeight: "700", color: color.onAccent },
  more: { backgroundColor: color.raise },
  moreT: { fontSize: 8.5, color: color.muted },
  live: {
    width: 6,
    height: 6,
    backgroundColor: color.mint,
    transform: [{ rotate: "45deg" }],
    ...motion.breathe,
  },
  lead: { fontSize: 12, color: color.muted, flexShrink: 1 },
  leadActive: { color: color.mint },
  rest: { fontSize: 12, color: color.faint },
  list: { paddingVertical: 6 },
  listHead: { paddingHorizontal: 12, paddingBottom: 6 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  itemName: { flex: 1, fontSize: 13, color: color.text },
  itemState: { fontSize: 11, color: color.faint },
});
