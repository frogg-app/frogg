import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Puzzle } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { DaemonClient, PluginContributionSet } from "@frogg/client/internal/daemon-client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  extraMutedIconColorMapping,
  iconButtonChromeGlyphSize,
  iconButtonChromeStyle,
} from "@/components/ui/icon-button-chrome";
import { useToast } from "@/contexts/toast-context";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { callPluginMethod } from "./client-runtime/route";
import { describePluginError } from "./errors";
import { isPluginsEnabledByBrand } from "./hosts";
import { useMergedPluginContributions, usePluginMutation } from "./queries";

const ThemedPuzzle = withUnistyles(Puzzle);

function triggerStyle(state: { hovered: boolean; pressed: boolean; open: boolean }) {
  return iconButtonChromeStyle({ size: "large", state });
}

interface ActionInput {
  pluginId: string;
  method: string;
  agentId: string | null;
  cwd: string;
}

const invoke = (client: DaemonClient, input: ActionInput) =>
  callPluginMethod(client, {
    pluginId: input.pluginId,
    method: input.method,
    params: { agentId: input.agentId, cwd: input.cwd },
  });

/**
 * Plugin contributions for the session header: `sessionActions` (invoked with the focused
 * agent and the workspace directory), `panels` and `views` (opened as workspace tabs). Renders nothing
 * when the host has no plugin feature or no plugin contributes either.
 */
export function PluginSessionActionsButton({
  serverId,
  cwd,
  agentId,
  workspaceKey,
}: {
  serverId: string;
  cwd: string;
  agentId: string | null;
  workspaceKey: string | null;
}): ReactElement | null {
  // Client-scope plugins contribute here even when the host has no plugin feature; the menu
  // renders nothing when neither side contributes.
  if (!isPluginsEnabledByBrand()) return null;
  return (
    <SessionActionsMenu
      serverId={serverId}
      cwd={cwd}
      agentId={agentId}
      workspaceKey={workspaceKey}
    />
  );
}

function SessionActionsMenu({
  serverId,
  cwd,
  agentId,
  workspaceKey,
}: {
  serverId: string;
  cwd: string;
  agentId: string | null;
  workspaceKey: string | null;
}): ReactElement | null {
  const { t } = useTranslation();
  const toast = useToast();
  const contributions = useMergedPluginContributions(serverId);
  const runner = usePluginMutation(serverId, invoke);
  const sets = useMemo(
    () =>
      contributions.contributions.filter(
        (set) =>
          set.sessionActions.length > 0 || set.panels.length > 0 || (set.views?.length ?? 0) > 0,
      ),
    [contributions.contributions],
  );
  const run = useCallback(
    (pluginId: string, method: string) => {
      runner.mutate(
        { pluginId, method, agentId, cwd },
        { onError: (error) => toast.error(describePluginError(error)) },
      );
    },
    [agentId, cwd, runner, toast],
  );
  const openPanel = useCallback(
    (pluginId: string, panelId: string) => {
      if (!workspaceKey) return;
      useWorkspaceLayoutStore.getState().openTab({
        workspaceKey,
        target: { kind: "plugin_panel", pluginId, panelId },
        intent: "reveal",
      });
    },
    [workspaceKey],
  );

  if (sets.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        testID="plugin-session-actions-trigger"
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={t("plugins.sessionActions.trigger")}
      >
        <ThemedPuzzle
          size={iconButtonChromeGlyphSize("large")}
          uniProps={extraMutedIconColorMapping}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={240} testID="plugin-session-actions-menu">
        {sets.map((set, index) => (
          <PluginMenuSection
            key={set.pluginId}
            first={index === 0}
            set={set}
            onRun={run}
            onOpenPanel={workspaceKey ? openPanel : null}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type ContributionSet = PluginContributionSet;

function PluginMenuSection({
  first,
  set,
  onRun,
  onOpenPanel,
}: {
  first: boolean;
  set: ContributionSet;
  onRun: (pluginId: string, method: string) => void;
  onOpenPanel: ((pluginId: string, panelId: string) => void) | null;
}): ReactElement {
  return (
    <>
      {first ? null : <DropdownMenuSeparator />}
      <DropdownMenuLabel>{set.pluginName}</DropdownMenuLabel>
      {set.sessionActions.map((action) => (
        <PluginMenuItem
          key={`action:${action.id}`}
          testID={`plugin-session-action-${action.id}`}
          label={action.title}
          badge={set.badges[action.id]}
          pluginId={set.pluginId}
          itemId={action.id}
          onPick={onRun}
        />
      ))}
      {onOpenPanel
        ? set.panels.map((panel) => (
            <PluginMenuItem
              key={`panel:${panel.id}`}
              testID={`plugin-open-panel-${panel.id}`}
              label={panel.title}
              badge={set.badges[panel.id]}
              pluginId={set.pluginId}
              itemId={panel.id}
              onPick={onOpenPanel}
            />
          ))
        : null}
      {onOpenPanel
        ? (set.views ?? []).map((view) => (
            <PluginMenuItem
              key={`view:${view.id}`}
              testID={`plugin-open-view-${view.id}`}
              label={view.title}
              badge={set.badges[view.id]}
              pluginId={set.pluginId}
              itemId={view.id}
              onPick={onOpenPanel}
            />
          ))
        : null}
    </>
  );
}

function PluginMenuItem({
  label,
  badge,
  pluginId,
  itemId,
  onPick,
  testID,
}: {
  label: string;
  badge: string | undefined;
  pluginId: string;
  itemId: string;
  onPick: (pluginId: string, itemId: string) => void;
  testID: string;
}): ReactElement {
  const onSelect = useCallback(() => onPick(pluginId, itemId), [itemId, onPick, pluginId]);
  return (
    <DropdownMenuItem testID={testID} onSelect={onSelect} description={badge}>
      {label}
    </DropdownMenuItem>
  );
}
