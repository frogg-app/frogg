import type { LucideIcon } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { themedIcon } from "./soft-icon";
import type { Theme } from "@/styles/theme";
import { softEdge, softRaised, SOFT_PILL, SOFT_ROUND_BUTTON } from "./soft-surface";

type HoverState = PressableStateCallbackType & { hovered?: boolean };

const foregroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });

/** A floating round icon button with a soft shadow (ChatGPT/Perplexity iOS header buttons). */
export function SoftRoundButton({
  icon,
  label,
  onPress,
  flat = false,
  testID,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  /** Sit on a raised surface already: drop the shadow. */
  flat?: boolean;
  testID?: string;
}) {
  const Icon = themedIcon(icon);
  const style = useMemo(
    () =>
      ({ hovered, pressed }: HoverState) => [
        flat ? styles.flat : styles.button,
        (Boolean(hovered) || pressed) && styles.hovered,
      ],
    [flat],
  );
  return (
    <Pressable
      onPress={onPress}
      style={style}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      hitSlop={4}
    >
      <Icon size={18} strokeWidth={2} uniProps={foregroundMapping} />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme, rt) => ({
  button: {
    width: SOFT_ROUND_BUTTON,
    height: SOFT_ROUND_BUTTON,
    borderRadius: SOFT_PILL,
    alignItems: "center",
    justifyContent: "center",
    ...softRaised(rt.themeName, "md"),
    ...softEdge(rt.themeName),
  },
  flat: {
    width: 36,
    height: 36,
    borderRadius: SOFT_PILL,
    alignItems: "center",
    justifyContent: "center",
  },
  hovered: {
    backgroundColor: theme.colors.surface2,
  },
}));
