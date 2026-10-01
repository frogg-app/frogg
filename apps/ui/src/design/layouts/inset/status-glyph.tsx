import { memo } from "react";
import Svg, { Circle, Path } from "react-native-svg";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

// Linear-style status glyphs: an outlined ring whose pie fills as work progresses, and a solid
// disc with a mark once it has stopped. Colours stay the app's status-dot band so a state reads
// the same here as everywhere else.

type GlyphShape = "pie-half" | "pie-most" | "check" | "cross" | "idle";

const SHAPES: Record<SidebarStateBucket, GlyphShape> = {
  running: "pie-half",
  needs_input: "pie-most",
  attention: "check",
  failed: "cross",
  done: "idle",
};

interface GlyphProps {
  shape: GlyphShape;
  size: number;
  /** Filled in by the theme mapping. */
  color?: string;
  contrast?: string;
}

const CENTER = 7;
const RING_RADIUS = 5.5;
const PIE_RADIUS = 3;

// A clockwise pie from 12 o'clock covering `fraction` of the disc.
function piePath(fraction: number): string {
  const angle = fraction * 2 * Math.PI;
  const x = CENTER + PIE_RADIUS * Math.sin(angle);
  const y = CENTER - PIE_RADIUS * Math.cos(angle);
  const large = fraction > 0.5 ? 1 : 0;
  return `M${CENTER} ${CENTER} L${CENTER} ${CENTER - PIE_RADIUS} A${PIE_RADIUS} ${PIE_RADIUS} 0 ${large} 1 ${x.toFixed(3)} ${y.toFixed(3)} Z`;
}

const HALF_PIE = piePath(0.5);
const MOST_PIE = piePath(0.75);

const GlyphBase = memo(function GlyphBase({
  shape,
  size,
  color = "currentColor",
  contrast = "transparent",
}: GlyphProps) {
  if (shape === "check" || shape === "cross") {
    return (
      <Svg width={size} height={size} viewBox="0 0 14 14">
        <Circle cx={CENTER} cy={CENTER} r={6.5} fill={color} />
        <Path
          d={shape === "check" ? "M4.3 7.2 L6.2 9.1 L9.7 5.3" : "M5 5 L9 9 M9 5 L5 9"}
          stroke={contrast}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14">
      <Circle
        cx={CENTER}
        cy={CENTER}
        r={RING_RADIUS}
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray={shape === "idle" ? "2 1.6" : undefined}
        fill="none"
      />
      {shape === "pie-half" ? <Path d={HALF_PIE} fill={color} /> : null}
      {shape === "pie-most" ? <Path d={MOST_PIE} fill={color} /> : null}
    </Svg>
  );
});

const ThemedGlyph = withUnistyles(GlyphBase);

const MAPPINGS: Record<SidebarStateBucket, (theme: Theme) => { color: string; contrast: string }> =
  {
    running: (theme) => ({ color: theme.colors.statusDotRunning, contrast: theme.colors.surface0 }),
    needs_input: (theme) => ({
      color: theme.colors.statusDotWarning,
      contrast: theme.colors.surface0,
    }),
    attention: (theme) => ({ color: theme.colors.accent, contrast: theme.colors.surface0 }),
    failed: (theme) => ({ color: theme.colors.statusDotDanger, contrast: theme.colors.surface0 }),
    done: (theme) => ({
      color: theme.colors.foregroundExtraMuted,
      contrast: theme.colors.surface0,
    }),
  };

export function InsetStatusGlyph({
  bucket,
  size = 14,
}: {
  bucket: SidebarStateBucket;
  size?: number;
}) {
  return <ThemedGlyph shape={SHAPES[bucket]} size={size} uniProps={MAPPINGS[bucket]} />;
}
