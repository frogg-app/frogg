import { ChevronDown } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { useSubWork } from "../../daemon/subwork";
import { color, subworkMs } from "../../theme/tokens";
import { useUi } from "../../ui-store";
import { Num } from "../CountUp";
import { T } from "../Text";
import { Collapse } from "./Collapse";
import { openSubWork } from "./hooks";
import { rollup, visibleItems, type SubWork, type SubWorkStatus } from "./model";
import { expandedState, statusColor, SubWorkTree, useLoop01, usePulse, useSettle } from "./views";

/**
 * The slim live strip under the chat header while sub-work runs: a count and the running names,
 * expanding to the list. When the last one settles it stays for `subworkMs.linger` with the
 * result and one settle flash (mint glow for done, a sharp coral flash if anything failed).
 */
export function SubWorkStripView({
  items,
  onOpen,
  onAll,
}: {
  items: SubWork[];
  onOpen?: (item: SubWork) => void;
  onAll?: () => void;
}) {
  const shown = useMemo(() => visibleItems(items), [items]);
  const r = rollup(shown);
  const busy = r.running + r.attention > 0;
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  // Hold the strip open for a moment after the last item settles so the result is readable.
  const [linger, setLinger] = useState(false);
  const was = useRef(busy);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (was.current && !busy && r.total > 0) {
      setLinger(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setLinger(false), subworkMs.linger);
    }
    was.current = busy;
  }, [busy, r.total]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const visible = busy || linger;
  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);
  let tone: SubWorkStatus = "done";
  if (busy) tone = "running";
  else if (r.failed) tone = "failed";
  const settle = useSettle(tone);
  const live = busy;
  const beam = useLoop01(live, subworkMs.beam, 240);
  const pulse = usePulse(live);
  const names = shown
    .filter((x) => x.status === "running" || x.status === "attention")
    .map((x) => x.label);
  const head = names.slice(0, 2).join(", ");
  const extra = names.length - 2;
  const flash = useMemo(
    () => [
      s.flash,
      {
        backgroundColor: settle.kind === "failed" ? color.coral : color.mint,
        opacity: settle.flash.interpolate({ inputRange: [0, 1], outputRange: [0, 0.22] }),
      },
    ],
    [settle.flash, settle.kind],
  );
  const band = useMemo(
    () => [
      s.beam,
      {
        left: beam.interpolate({ inputRange: [0, 1], outputRange: ["-30%", "100%"] }),
        opacity: beam.interpolate({
          inputRange: [0, 0.15, 0.85, 1],
          outputRange: [0, 0.18, 0.18, 0],
        }),
      },
    ],
    [beam],
  );
  const mark = useMemo(
    () => [s.mark, { backgroundColor: statusColor[tone], opacity: live ? pulse : 1 }],
    [tone, live, pulse],
  );
  let result = "All finished";
  if (r.failed) result = `${r.failed} failed · ${r.done} finished`;
  return (
    <Collapse open={visible}>
      <View style={s.wrap}>
        <Pressable
          onPress={toggle}
          accessibilityRole="button"
          accessibilityState={expandedState(open)}
          accessibilityLabel="Sub-processes"
        >
          {({ hovered }) => (
            <View style={[s.bar, hovered && s.barHover]}>
              <View pointerEvents="none" style={s.beamClip}>
                {live && <Animated.View style={band} />}
              </View>
              <Animated.View pointerEvents="none" style={flash} />
              <Animated.View style={mark} />
              {busy ? (
                <>
                  <Num value={r.running + r.attention} style={s.n} />
                  <T style={s.label}>running</T>
                  <T numberOfLines={1} style={s.names}>
                    {head}
                    {extra > 0 ? ` +${extra}` : ""}
                  </T>
                </>
              ) : (
                <T numberOfLines={1} style={[s.label, r.failed > 0 && s.fail]}>
                  {result}
                </T>
              )}
              <View style={s.grow} />
              <Chev open={open} />
            </View>
          )}
        </Pressable>
        <Collapse open={open && visible}>
          <View style={s.list}>
            <SubWorkTree items={shown} onOpen={onOpen} max={8} />
            {onAll && (
              <Pressable onPress={onAll} style={s.all} accessibilityRole="link">
                <T style={s.allT}>Open in Tasks</T>
              </Pressable>
            )}
          </View>
        </Collapse>
      </View>
    </Collapse>
  );
}

function Chev({ open }: { open: boolean }) {
  const st = useMemo(() => (open ? s.chevOpen : s.chev), [open]);
  return <ChevronDown size={13} color={color.faint} style={st} />;
}

/** The strip for the open session, wired to the live sub-work. */
export function SubWorkStrip({ sessionId }: { sessionId: string }) {
  const { items } = useSubWork(sessionId);
  const onOpen = useCallback((item: SubWork) => openSubWork(sessionId, item), [sessionId]);
  const onAll = useCallback(() => useUi.getState().setTool("tasks"), []);
  return <SubWorkStripView items={items} onOpen={onOpen} onAll={onAll} />;
}

const s = StyleSheet.create({
  wrap: { borderBottomWidth: 1, borderBottomColor: color.line, backgroundColor: color.panel },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 24,
    paddingVertical: 7,
    overflow: "hidden",
  },
  barHover: { backgroundColor: color.wash },
  flash: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0 },
  beamClip: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, overflow: "hidden" },
  beam: { position: "absolute", top: 0, bottom: 0, width: "30%", backgroundColor: color.cyan2 },
  mark: { width: 6, height: 6, transform: [{ rotate: "45deg" }] },
  n: { fontSize: 12, color: color.cyan2 },
  label: { fontSize: 12, color: color.muted },
  fail: { color: color.coral },
  names: { flexShrink: 1, fontSize: 12, color: color.faint },
  grow: { flex: 1 },
  chev: { transform: [{ rotate: "0deg" }] },
  chevOpen: { transform: [{ rotate: "180deg" }] },
  list: { paddingHorizontal: 24, paddingBottom: 8 },
  all: { paddingVertical: 6, paddingLeft: 18 },
  allT: { fontSize: 12, color: color.cyan2 },
});
