import { Platform, View, type ViewProps, type ViewStyle } from "react-native";

/**
 * The bracket shape: two opposite corners chamfered. `size` is the chamfer in px,
 * `flip` cuts top-right/bottom-left instead of top-left/bottom-right.
 * Web uses clip-path; native falls back to a plain box for now.
 */
export function Cut({
  size = 8,
  flip = false,
  style,
  ...rest
}: ViewProps & { size?: number; flip?: boolean }) {
  const clip: ViewStyle | undefined =
    Platform.OS === "web"
      ? ({
          clipPath: flip
            ? `polygon(0 0, calc(100% - ${size}px) 0, 100% ${size}px, 100% 100%, ${size}px 100%, 0 calc(100% - ${size}px))`
            : `polygon(${size}px 0, 100% 0, 100% calc(100% - ${size}px), calc(100% - ${size}px) 100%, 0 100%, 0 ${size}px)`,
        } as ViewStyle)
      : undefined;
  return <View {...rest} style={[style, clip]} />;
}
