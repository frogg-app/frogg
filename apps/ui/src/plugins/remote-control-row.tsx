import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import type { DaemonClient, PluginInstalled } from "@frogg/client/internal/daemon-client";
import { PLUGIN_REMOTE_CONTROL_CAPABILITIES } from "@frogg/protocol/plugins/manifest";
import { Switch } from "@/components/ui/switch";
import { describePluginError } from "./errors";
import { usePluginMutation } from "./queries";
import { pluginStyles as styles } from "./shared-styles";

const setRemoteControl = (client: DaemonClient, input: { id: string; enabled: boolean }) =>
  client.pluginsSetRemoteControl(input.id, input.enabled);

/** True when the plugin was granted a capability that only works with remote control on. */
export function wantsRemoteControl(plugin: PluginInstalled): boolean {
  return (
    plugin.remoteControl !== undefined &&
    plugin.grantedCapabilities.some((c) =>
      (PLUGIN_REMOTE_CONTROL_CAPABILITIES as readonly string[]).includes(c),
    )
  );
}

/**
 * Owner switch for plugin API v2 remote control. Capabilities like agent.manage are granted at
 * install but stay inert until this is on; the brand can forbid it outright.
 */
export function RemoteControlRow({
  serverId,
  plugin,
  forbidden,
}: {
  serverId: string;
  plugin: PluginInstalled;
  forbidden: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const mutation = usePluginMutation(serverId, setRemoteControl);
  const handleChange = useCallback(
    (enabled: boolean) => mutation.mutate({ id: plugin.id, enabled }),
    [mutation, plugin.id],
  );
  return (
    <View testID={`plugins-remote-control-${plugin.id}`}>
      <View style={styles.rowHeader}>
        <View style={styles.rowTitleBlock}>
          <Text style={styles.title}>{t("plugins.installed.remoteControl")}</Text>
        </View>
        <Switch
          value={plugin.remoteControl === true}
          onValueChange={handleChange}
          disabled={forbidden || mutation.isPending}
          accessibilityLabel={t("plugins.installed.remoteControlLabel", {
            name: plugin.name,
          })}
          testID={`plugins-remote-control-switch-${plugin.id}`}
        />
      </View>
      <Text style={styles.meta}>
        {forbidden
          ? t("plugins.installed.remoteControlForbidden")
          : t("plugins.installed.remoteControlHint")}
      </Text>
      {mutation.error ? (
        <Text style={styles.error}>{describePluginError(mutation.error)}</Text>
      ) : null}
    </View>
  );
}
