import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { MeterCenterGlyph } from "@/components/meter-center-glyph";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEasedColor } from "@/hooks/use-eased-color";
import { useEasedValue } from "@/hooks/use-eased-value";
import {
  USAGE_METER_TRANSITION_MS,
  deriveUsageTone,
  type UsageMeterPreferences,
} from "@/provider-usage/meter-preferences";
import { ProviderUsageTooltipSection } from "@/provider-usage/tooltip-section";
import { useUsageMeterPreferences } from "@/provider-usage/use-meter-preferences";
import { useProviderUsage } from "@/provider-usage/use-provider-usage";
import { formatTokenCount } from "./context-window-meter.utils";

interface ContextWindowMeterProps {
  maxTokens: number | null;
  usedTokens: number | null;
  totalCostUsd?: number | null;
  showPercentage?: boolean;
  serverId?: string;
  /** The Frogg provider key, e.g. "claude", "gemini", "codex" */
  provider?: string | null;
  /**
   * COMPAT(providerUsageAccountScoped): the sign-in this agent runs as, so the
   * quota section reports that account's limits rather than the daemon's
   * default config directory. Three-valued — absent is the provider's active
   * account, `null` the Default pick — so never read it for truthiness.
   */
  providerAccountId?: string | null;
  /** Reserve the meter footprint and show a loading ring while usage is pending. */
  pending?: boolean;
  /** Optional glyph envelope for icon-toolbar alignment. */
  glyphSize?: number;
  /**
   * Width of the meter's touch target. The composer's meter cluster narrows it so the context
   * ring sits on the same pitch as the quota rings beside it; on its own it keeps the 28px
   * toolbar-button envelope.
   */
  containerWidth?: number;
  /**
   * A single character drawn in the ring's middle, naming what the ring measures. Used inside the
   * composer's meter cluster, where three rings sit together and need telling apart; ignored when
   * the meter renders its percentage as a label instead.
   */
  centerGlyph?: string;
  /** Size of `centerGlyph`, so the cluster's rings all letter at one size. */
  centerGlyphSize?: number;
}

const SVG_SIZE = 14;
const COMPACT_SVG_SIZE = 12;
const COMPACT_CENTER = COMPACT_SVG_SIZE / 2;
const COMPACT_RADIUS = 5;
const STROKE_WIDTH = 2;
const COMPACT_STROKE_WIDTH = 1.75;
const COMPACT_CIRCUMFERENCE = 2 * Math.PI * COMPACT_RADIUS;

function isValidMaxTokens(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isValidUsedTokens(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function getUsagePercentage(maxTokens: number, usedTokens: number): number | null {
  if (!isValidMaxTokens(maxTokens) || !isValidUsedTokens(usedTokens)) {
    return null;
  }
  return (usedTokens / maxTokens) * 100;
}

function clampPercentage(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function formatSessionCost(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  }
  return `$${value.toFixed(2)}`;
}

function getMeterColors(
  percentage: number,
  thresholds: UsageMeterPreferences,
  theme: ReturnType<typeof useUnistyles>["theme"],
): { progress: string; track: string } {
  const track = theme.colors.surface3;
  const tone = deriveUsageTone(percentage, thresholds);
  if (tone === "danger") {
    return { progress: theme.colors.destructive, track };
  }
  if (tone === "warning") {
    return { progress: theme.colors.palette.amber[500], track };
  }
  return { progress: theme.colors.foregroundMuted, track };
}

function getMeterGeometry(showPercentage: boolean, glyphSize?: number, containerWidth?: number) {
  const widthStyle = containerWidth != null ? { width: containerWidth } : undefined;
  if (showPercentage) {
    return {
      svgSize: COMPACT_SVG_SIZE,
      center: COMPACT_CENTER,
      radius: COMPACT_RADIUS,
      strokeWidth: COMPACT_STROKE_WIDTH,
      circumference: COMPACT_CIRCUMFERENCE,
      containerStyle: [styles.containerWithLabel, widthStyle],
    };
  }
  const resolvedSize = glyphSize ?? SVG_SIZE;
  const resolvedStrokeWidth = glyphSize ? 2 : STROKE_WIDTH;
  return {
    svgSize: resolvedSize,
    center: resolvedSize / 2,
    radius: (resolvedSize - resolvedStrokeWidth) / 2,
    strokeWidth: resolvedStrokeWidth,
    circumference: Math.PI * (resolvedSize - resolvedStrokeWidth),
    containerStyle: [styles.container, widthStyle],
  };
}

/** The glyph size a context meter uses on its own, outside the composer's cluster. */
const STANDALONE_CONTEXT_GLYPH_SIZE = 8;

/**
 * The ring's centre character, or nothing when the meter labels itself with a percentage.
 * The glyph itself comes from the shared component the composer's quota rings use, so the
 * three rings in one cluster are lettered identically.
 */
function ContextMeterGlyph({
  glyph,
  size,
  hidden,
}: {
  glyph: string | undefined;
  size: number | undefined;
  hidden: boolean;
}) {
  if (hidden || !glyph) return null;
  return <MeterCenterGlyph glyph={glyph} size={size ?? STANDALONE_CONTEXT_GLYPH_SIZE} />;
}

/**
 * The ring itself, as its own component so the eased arc and colour can be hooks: the meter
 * above returns early for a session with no usage yet, which a hook in that body could not
 * survive.
 */
function MeterArc({
  svgSize,
  center,
  radius,
  strokeWidth,
  circumference,
  percentage,
  colors,
  animate,
}: {
  svgSize: number;
  center: number;
  radius: number;
  strokeWidth: number;
  circumference: number;
  percentage: number;
  colors: { progress: string; track: string };
  animate: boolean;
}) {
  const easedPercentage = useEasedValue(percentage, USAGE_METER_TRANSITION_MS, animate);
  const easedProgress = useEasedColor(colors.progress, USAGE_METER_TRANSITION_MS, animate);
  const dashOffset = circumference - (easedPercentage / 100) * circumference;

  return (
    <Svg
      width={svgSize}
      height={svgSize}
      viewBox={`0 0 ${svgSize} ${svgSize}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Strokes start at three o'clock; the ring has to read clockwise from twelve.
          Rotating a group inside the SVG keeps web and native in agreement, where a CSS
          transform on the element does not. */}
      <G transform={`rotate(-90 ${center} ${center})`}>
        <Circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={colors.track}
          strokeWidth={strokeWidth}
        />
        <Circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={easedProgress}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </G>
    </Svg>
  );
}

export function ContextWindowMeter({
  maxTokens,
  usedTokens,
  totalCostUsd,
  showPercentage = false,
  serverId,
  provider,
  providerAccountId,
  pending = false,
  glyphSize,
  containerWidth,
  centerGlyph,
  centerGlyphSize,
}: ContextWindowMeterProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const preferences = useUsageMeterPreferences();
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const { view: providerUsageView, refresh: refreshProviderUsage } = useProviderUsage(
    serverId ?? null,
    {
      enabled: isTooltipOpen,
      ...(provider ? { provider } : {}),
      ...(providerAccountId !== undefined ? { providerAccountId } : {}),
    },
  );
  const percentage =
    maxTokens !== null && usedTokens !== null ? getUsagePercentage(maxTokens, usedTokens) : null;
  const handleTooltipOpenChange = useCallback(
    (nextOpen: boolean) => {
      setIsTooltipOpen(nextOpen);
      if (nextOpen && preferences.refreshOnHover) {
        void refreshProviderUsage().catch(() => {});
      }
    },
    [preferences.refreshOnHover, refreshProviderUsage],
  );

  const geometry = getMeterGeometry(showPercentage, glyphSize, containerWidth);

  // No usage yet: reserve the footprint with a track-only ring while a session is
  // active so the real ring fades in without shifting siblings. Render nothing when
  // no usage is expected.
  if (percentage === null || maxTokens === null || usedTokens === null) {
    if (!pending) {
      return null;
    }
    return (
      <View style={geometry.containerStyle}>
        <Svg
          width={geometry.svgSize}
          height={geometry.svgSize}
          viewBox={`0 0 ${geometry.svgSize} ${geometry.svgSize}`}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Circle
            cx={geometry.center}
            cy={geometry.center}
            r={geometry.radius}
            fill="none"
            stroke={theme.colors.surface3}
            strokeWidth={geometry.strokeWidth}
          />
        </Svg>
        {showPercentage ? <View style={styles.skeletonLabel} /> : null}
        <ContextMeterGlyph glyph={centerGlyph} size={centerGlyphSize} hidden={showPercentage} />
      </View>
    );
  }

  const clampedPercentage = clampPercentage(percentage);
  const roundedPercentage = Math.round(percentage);
  const { svgSize, center, radius, strokeWidth, circumference, containerStyle } = geometry;
  const colors = getMeterColors(clampedPercentage, preferences, theme);
  const formattedSessionCost =
    typeof totalCostUsd === "number" ? formatSessionCost(totalCostUsd) : null;

  return (
    <Tooltip
      open={isTooltipOpen}
      onOpenChange={handleTooltipOpenChange}
      delayDuration={0}
      enabledOnDesktop
      enabledOnMobile
    >
      <TooltipTrigger asChild triggerRefProp="ref">
        <Pressable
          style={containerStyle}
          testID="context-window-meter"
          accessibilityRole="image"
          accessibilityLabel={t("contextWindow.accessibility", {
            percentage: roundedPercentage,
          })}
        >
          <MeterArc
            svgSize={svgSize}
            center={center}
            radius={radius}
            strokeWidth={strokeWidth}
            circumference={circumference}
            percentage={clampedPercentage}
            colors={colors}
            animate={preferences.animate}
          />
          {showPercentage ? (
            <Text style={styles.percentageLabel}>{`${roundedPercentage}%`}</Text>
          ) : null}
          <ContextMeterGlyph glyph={centerGlyph} size={centerGlyphSize} hidden={showPercentage} />
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <View style={styles.tooltipContent}>
          <Text style={styles.tooltipTitle}>{t("contextWindow.title")}</Text>
          <Text style={styles.tooltipText}>
            {t("contextWindow.used", { percentage: roundedPercentage })}
          </Text>
          <Text style={styles.tooltipDetail}>
            {t("contextWindow.tokens", {
              used: formatTokenCount(usedTokens),
              max: formatTokenCount(maxTokens),
            })}
          </Text>
          {formattedSessionCost ? (
            <Text style={styles.tooltipDetail}>
              {t("contextWindow.sessionCost", { cost: formattedSessionCost })}
            </Text>
          ) : null}
          <ProviderUsageTooltipSection view={providerUsageView} activeProviderId={provider} />
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  containerWithLabel: {
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
  },
  percentageLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  skeletonLabel: {
    width: 22,
    height: theme.fontSize.base,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
  },
  tooltipContent: {
    gap: theme.spacing[1.5],
    minWidth: 200,
  },
  tooltipTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
  tooltipDetail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
}));
