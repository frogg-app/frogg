import type { ReactElement } from "react";
import { withUnistyles } from "react-native-unistyles";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { Theme } from "@/styles/theme";

const ThemedSpinner = withUnistyles(LoadingSpinner);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export function PluginSpinner(): ReactElement {
  return <ThemedSpinner size="small" uniProps={mutedMapping} />;
}
