import { create } from "qrcode";
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { color } from "../../theme/tokens";

/** A QR code drawn as one SVG path, so it renders the same on web and native. */
export function Qr({ value, size = 200 }: { value: string; size?: number }) {
  const { d, n } = useMemo(() => {
    const qr = create(value, { errorCorrectionLevel: "M" });
    const count = qr.modules.size;
    let path = "";
    for (let y = 0; y < count; y++) {
      let x = 0;
      while (x < count) {
        if (!qr.modules.get(y, x)) {
          x++;
          continue;
        }
        const start = x;
        while (x < count && qr.modules.get(y, x)) x++;
        path += `M${start + 2} ${y + 2}h${x - start}v1h-${x - start}z`;
      }
    }
    return { d: path, n: count + 4 };
  }, [value]);
  return (
    <View style={s.wrap}>
      <Svg width={size} height={size} viewBox={`0 0 ${n} ${n}`}>
        <Rect width={n} height={n} fill={color.text} />
        <Path d={d} fill={color.bg} />
      </Svg>
    </View>
  );
}

const s = StyleSheet.create({ wrap: { alignSelf: "flex-start" } });
