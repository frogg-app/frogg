import { StyleSheet, View, type ViewStyle } from "react-native";
import type { Bucket } from "../daemon/types";
import { color, motion } from "../theme/tokens";

export const bucketColor: Record<Bucket, string> = {
  needs: color.amber,
  failed: color.coral,
  review: color.mint,
  working: color.cyan,
  idle: color.faint,
};

function shape(bucket: Bucket, size: number, still: boolean): ViewStyle {
  const c = bucketColor[bucket];
  switch (bucket) {
    case "needs":
      return {
        width: size,
        height: size,
        backgroundColor: c,
        transform: [{ rotate: "45deg" }],
      };
    case "failed":
      return { width: size, height: size, backgroundColor: c };
    case "review":
      return {
        width: size,
        height: size,
        borderRadius: size,
        backgroundColor: c,
      };
    case "working":
      return {
        width: 0,
        height: 0,
        borderTopWidth: size / 2,
        borderBottomWidth: size / 2,
        borderLeftWidth: size,
        borderTopColor: "transparent",
        borderBottomColor: "transparent",
        borderLeftColor: c,
        ...(still ? null : motion.breathe),
      };
    default:
      return {
        width: size - 2,
        height: size - 2,
        borderWidth: 1,
        borderColor: c,
        transform: [{ rotate: "45deg" }],
      };
  }
}

// A handful of bucket × size pairs are ever drawn; build each style once.
const cache = new Map<string, ViewStyle>();
function glyphStyle(bucket: Bucket, size: number, still: boolean): ViewStyle {
  const key = `${bucket}:${size}:${still}`;
  let style = cache.get(key);
  if (!style) {
    style = StyleSheet.create({ g: shape(bucket, size, still) }).g;
    cache.set(key, style);
  }
  return style;
}

/** Diamond = needs you, square = failed, dot = review, triangle = working (breathing), hollow = idle. */
export function StatusGlyph({
  bucket,
  size = 9,
  still = false,
}: {
  bucket: Bucket;
  size?: number;
  still?: boolean;
}) {
  return <View style={glyphStyle(bucket, size, still)} />;
}
