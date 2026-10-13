import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { glide, subworkMs } from "../../theme/tokens";
import { useReducedMotion } from "../Meter";

const curve = Easing.bezier(...glide.curve);

/**
 * Height that glides open and shut around its children. Children mount while open (and while
 * closing); the first open of an initially open block is instant, later changes animate,
 * including the content growing while open. Instant under reduced motion.
 */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const reduced = useReducedMotion();
  const [full, setFull] = useState(0);
  const [mounted, setMounted] = useState(open);
  const v = useRef(new Animated.Value(0)).current;
  const placed = useRef(false);
  const onLayout = useCallback((e: LayoutChangeEvent) => setFull(e.nativeEvent.layout.height), []);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  useEffect(() => {
    if (open && !full) return undefined;
    const to = open ? full : 0;
    if (reduced || (!placed.current && open)) {
      v.setValue(to);
      placed.current = placed.current || open;
      if (!open) setMounted(false);
      return undefined;
    }
    placed.current = true;
    const a = Animated.timing(v, {
      toValue: to,
      duration: subworkMs.collapse,
      easing: curve,
      useNativeDriver: false,
    });
    a.start(({ finished }) => {
      if (finished && !open) setMounted(false);
    });
    return () => a.stop();
  }, [open, full, reduced, v]);
  const clip = useMemo(() => [s.clip, { height: v }], [v]);
  if (!mounted && !open) return null;
  return (
    <Animated.View style={clip}>
      <View style={s.inner} onLayout={onLayout}>
        {children}
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  clip: { overflow: "hidden" },
  inner: { position: "absolute", left: 0, right: 0, top: 0 },
});
