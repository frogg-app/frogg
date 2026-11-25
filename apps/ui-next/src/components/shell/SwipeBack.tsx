import { useMemo, useRef, type ReactNode } from "react";
import {
  Animated,
  Easing,
  PanResponder,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { color } from "../../theme/tokens";
import { useReduceMotion } from "../nativeMotion";

/** Touches must start this close to the left edge, so horizontal scrollers inside keep working. */
const EDGE = 28;
/** Past this share of the width, or a fast flick, lets go into back. */
const COMMIT = 0.33;
const FLICK = 0.5;

/**
 * Phone: a pushed view follows a swipe from the left edge and pops on release, like iOS back.
 * `onBack` runs the same step as Android hardware back.
 */
export function SwipeBack({
  onBack,
  style,
  children,
}: {
  onBack: () => void;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const reduce = useReduceMotion();
  const x = useRef(new Animated.Value(0)).current;
  const live = useRef({ width, reduce, onBack });
  live.current = { width, reduce, onBack };
  const native = Platform.OS !== "web";

  const pan = useMemo(() => {
    const settle = (to: number, done?: () => void) =>
      Animated.timing(x, {
        toValue: to,
        duration: live.current.reduce ? 0 : 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: native,
      }).start(done);
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (e, g) =>
        e.nativeEvent.pageX - g.dx <= EDGE && g.dx > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderMove: (_, g) => x.setValue(Math.max(0, g.dx)),
      onPanResponderRelease: (_, g) => {
        const w = live.current.width;
        if (g.dx > w * COMMIT || g.vx > FLICK)
          settle(w, () => {
            live.current.onBack();
            x.setValue(0);
          });
        else settle(0);
      },
      onPanResponderTerminate: () => settle(0),
      onPanResponderTerminationRequest: () => false,
    });
  }, [x, native]);

  const slide = useMemo(() => [s.fill, { transform: [{ translateX: x }] }], [x]);
  const shade = useMemo(
    () => [
      s.shade,
      { opacity: x.interpolate({ inputRange: [0, Math.max(width, 1)], outputRange: [0.4, 0] }) },
    ],
    [x, width],
  );
  return (
    <View style={style} {...pan.panHandlers}>
      <Animated.View style={shade} pointerEvents="none" />
      <Animated.View style={slide}>{children}</Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg },
  shade: { ...StyleSheet.absoluteFillObject, backgroundColor: color.scrim },
});
