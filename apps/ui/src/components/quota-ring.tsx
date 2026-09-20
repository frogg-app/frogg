import { Pressable, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useCallback } from "react";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { COMPOSER_METER_SLOT_WIDTH } from "@/composer/usage-cluster";
import type { ProviderUsageColumn } from "@/provider-usage/account-summary";
import type { Theme } from "@/styles/theme";

const ThemedCircle = withUnistyles(Circle);

interface QuotaRingProps {
  column: ProviderUsageColumn;
  /** Outer diameter of the ring glyph, matching the context meter's envelope. */
  size: number;
  testID?: string;
}

/** The context meter's own ramp, so a spent quota reads the same as a full context window. */
function progressColor(pct: number, theme: Theme): string {
  if (pct > 90) return theme.colors.destructive;
  if (pct >= 70) return theme.colors.palette.amber[500];
  return theme.colors.foregroundMuted;
}

/**
 * One rolling quota window as a ring, drawn to the same geometry and colour ramp as the
 * context meter so the composer's three meters read as one family. A window with no
 * reported percentage still renders its track, because the tooltip's reset countdown is
 * worth hovering for and a missing ring would shift its siblings.
 */
export function QuotaRing({ column, size, testID }: QuotaRingProps) {
  const strokeWidth = 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = Math.PI * (size - strokeWidth);
  const center = size / 2;
  const pct = column.pct;
  const trackColor = useCallback((theme: Theme) => ({ stroke: theme.colors.surface3 }), []);
  const progressStroke = useCallback(
    (theme: Theme) => ({ stroke: progressColor(pct ?? 0, theme) }),
    [pct],
  );
  const dashOffset = circumference - ((pct ?? 0) / 100) * circumference;
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
          <Svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            style={styles.svg}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <ThemedCircle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              strokeWidth={strokeWidth}
              uniProps={trackColor}
            />
            {pct != null ? (
              <ThemedCircle
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                strokeWidth={strokeWidth}
                uniProps={progressStroke}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
              />
            ) : null}
          </Svg>
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
    transform: [{ rotate: "-90deg" }],
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
