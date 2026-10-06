import { View } from "react-native";
import type { Bucket } from "../daemon/types";
import { color } from "../theme/tokens";

export const bucketColor: Record<Bucket, string> = {
  needs: color.amber,
  failed: color.coral,
  review: color.mint,
  working: color.cyan,
  idle: color.faint,
};

/** Diamond = needs you, square = failed, dot = review, triangle = working, hollow = idle. */
export function StatusGlyph({ bucket, size = 9 }: { bucket: Bucket; size?: number }) {
  const c = bucketColor[bucket];
  if (bucket === "needs")
    return <View style={{ width: size, height: size, backgroundColor: c, transform: [{ rotate: "45deg" }] }} />;
  if (bucket === "failed") return <View style={{ width: size, height: size, backgroundColor: c }} />;
  if (bucket === "review") return <View style={{ width: size, height: size, borderRadius: size, backgroundColor: c }} />;
  if (bucket === "working")
    return (
      <View
        style={{
          width: 0, height: 0, borderTopWidth: size / 2, borderBottomWidth: size / 2, borderLeftWidth: size,
          borderTopColor: "transparent", borderBottomColor: "transparent", borderLeftColor: c,
        }}
      />
    );
  return (
    <View style={{ width: size - 2, height: size - 2, borderWidth: 1, borderColor: c, transform: [{ rotate: "45deg" }] }} />
  );
}
