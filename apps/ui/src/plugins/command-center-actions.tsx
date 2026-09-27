import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Puzzle } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type {
  CommandCenterContribution,
  CommandCenterIconProps,
} from "@/command-center/contributions";
import { useCommandCenterActions } from "@/command-center/provider";
import { useToast } from "@/contexts/toast-context";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { clearCommandCenterFocusRestoreElement } from "@/utils/command-center-focus-restore";
import { describePluginError } from "./errors";
import { isPluginsEnabledByBrand, useHostLabel, usePluginHostIds } from "./hosts";
import { openPluginsModal } from "./modal-store";
import { usePluginContributions } from "./queries";

const ThemedPuzzle = withUnistyles(Puzzle, (theme) => ({ color: theme.colors.foregroundMuted }));

function PluginIcon({ size }: CommandCenterIconProps) {
  return <ThemedPuzzle size={size} strokeWidth={2.2} />;
}

/** "Plugins" (opens the manager) plus every plugin `commands` contribution on every host. */
export function PluginCommandCenterActions() {
  const serverIds = usePluginHostIds();
  const enabled = isPluginsEnabledByBrand() && serverIds.length > 0;
  return (
    <>
      <OpenPluginsAction enabled={enabled} />
      {enabled
        ? serverIds.map((serverId) => (
            <HostPluginCommands
              key={serverId}
              serverId={serverId}
              showHost={serverIds.length > 1}
            />
          ))
        : null}
    </>
  );
}

function OpenPluginsAction({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const actions = useMemo<CommandCenterContribution[]>(
    () => [
      {
        id: "plugins-open",
        group: "actions",
        groupRank: 0,
        rank: 8,
        keywords: ["plugins", "extensions", "install", "marketplace"],
        visibility: "query",
        run: () => {
          clearCommandCenterFocusRestoreElement();
          openPluginsModal();
        },
        presentation: {
          kind: "action",
          title: t("plugins.title"),
          sectionTitle: t("shell.commandCenter.actions"),
          icon: PluginIcon,
        },
      },
    ],
    [t],
  );
  useCommandCenterActions({ sourceId: "plugins-open", enabled, actions });
  return null;
}

function HostPluginCommands({ serverId, showHost }: { serverId: string; showHost: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const hostLabel = useHostLabel(serverId);
  const contributions = usePluginContributions(serverId);
  const actions = useMemo<CommandCenterContribution[]>(() => {
    const sets = contributions.data?.contributions ?? [];
    return sets.flatMap((set) =>
      set.commands.map((command, index) => ({
        id: `plugin:${serverId}:${set.pluginId}:${command.id}`,
        group: "plugins",
        groupRank: 5,
        rank: index,
        keywords: [set.pluginName, set.pluginId, command.title],
        visibility: "query" as const,
        run: async () => {
          const client = getHostRuntimeStore().getClient(serverId);
          if (!client) return;
          try {
            await client.pluginsRpcCall({ pluginId: set.pluginId, method: command.id, params: {} });
          } catch (error) {
            toast.error(describePluginError(error));
          }
        },
        presentation: {
          kind: "action" as const,
          title: command.title,
          subtitle: showHost ? `${set.pluginName} · ${hostLabel}` : set.pluginName,
          sectionTitle: t("plugins.commandCenter.section"),
          icon: PluginIcon,
        },
      })),
    );
  }, [contributions.data, hostLabel, serverId, showHost, t, toast]);
  useCommandCenterActions({ sourceId: `plugins:${serverId}`, enabled: true, actions });
  return null;
}
