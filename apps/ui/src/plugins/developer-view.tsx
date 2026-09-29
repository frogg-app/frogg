import { useCallback, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { PluginSpinner } from "./spinner";
import { describePluginError } from "./errors";
import { isPluginDeveloperModeAllowedByBrand, useHostLabel } from "./hosts";
import { usePluginMutation, usePluginsList } from "./queries";
import { pluginStyles as styles } from "./shared-styles";

const link = (client: DaemonClient, path: string) => client.pluginsDevLink(path.trim());

/**
 * "Add local folder" links a plugin folder by its absolute path on the host. Linking is a
 * host operation, available out of the box on beta daemons and never on stable ones.
 */
export function DeveloperView({ serverId }: { serverId: string }): ReactElement {
  const { t } = useTranslation();
  const hostLabel = useHostLabel(serverId);
  const list = usePluginsList(serverId);
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
  if (!policy || !policy.developerModeEnabled || !isPluginDeveloperModeAllowedByBrand()) {
    return <Text style={styles.empty}>{t("plugins.developer.forbidden")}</Text>;
  }

  return (
    <View style={styles.list} testID="plugins-developer">
      <Text style={styles.meta}>{t("plugins.developer.hint", { host: hostLabel })}</Text>
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
    </View>
  );
}
