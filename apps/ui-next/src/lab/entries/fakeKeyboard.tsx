import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { T } from "../../components/Text";
import { color, glide } from "../../theme/tokens";

/** Height and timing of the stand-in IME: roughly a Gboard panel and Android's inset animation. */
export const KB_HEIGHT = 230;
export const KB_MS = 250;
const curve = Easing.bezier(...glide.curve);

const KEY_ROWS = [
  { id: "r1", keys: "qwertyuiop".split("") },
  { id: "r2", keys: "asdfghjkl".split("") },
  { id: "r3", keys: "zxcvbnm".split("") },
];

/**
 * Web stand-in for the Android keyboard: animates its height on the glide curve so the frame
 * above shrinks per frame, as adjustResize does on device with edge-to-edge insets animation.
 */
export function FakeKeyboard({ up }: { up: boolean }) {
  const h = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.timing(h, {
      toValue: up ? KB_HEIGHT : 0,
      duration: KB_MS,
      easing: curve,
      useNativeDriver: false,
    });
    a.start();
    return () => a.stop();
  }, [h, up]);
  return (
    <Animated.View style={[s.clip, { height: h }]}>
      <View style={s.kb}>
        {KEY_ROWS.map((r) => (
          <View key={r.id} style={s.kbRow}>
            {r.keys.map((k) => (
              <View key={k} style={s.key}>
                <T style={s.keyT}>{k}</T>
              </View>
            ))}
          </View>
        ))}
        <View style={s.kbRow}>
          <View style={s.space} />
        </View>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  clip: { overflow: "hidden", backgroundColor: color.raise },
  kb: { paddingVertical: 8, gap: 8, height: KB_HEIGHT },
  kbRow: { flexDirection: "row", justifyContent: "center", gap: 5 },
  key: {
    width: 30,
    height: 40,
    backgroundColor: color.wash3,
    alignItems: "center",
    justifyContent: "center",
  },
  keyT: { color: color.text },
  space: { width: 200, height: 40, backgroundColor: color.wash3 },
});
