import { ChevronDown } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { color, ease, font, glide, web } from "../../theme/tokens";
import { useReducedMotion } from "../Meter";
import { T } from "../Text";

const curve = Easing.bezier(...glide.curve);
/** Content only this much taller than the cap shows in full: a toggle for a few lines is noise. */
const SLACK = 64;
const FADE = 56;
const EXPANDED = { expanded: true };
const COLLAPSED = { expanded: false };

/** Height of a see more / see less glide: quick for short reveals, capped for huge ones. */
const msFor = (dist: number) => Math.round(Math.min(420, 200 + dist / 8));

/**
 * Caps tall content at `cap` with a fade and a "Show more" bar; the height glides open to the
 * full content and back. Content that fits (within a small slack) renders as is.
 */
export function Clamp({ cap, children }: { cap: number; children: ReactNode }) {
  const reduced = useReducedMotion();
  const [full, setFull] = useState(0);
  const [open, setOpen] = useState(false);
  const h = useRef(new Animated.Value(cap)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const placed = useRef(false);
  const clamps = full > cap + SLACK;
  const onLayout = useCallback((e: LayoutChangeEvent) => setFull(e.nativeEvent.layout.height), []);
  const toggle = useCallback(() => setOpen((o) => !o), []);

  useEffect(() => {
    if (!full) return undefined;
    const to = open || !clamps ? full : cap;
    if (reduced || !placed.current) {
      placed.current = true;
      h.setValue(to);
      fade.setValue(open ? 0 : 1);
      return undefined;
    }
    const ms = msFor(Math.abs(full - cap));
    const a = Animated.parallel([
      Animated.timing(h, { toValue: to, duration: ms, easing: curve, useNativeDriver: false }),
      Animated.timing(fade, {
        toValue: open ? 0 : 1,
        duration: ms,
        easing: curve,
        useNativeDriver: false,
      }),
    ]);
    a.start();
    return () => a.stop();
  }, [open, full, cap, clamps, reduced, h, fade]);

  const clip = useMemo(() => [s.clip, { height: h }], [h]);
  const veil = useMemo(() => [s.veil, { opacity: fade }], [fade]);
  return (
    <View>
      <Animated.View style={clip}>
        <View style={s.inner} onLayout={onLayout}>
          {children}
        </View>
        {clamps && <Animated.View pointerEvents="none" style={veil} />}
      </Animated.View>
      {clamps && (
        <Pressable
          onPress={toggle}
          accessibilityRole="button"
          accessibilityState={open ? EXPANDED : COLLAPSED}
          accessibilityLabel={open ? "Show less" : "Show more"}
        >
          {({ hovered }) => (
            <View style={[s.bar, hovered && s.barHover]}>
              <View style={open ? s.chevUp : s.chev}>
                <ChevronDown size={13} color={hovered ? color.text : color.cyan2} />
              </View>
              <T style={[s.barT, hovered && s.barTHover]}>{open ? "Show less" : "Show more"}</T>
            </View>
          )}
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  clip: { overflow: "hidden" },
  inner: { position: "absolute", left: 0, right: 0, top: 0 },
  veil: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: FADE,
    backgroundColor: "rgba(8,11,13,0.6)",
    ...web({
      backgroundColor: "transparent",
      backgroundImage: `linear-gradient(180deg, rgba(8,11,13,0) 0%, ${color.bg} 100%)`,
    }),
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: color.line,
    backgroundColor: color.bg,
    ...web({ transition: "background-color 150ms ease-out" }),
  },
  barHover: { backgroundColor: color.wash2 },
  barT: { fontSize: 12, color: color.cyan2, fontFamily: font.body },
  barTHover: { color: color.text },
  chev: { transform: [{ rotate: "0deg" }], ...web({ transition: `transform 200ms ${ease}` }) },
  chevUp: { transform: [{ rotate: "180deg" }], ...web({ transition: `transform 200ms ${ease}` }) },
});
