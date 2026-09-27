import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "react-native";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { PluginSpinner } from "./spinner";
import { describePluginError } from "./errors";
import { usePluginMutation, usePluginSettings } from "./queries";
import { PluginFieldsForm, type FieldValues } from "./setting-fields";
import { pluginStyles as styles } from "./shared-styles";

/** A plugin's settings page, from plugins.settings.get / .set. */
export function PluginSettingsView({
  serverId,
  pluginId,
}: {
  serverId: string;
  pluginId: string;
}): ReactElement {
  const { t } = useTranslation();
  const settings = usePluginSettings(serverId, pluginId);
  const save = useCallback(
    (client: DaemonClient, values: FieldValues) => client.pluginsSettingsSet(pluginId, values),
    [pluginId],
  );
  const saver = usePluginMutation(serverId, save);
  const submit = useCallback(
    (changed: FieldValues) => {
      if (Object.keys(changed).length > 0) saver.mutate(changed);
    },
    [saver],
  );

  if (settings.isPending) return <PluginSpinner />;
  if (settings.isError) {
    return <Text style={styles.error}>{describePluginError(settings.error)}</Text>;
  }
  if (settings.data.fields.length === 0) {
    return <Text style={styles.empty}>{t("plugins.settings.none")}</Text>;
  }
  return (
    <>
      <PluginFieldsForm
        fields={settings.data.fields}
        values={settings.data.values}
        submitLabel={t("plugins.settings.save")}
        pending={saver.isPending}
        error={saver.error ? describePluginError(saver.error) : null}
        onSubmit={submit}
        testID="plugin-settings-form"
      />
      {saver.isSuccess ? <Text style={styles.meta}>{t("plugins.settings.saved")}</Text> : null}
    </>
  );
}
