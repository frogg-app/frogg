import { Pressable, Text, View } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { COMPOSER_METER_GLYPH_SIZE, COMPOSER_METER_SLOT_WIDTH } from "@/composer/meter-geometry";
import type { ProviderUsageColumn } from "@/provider-usage/account-summary";
import type { Theme } from "@/styles/theme";

/** Toolbar-button height: the glyph's line height, so one line centres in the slot. */
const METER_SLOT_HEIGHT = 28;

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
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Strokes start at three o'clock; the arc has to read clockwise from twelve. Rotating the
          group inside the SVG rather than the element with a CSS transform keeps the two agreeing
          across web and native. */}
      <G transform={`rotate(-90 ${center} ${center})`}>
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
      </G>
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
          <View pointerEvents="none" style={styles.glyphLayer}>
            <Text style={styles.glyph}>{glyph}</Text>
          </View>
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
    height: METER_SLOT_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  // The glyph sits over the ring rather than inside the SVG, where text metrics differ between
  // web and native. Centring is done by a layer that fills the slot and centres its child both
  // ways: `textAlign` alone only solves the horizontal axis, and a line height stretched to the
  // slot leaves the glyph riding high, because a line box centres the font's whole em — ascender
  // and descender — rather than the digit.
  glyphLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  glyph: {
    color: theme.colors.foregroundMuted,
    fontSize: COMPOSER_METER_GLYPH_SIZE,
    lineHeight: COMPOSER_METER_GLYPH_SIZE,
    fontWeight: theme.fontWeight.normal,
    includeFontPadding: false,
    textAlignVertical: "center",
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
