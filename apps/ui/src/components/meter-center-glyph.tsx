import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { measureGlyphRise } from "@/components/glyph-metrics";
import { COMPOSER_METER_GLYPH_SIZE } from "@/composer/meter-geometry";
import type { Theme } from "@/styles/theme";

interface MeterCenterGlyphProps {
  /** The single character naming the window this ring measures. */
  glyph: string;
  /** Font size, so the context ring and the quota rings can letter at different sizes. */
  size?: number;
}

/**
 * The glyph itself, with the font it will be drawn in handed to it: the correction below is a
 * property of that font, so the component has to know which one it is rather than inheriting it.
 */
function MeterGlyphText({
  glyph,
  size,
  fontFamily,
}: {
  glyph: string;
  size: number;
  fontFamily: string;
}) {
  const rise = useMemo(() => measureGlyphRise(glyph, size, fontFamily), [glyph, size, fontFamily]);
  return (
    <Text
      style={[
        styles.glyph,
        { fontFamily, fontSize: size, lineHeight: size, transform: [{ translateY: -rise }] },
      ]}
    >
      {glyph}
    </Text>
  );
}

const ThemedMeterGlyphText = withUnistyles(MeterGlyphText);

/** Hoisted so the mapping is not a fresh function on every render. */
const glyphFontMapping = (theme: Theme) => ({ fontFamily: theme.fontFamily.ui });

/**
 * The character in the middle of a meter ring, drawn over the ring rather than as SVG text,
 * which does not centre consistently between web and native.
 *
 * Both meters render it through this one component so their glyphs cannot drift apart: the
 * cluster puts two quota rings and the context ring side by side, where a half-pixel difference
 * between them reads as a wobble along the row.
 *
 * The layer fills the ring's slot and centres the text box on both axes, which is exactly right
 * horizontally and a shade out vertically — `measureGlyphRise` explains why, and corrects it for
 * whichever font the box is actually drawn in.
 */
export function MeterCenterGlyph({
  glyph,
  size = COMPOSER_METER_GLYPH_SIZE,
}: MeterCenterGlyphProps) {
  return (
    <View pointerEvents="none" style={styles.layer}>
      <ThemedMeterGlyphText glyph={glyph} size={size} uniProps={glyphFontMapping} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  layer: {
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
    fontWeight: theme.fontWeight.normal,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
}));
