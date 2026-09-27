import { useMemo, type ReactNode } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { resolveShellDesign, type ShellDesign } from "@/components/sidebar/shell-design";
import { DESIGN_FONT_DATASET } from "@/styles/code-surface";

interface ScreenTitleProps {
  children: ReactNode;
  numberOfLines?: number;
  testID?: string;
  style?: StyleProp<TextStyle>;
}

/**
 * Canonical screen title for use inside `ScreenHeader`. One typography, one
 * color, responsive weight. Leading icons are siblings (HeaderToggleButton,
 * HeaderIconBadge) — never nested inside this component.
 *
 * The design direction may set the title's face (Paper's serif), size and weight. The Text is
 * tagged `DESIGN_FONT_DATASET` so that face survives the global UI-font rule on web; directions
 * without a display face name the UI font explicitly.
 */
export function ScreenTitle({ children, numberOfLines = 1, testID, style }: ScreenTitleProps) {
  const combinedStyle = useMemo(() => [styles.text, styles.textDesign, style], [style]);
  return (
    <Text
      style={combinedStyle}
      numberOfLines={numberOfLines}
      testID={testID}
      dataSet={DESIGN_FONT_DATASET}
    >
      {children}
    </Text>
  );
}

/** `current` leaves the weight to the responsive default above. */
function screenTitleDesign(title: ShellDesign["headerTitle"]) {
  const { fontWeight, ...rest } = title;
  return fontWeight === undefined ? rest : { ...rest, fontWeight };
}

const styles = StyleSheet.create((theme, rt) => ({
  text: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: theme.fontSize.base,
    fontWeight: {
      xs: "400",
      md: "300",
    },
    color: theme.colors.foreground,
  },
  // A sibling of `text` because `text` has breakpoints.
  textDesign: { ...screenTitleDesign(resolveShellDesign(theme, rt.themeName).headerTitle) },
}));
