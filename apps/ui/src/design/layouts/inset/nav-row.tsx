import type { ReactNode } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";

type HoverState = PressableStateCallbackType & { hovered?: boolean };

/** Linear's sidebar row: 28px, 13px label, a quiet grey fill for hover and a firmer one for the current item. */
export const INSET_ROW_HEIGHT = 28;

function rowStyle({ hovered, pressed }: HoverState) {
  return [styles.row, (Boolean(hovered) || pressed) && styles.rowHovered];
}
function activeRowStyle() {
  return [styles.row, styles.rowActive];
}
function indentedRowStyle(state: HoverState) {
  return [rowStyle(state), styles.indented];
}
function indentedActiveRowStyle() {
  return [styles.row, styles.rowActive, styles.indented];
}

function pickStyle(active: boolean, indented: boolean) {
  if (indented) return active ? indentedActiveRowStyle : indentedRowStyle;
  return active ? activeRowStyle : rowStyle;
}

export function InsetNavRow({
  leading,
  label,
  trailing,
  active = false,
  indented = false,
  muted = false,
  onPress,
  testID,
  accessibilityLabel,
}: {
  leading?: ReactNode;
  label: string;
  trailing?: ReactNode;
  active?: boolean;
  indented?: boolean;
  muted?: boolean;
  onPress: () => void;
  testID?: string;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={pickStyle(active, indented)}
      accessibilityRole="button"
      accessibilityState={active ? SELECTED : undefined}
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
    >
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <Text
        style={active ? styles.labelActive : muted ? styles.labelMuted : styles.label}
        numberOfLines={1}
      >
        {label}
      </Text>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </Pressable>
  );
}

const SELECTED = { selected: true } as const;

/** A count or timestamp at a row's right edge. */
export function InsetNavMeta({ children }: { children: ReactNode }) {
  return (
    <Text style={styles.meta} numberOfLines={1}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    height: INSET_ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface3,
  },
  rowActive: {
    backgroundColor: theme.colors.surface3,
  },
  indented: {
    paddingLeft: 26,
  },
  leading: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: "500",
    color: theme.colors.foreground,
    opacity: 0.86,
  },
  labelActive: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: "500",
    color: theme.colors.foreground,
  },
  labelMuted: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: "500",
    color: theme.colors.foregroundMuted,
  },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  meta: {
    fontSize: 12,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
}));
