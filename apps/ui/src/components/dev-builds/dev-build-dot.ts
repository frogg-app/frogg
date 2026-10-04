import { StyleSheet } from "react-native-unistyles";

export const devBuildDotTones = StyleSheet.create((theme) => ({
  running: { backgroundColor: theme.colors.statusDotSuccess },
  stale: { backgroundColor: theme.colors.statusDotWarning },
  busy: { backgroundColor: theme.colors.statusDotRunning },
  starting: { backgroundColor: theme.colors.foregroundMuted },
}));
