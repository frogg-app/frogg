import { Text as RNText, type TextProps } from "react-native";
import { color, font } from "../theme/tokens";

type Variant = "body" | "display" | "mono" | "label";

const base = {
  body: { fontFamily: font.body, fontSize: 13.5, color: color.text },
  display: {
    fontFamily: font.display,
    fontWeight: "600" as const,
    fontSize: 15,
    color: color.text,
  },
  mono: { fontFamily: font.mono, fontSize: 11.5, color: color.muted },
  label: {
    fontFamily: font.mono,
    fontSize: 10.5,
    letterSpacing: 1.6,
    color: color.faint,
    textTransform: "uppercase" as const,
  },
};

export function T({ v = "body", style, ...rest }: TextProps & { v?: Variant }) {
  return <RNText {...rest} style={[base[v], style]} />;
}
