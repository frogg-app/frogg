import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MeterCenterGlyph } from "@/components/meter-center-glyph";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { COMPOSER_METER_GLYPH_SIZE, COMPOSER_METER_SLOT_WIDTH } from "@/composer/meter-geometry";
import { useEasedColor } from "@/hooks/use-eased-color";
import { useEasedValue } from "@/hooks/use-eased-value";
import type { ProviderUsageColumn } from "@/provider-usage/account-summary";
import {
  USAGE_METER_TRANSITION_MS,
  deriveUsageTone,
  type UsageMeterPreferences,
} from "@/provider-usage/meter-preferences";
import { useUsageMeterPreferences } from "@/provider-usage/use-meter-preferences";
import type { Theme } from "@/styles/theme";

/** Toolbar-button height: the glyph's line height, so one line centres in the slot. */
const METER_SLOT_HEIGHT = 28;

interface QuotaRingProps {
  column: ProviderUsageColumn;
  /** Called when the ring's tooltip opens, so a deliberate look can refetch first. */
  onOpen?: () => Promise<void> | void;
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
function arcColor(pct: number | null, thresholds: UsageMeterPreferences, theme: Theme): string {
  if (pct == null) return theme.colors.surface3;
  const tone = deriveUsageTone(pct, thresholds);
  if (tone === "danger") return theme.colors.destructive;
  if (tone === "warning") return theme.colors.palette.amber[500];
  return theme.colors.foregroundMuted;
}

/**
 * Colours arrive as one themed prop rather than through `uniProps` on the SVG primitives:
 * `withUnistyles` resolves its mapping into props of the component it wraps, and
 * `react-native-svg`'s `Circle` takes `stroke` as a plain prop it never sees, so a mapped
 * `Circle` renders with no stroke at all — an invisible ring. Wrapping a component of our own
 * is the pattern the rest of the app's rings use.
 */
function ringPaletteMapping(pct: number | null, thresholds: UsageMeterPreferences) {
  return (theme: Theme): { palette: RingPalette } => ({
    palette: { track: theme.colors.surface3, arc: arcColor(pct, thresholds, theme) },
  });
}

function QuotaRingSvg({
  pct,
  size,
  palette,
  animate,
}: {
  pct: number | null;
  size: number;
  palette: RingPalette;
  animate: boolean;
}) {
  const strokeWidth = 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  // Arc and colour travel together: a quota that has just crossed a threshold should
  // sweep to its new length while it warms, rather than jumping twice.
  const easedPct = useEasedValue(
    Math.min(Math.max(pct ?? 0, 0), 100),
    USAGE_METER_TRANSITION_MS,
    animate,
  );
  const easedArc = useEasedColor(palette.arc, USAGE_METER_TRANSITION_MS, animate);
  const dash = circumference * (easedPct / 100);

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
            stroke={easedArc}
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
export function QuotaRing({ column, glyph, size, onOpen, testID }: QuotaRingProps) {
  const preferences = useUsageMeterPreferences();
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen && onOpen) {
        void Promise.resolve(onOpen()).catch(() => {});
      }
    },
    [onOpen],
  );
  const label = column.resetIn
    ? `${column.label} ${column.pctLabel} used · resets in ${column.resetIn}`
    : `${column.label} ${column.pctLabel} used`;

  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile onOpenChange={handleOpenChange}>
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
            animate={preferences.animate}
            uniProps={ringPaletteMapping(column.pct, preferences)}
          />
          <MeterCenterGlyph glyph={glyph} size={COMPOSER_METER_GLYPH_SIZE} />
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
