import Svg, { Circle } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import type { ChecksProgress } from "@/git/checks-progress";

/**
 * A ring that fills as a CI run completes: a full-circle track with an arc over it
 * covering the finished share of the run.
 *
 * Geometry is expressed in a fixed viewBox and scaled to `size`, so the same component
 * rings a 16pt project icon in the sidebar and a larger header button without the
 * stroke drifting between them.
 */
const VIEW_BOX = 24;
const STROKE_WIDTH = 2;
const CENTER = VIEW_BOX / 2;
const RADIUS = (VIEW_BOX - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface RingPalette {
  track: string;
  arc: string;
}

const paletteMapping = (theme: Theme): { palette: RingPalette } => ({
  palette: {
    track: theme.colors.surface3,
    // Pending is the warning tone everywhere else in the checks UI, and a run in flight
    // is that same state, so the ring carries the same colour rather than inventing one.
    arc: theme.colors.statusWarning,
  },
});

function ChecksProgressRingSvg({
  progress,
  size,
  palette,
}: {
  progress: ChecksProgress;
  size: number;
  palette: RingPalette;
}) {
  const dash = CIRCUMFERENCE * Math.min(Math.max(progress.fraction, 0), 1);

  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${VIEW_BOX} ${VIEW_BOX}`}
      style={styles.svg}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Circle
        cx={CENTER}
        cy={CENTER}
        r={RADIUS}
        fill="none"
        stroke={palette.track}
        strokeWidth={STROKE_WIDTH}
      />
      {dash > 0 ? (
        <Circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke={palette.arc}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
        />
      ) : null}
    </Svg>
  );
}

const ThemedChecksProgressRingSvg = withUnistyles(ChecksProgressRingSvg);

export function ChecksProgressRing({ progress, size }: { progress: ChecksProgress; size: number }) {
  return <ThemedChecksProgressRingSvg progress={progress} size={size} uniProps={paletteMapping} />;
}

const styles = StyleSheet.create(() => ({
  svg: {
    // SVG strokes start at three o'clock; the ring reads clockwise from twelve.
    transform: [{ rotate: "-90deg" }],
  },
}));
