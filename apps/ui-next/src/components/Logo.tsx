import Svg, { Defs, LinearGradient, Polygon, Stop } from "react-native-svg";

/** Faceted gem mark, after the frogg.dev logo. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Defs>
        <LinearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#7fd9e6" />
          <Stop offset="1" stopColor="#045b9d" />
        </LinearGradient>
      </Defs>
      <Polygon points="12,1 22,7 22,17 12,23 2,17 2,7" fill="url(#lg)" />
      <Polygon points="12,1 22,7 12,12" fill="#ffffff" opacity={0.28} />
      <Polygon points="2,17 12,12 12,23" fill="#000000" opacity={0.25} />
    </Svg>
  );
}
