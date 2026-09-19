import { useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  IDENTITY_COLOR_NAMES,
  deriveIdentityColorName,
  identityColor,
  type IdentityColorName,
} from "@/styles/identity-colors";

/**
 * An account's identity colour: the stored preference when it names a colour
 * this client knows, otherwise one derived from the account id so every account
 * has a stable colour before anyone picks one.
 */
export function resolveProviderAccountColor(account: {
  id: string;
  preferences?: { color?: string };
}): IdentityColorName {
  const stored = account.preferences?.color;
  if (stored && (IDENTITY_COLOR_NAMES as readonly string[]).includes(stored)) {
    return stored as IdentityColorName;
  }
  return deriveIdentityColorName(account.id);
}

export interface ProviderAccountAvatarProps {
  label: string;
  color: IdentityColorName;
  size?: number;
  /** Adds a status pip in the corner: signed in, or not. Omitted when unknown. */
  authenticated?: boolean;
  testID?: string;
}

/** A round monogram in the account's identity colour. */
export function ProviderAccountAvatar({
  label,
  color,
  size = 28,
  authenticated,
  testID,
}: ProviderAccountAvatarProps): ReactElement {
  const circleStyle = useMemo(
    () => [
      styles.circle,
      { width: size, height: size, borderRadius: size / 2, backgroundColor: identityColor(color) },
    ],
    [color, size],
  );
  const letterStyle = useMemo(() => [styles.letter, { fontSize: Math.round(size * 0.44) }], [size]);
  const pipSize = Math.max(8, Math.round(size * 0.3));
  const pipStyle = useMemo(
    () => [
      styles.pip,
      { width: pipSize, height: pipSize, borderRadius: pipSize / 2 },
      authenticated ? styles.pipOn : styles.pipOff,
    ],
    [authenticated, pipSize],
  );

  return (
    <View style={circleStyle} testID={testID}>
      <Text style={letterStyle}>{label.trim().charAt(0).toUpperCase() || "?"}</Text>
      {authenticated === undefined ? null : <View style={pipStyle} />}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  circle: {
    alignItems: "center",
    justifyContent: "center",
  },
  letter: {
    color: theme.colors.palette.white,
    fontWeight: theme.fontWeight.medium,
  },
  pip: {
    position: "absolute",
    right: -1,
    bottom: -1,
    borderWidth: 2,
    borderColor: theme.colors.surface0,
  },
  pipOn: {
    backgroundColor: theme.colors.statusSuccess,
  },
  pipOff: {
    backgroundColor: theme.colors.foregroundMuted,
  },
}));
