import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { formatDiffCount } from "@/git/file-header-presentation";
import { panelMetaText, panelTheme } from "@/workspace/panel-chrome";
import { usePanelMetaDataSet } from "@/workspace/use-panel-meta-dataset";

interface DiffStatProps {
  additions: number;
  deletions: number;
  testID?: string;
}

export function DiffStat({ additions, deletions, testID }: DiffStatProps) {
  const metaDataSet = usePanelMetaDataSet();
  return (
    <View style={styles.row} testID={testID}>
      <Text style={styles.additions} dataSet={metaDataSet}>
        +{formatDiffCount(additions)}
      </Text>
      <Text style={styles.deletions} dataSet={metaDataSet}>
        -{formatDiffCount(deletions)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme, rt) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    height: 20,
    gap: 4,
    flexShrink: 0,
  },
  additions: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.statusSuccess,
    ...panelMetaText(panelTheme(theme, rt.themeName)),
  },
  deletions: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.statusDanger,
    ...panelMetaText(panelTheme(theme, rt.themeName)),
  },
}));
