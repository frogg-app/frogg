import { useCallback, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { PluginSpinner } from "./spinner";
import { Switch } from "@/components/ui/switch";
import { describePluginError } from "./errors";
import { isPluginDeveloperModeAllowedByBrand, useHostLabel } from "./hosts";
import { usePluginMutation, usePluginsList } from "./queries";
import { pluginStyles as styles } from "./shared-styles";

const setDevMode = (client: DaemonClient, enabled: boolean) => client.pluginsDevSetEnabled(enabled);
const link = (client: DaemonClient, path: string) => client.pluginsDevLink(path.trim());

/**
 * Developer mode is a host setting (linking is a host operation): the toggle, then
 * "Add local folder", which links a plugin folder by its absolute path on that host.
 */
export function DeveloperView({ serverId }: { serverId: string }): ReactElement {
  const { t } = useTranslation();
  const hostLabel = useHostLabel(serverId);
  const list = usePluginsList(serverId);
  const toggle = usePluginMutation(serverId, setDevMode);
  const linker = usePluginMutation(serverId, link);
  const [path, setPath] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [linkedName, setLinkedName] = useState<string | null>(null);

  const submit = useCallback(() => {
    if (!path.trim()) return;
    setLinkedName(null);
    linker.mutate(path, {
      onSuccess: (result) => {
        setLinkedName(result.plugin?.name ?? null);
        setPath("");
        setResetKey((key) => key + 1);
      },
    });
  }, [linker, path]);

  if (list.isPending) return <PluginSpinner />;
  const policy = list.data?.policy;
  if (!policy || policy.developerMode === "forbidden" || !isPluginDeveloperModeAllowedByBrand()) {
    return <Text style={styles.empty}>{t("plugins.developer.forbidden")}</Text>;
  }
  const enabled = policy.developerModeEnabled;

  return (
    <View style={styles.list} testID="plugins-developer">
      <View style={styles.rowHeader}>
        <View style={styles.rowTitleBlock}>
          <Text style={styles.title}>{t("plugins.developer.toggle")}</Text>
          <Text style={styles.meta}>{t("plugins.developer.toggleHint", { host: hostLabel })}</Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={toggle.mutate}
          disabled={toggle.isPending}
          accessibilityLabel={t("plugins.developer.toggle")}
          testID="plugins-developer-toggle"
        />
      </View>
      {toggle.error ? <Text style={styles.error}>{describePluginError(toggle.error)}</Text> : null}
      {enabled ? (
        <>
          <Text style={styles.sectionTitle}>{t("plugins.developer.addFolder")}</Text>
          <Field
            label={t("plugins.developer.path")}
            hint={t("plugins.developer.pathHint", { host: hostLabel })}
          >
            <FormTextInput
              size="sm"
              initialValue=""
              resetKey={resetKey}
              onChangeText={setPath}
              onSubmitEditing={submit}
              placeholder="/home/me/my-plugin"
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel={t("plugins.developer.path")}
              testID="plugins-developer-path"
            />
          </Field>
          {linker.error ? (
            <Text style={styles.error} testID="plugins-developer-error">
              {describePluginError(linker.error)}
            </Text>
          ) : null}
          {linkedName ? (
            <Text style={styles.meta} testID="plugins-developer-linked">
              {t("plugins.developer.linked", { name: linkedName })}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Button
              size="sm"
              onPress={submit}
              loading={linker.isPending}
              disabled={!path.trim()}
              testID="plugins-developer-link"
            >
              {t("plugins.developer.link")}
            </Button>
          </View>
        </>
      ) : null}
    </View>
  );
}
