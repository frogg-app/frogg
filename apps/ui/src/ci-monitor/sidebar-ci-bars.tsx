import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { CiProgressBar } from "./ci-progress";
import { useMockCiRuns } from "./mock-runs";

/**
 * DESIGN PROTOTYPE. A hairline per CI run under the workspace row's meta line: amber filling
 * while it runs, green or red when it lands. Stacked rather than merged so a release and the
 * deploy it triggers stay distinguishable at a glance.
 */
export function SidebarCiBars({ workspaceId }: { workspaceId: string }) {
  const runs = useMockCiRuns(workspaceId);
  if (runs.length === 0) return null;
  return (
    <View style={styles.bars} testID={`sidebar-ci-bars-${workspaceId}`}>
      {runs.map((run) => (
        <CiProgressBar key={run.id} status={run.status} progress={run.progress} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  bars: {
    gap: 2,
    marginTop: theme.spacing[1],
    marginBottom: theme.spacing[0.5],
  },
}));
