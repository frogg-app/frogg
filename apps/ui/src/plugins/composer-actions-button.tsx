import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Puzzle } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
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
import { callPluginMethod } from "./client-runtime/route";
import { describePluginError } from "./errors";
import { isPluginsEnabledByBrand } from "./hosts";
import { useMergedPluginContributions, usePluginMutation } from "./queries";

const ThemedPuzzle = withUnistyles(Puzzle);

function triggerStyle(state: { hovered: boolean; pressed: boolean; open: boolean }) {
  return iconButtonChromeStyle({ size: "small", state });
}

interface ActionInput {
  pluginId: string;
  method: string;
  agentId: string | null;
  cwd: string | null;
}

const invoke = (client: DaemonClient, input: ActionInput) =>
  callPluginMethod(client, {
    pluginId: input.pluginId,
    method: input.method,
    params: { agentId: input.agentId, cwd: input.cwd },
  });

/**
 * Plugin `composerActions` in the composer toolbar, invoked with the composer's agent and
 * directory. Renders nothing when no plugin contributes one.
 */
export function PluginComposerActionsButton({
  serverId,
  agentId,
  cwd,
}: {
  serverId: string;
  agentId: string | null;
  cwd: string | null;
}): ReactElement | null {
  if (!isPluginsEnabledByBrand()) return null;
  return <ComposerActionsMenu serverId={serverId} agentId={agentId} cwd={cwd} />;
}

function ComposerActionsMenu({
  serverId,
  agentId,
  cwd,
}: {
  serverId: string;
  agentId: string | null;
  cwd: string | null;
}): ReactElement | null {
  const { t } = useTranslation();
  const toast = useToast();
  const contributions = useMergedPluginContributions(serverId);
  const runner = usePluginMutation(serverId, invoke);
  const sets = useMemo(
    () => contributions.contributions.filter((set) => (set.composerActions?.length ?? 0) > 0),
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

  if (sets.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        testID="plugin-composer-actions-trigger"
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={t("plugins.composerActions.trigger")}
      >
        <ThemedPuzzle
          size={iconButtonChromeGlyphSize("small")}
          uniProps={extraMutedIconColorMapping}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={240} testID="plugin-composer-actions-menu">
        {sets.map((set, index) => (
          <ComposerActionsSection
            key={set.pluginId}
            first={index === 0}
            pluginId={set.pluginId}
            pluginName={set.pluginName}
            actions={set.composerActions ?? []}
            badges={set.badges}
            onRun={run}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ComposerActionsSection({
  first,
  pluginId,
  pluginName,
  actions,
  badges,
  onRun,
}: {
  first: boolean;
  pluginId: string;
  pluginName: string;
  actions: readonly { id: string; title: string }[];
  badges: Record<string, string>;
  onRun: (pluginId: string, method: string) => void;
}): ReactElement {
  return (
    <>
      {first ? null : <DropdownMenuSeparator />}
      <DropdownMenuLabel>{pluginName}</DropdownMenuLabel>
      {actions.map((action) => (
        <ComposerActionItem
          key={action.id}
          pluginId={pluginId}
          actionId={action.id}
          label={action.title}
          badge={badges[action.id]}
          onRun={onRun}
        />
      ))}
    </>
  );
}

function ComposerActionItem({
  pluginId,
  actionId,
  label,
  badge,
  onRun,
}: {
  pluginId: string;
  actionId: string;
  label: string;
  badge: string | undefined;
  onRun: (pluginId: string, method: string) => void;
}): ReactElement {
  const onSelect = useCallback(() => onRun(pluginId, actionId), [actionId, onRun, pluginId]);
  return (
    <DropdownMenuItem
      testID={`plugin-composer-action-${actionId}`}
      onSelect={onSelect}
      description={badge}
    >
      {label}
    </DropdownMenuItem>
  );
}
