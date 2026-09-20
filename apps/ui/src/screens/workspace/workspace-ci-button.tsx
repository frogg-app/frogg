import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Workflow } from "lucide-react-native";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import {
  extraMutedIconColorMapping,
  iconButtonChromeGlyphSize,
} from "@/components/ui/icon-button-chrome";
import { ChecksProgressRing } from "@/git/checks-progress-ring";
import { summarizeChecksProgress } from "@/git/checks-progress";
import type { ExplorerCheckoutContext } from "@/stores/explorer-checkout-context";
import type { PullRequestOpenLocation } from "@/hooks/use-settings";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { openWorkspacePullRequest } from "@/workspace-tabs/open-supporting-view";

const ThemedWorkflow = withUnistyles(Workflow);

const NO_SHORTCUT_KEYS: never[] = [];

/**
 * Ring diameter, sized off the glyph rather than the button frame so the ring hugs the
 * icon instead of tracing the hover chrome around it.
 */
const RING_SIZE = iconButtonChromeGlyphSize("large") + 8;

/**
 * Header button for the workspace's CI run: opens the change-request panel, whose
 * checks section is the CI detail, and wears a ring that fills as the run completes.
 *
 * The button only exists when there are checks to show. A workspace with no change
 * request has no CI to open, and an always-present dead button in the window header
 * would be worse than no button.
 *
 * It resolves its own checks and owns its own open action rather than taking them as
 * props, so the workspace screen carries neither.
 */
export function WorkspaceCiButton({
  workspaceDescriptor,
  workspaceKey,
  isCompact,
  checkout,
  destination,
}: {
  workspaceDescriptor: WorkspaceDescriptor | null | undefined;
  workspaceKey: string | null;
  isCompact: boolean;
  checkout: ExplorerCheckoutContext | null;
  destination: PullRequestOpenLocation;
}) {
  const { t } = useTranslation();
  const progress = summarizeChecksProgress(workspaceDescriptor?.githubRuntime?.pullRequest?.checks);
  const onPress = useCallback(() => {
    if (!workspaceKey) {
      return;
    }
    openWorkspacePullRequest({ isCompact, workspaceKey, checkout, destination });
  }, [checkout, destination, isCompact, workspaceKey]);

  if (progress.total === 0) {
    return null;
  }

  const label = progress.running
    ? t("workspace.git.ci.running", {
        completed: progress.completed,
        total: progress.total,
      })
    : t("workspace.git.ci.open");

  return (
    <HeaderToggleButton
      testID="workspace-ci-button"
      onPress={onPress}
      tooltipLabel={label}
      tooltipKeys={NO_SHORTCUT_KEYS}
      tooltipSide="bottom"
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.glyphBox}>
        <ThemedWorkflow
          size={iconButtonChromeGlyphSize("large")}
          strokeWidth={1.5}
          uniProps={extraMutedIconColorMapping}
        />
        {progress.running ? (
          <View style={styles.ringOverlay} pointerEvents="none">
            <ChecksProgressRing progress={progress} size={RING_SIZE} />
          </View>
        ) : null}
      </View>
    </HeaderToggleButton>
  );
}

const styles = StyleSheet.create(() => ({
  glyphBox: {
    alignItems: "center",
    justifyContent: "center",
  },
  // The ring is drawn around the glyph without taking layout, so adding it does not
  // nudge the neighbouring header buttons when a run starts.
  ringOverlay: {
    position: "absolute",
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
}));
