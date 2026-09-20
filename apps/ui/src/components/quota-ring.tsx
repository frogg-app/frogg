import { Pressable, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { COMPOSER_METER_GLYPH_SIZE, COMPOSER_METER_SLOT_WIDTH } from "@/composer/meter-geometry";
import type { ProviderUsageColumn } from "@/provider-usage/account-summary";
import type { Theme } from "@/styles/theme";

interface QuotaRingProps {
  column: ProviderUsageColumn;
  /** The single character drawn in the ring's middle, naming the window it measures. */
  glyph: string;
  /** Outer diameter of the ring glyph, matching the context meter's envelope. */
  size: number;
  testID?: string;
}

interface RingPalette {
  track: string;
  arc: string;
}

/** The context meter's own ramp, so a spent quota reads the same as a full context window. */
function arcColor(pct: number | null, theme: Theme): string {
  if (pct == null) return theme.colors.surface3;
  if (pct > 90) return theme.colors.destructive;
  if (pct >= 70) return theme.colors.palette.amber[500];
  return theme.colors.foregroundMuted;
}

/**
 * Colours arrive as one themed prop rather than through `uniProps` on the SVG primitives:
 * `withUnistyles` resolves its mapping into props of the component it wraps, and
 * `react-native-svg`'s `Circle` takes `stroke` as a plain prop it never sees, so a mapped
 * `Circle` renders with no stroke at all — an invisible ring. Wrapping a component of our own
 * is the pattern the rest of the app's rings use.
 */
function ringPaletteMapping(pct: number | null) {
  return (theme: Theme): { palette: RingPalette } => ({
    palette: { track: theme.colors.surface3, arc: arcColor(pct, theme) },
  });
}

function QuotaRingSvg({
  pct,
  size,
  palette,
}: {
  pct: number | null;
  size: number;
  palette: RingPalette;
}) {
  const strokeWidth = 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const dash = circumference * Math.min(Math.max((pct ?? 0) / 100, 0), 1);

  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={styles.svg}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={palette.track}
        strokeWidth={strokeWidth}
      />
      {dash > 0 ? (
        <Circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={palette.arc}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
        />
      ) : null}
    </Svg>
  );
}

const ThemedQuotaRingSvg = withUnistyles(QuotaRingSvg);

/**
 * One rolling quota window as a ring, drawn to the same geometry and colour ramp as the
 * context meter so the composer's three meters read as one family. A window with no reported
 * percentage still renders its track, because the tooltip's reset countdown is worth hovering
 * for and a missing ring would shift its siblings.
 */
export function QuotaRing({ column, glyph, size, testID }: QuotaRingProps) {
  const label = column.resetIn
    ? `${column.label} ${column.pctLabel} used · resets in ${column.resetIn}`
    : `${column.label} ${column.pctLabel} used`;

  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile>
      <TooltipTrigger asChild triggerRefProp="ref">
        <Pressable
          style={styles.container}
          testID={testID}
          accessibilityRole="image"
          accessibilityLabel={label}
        >
          <ThemedQuotaRingSvg
            pct={column.pct}
            size={size}
            uniProps={ringPaletteMapping(column.pct)}
          />
          <Text style={styles.glyph}>{glyph}</Text>
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <View style={styles.tooltipContent}>
          <Text style={styles.tooltipTitle}>{column.label}</Text>
          <Text style={styles.tooltipText}>{`${column.pctLabel} used`}</Text>
          {column.resetIn ? (
            <Text style={styles.tooltipDetail}>{`Resets in ${column.resetIn}`}</Text>
          ) : null}
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    width: COMPOSER_METER_SLOT_WIDTH,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  svg: {
    // SVG strokes start at three o'clock; the ring reads clockwise from twelve.
    transform: [{ rotate: "-90deg" }],
  },
  // The glyph sits over the ring rather than inside the SVG: an absolutely positioned Text
  // centres identically on web and native, where SVG text metrics do not.
  glyph: {
    position: "absolute",
    color: theme.colors.foregroundMuted,
    fontSize: COMPOSER_METER_GLYPH_SIZE,
    lineHeight: COMPOSER_METER_GLYPH_SIZE + 2,
    fontWeight: theme.fontWeight.normal,
  },
  tooltipContent: {
    gap: theme.spacing[1],
    minWidth: 140,
  },
  tooltipTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  tooltipDetail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
