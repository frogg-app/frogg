import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { PluginInstalled } from "@frogg/client/internal/daemon-client";
import { Button } from "@/components/ui/button";
import { findRepo } from "./client-runtime/client-catalog";
import { installClientPlugin, useClientPluginsStore } from "./client-runtime/runtime-store";
import { isClientPluginRuntimeSupported } from "./client-runtime/storage";
import { loadTrustedRepos } from "./client-target";
import { describePluginError } from "./errors";
import { usePluginHostIds } from "./hosts";
import { pluginStyles as styles } from "./shared-styles";

/**
 * The client half of a hybrid plugin installed on a host: installed on this device, installable
 * (fetched from the same repo and verified on device at the host's version), or not possible here.
 */
export function HybridClientComponent({ plugin }: { plugin: PluginInstalled }): ReactElement {
  const { t } = useTranslation();
  const hostIds = usePluginHostIds();
  const record = useClientPluginsStore((s) => s.records.find((r) => r.id === plugin.id));
  const status = useClientPluginsStore((s) => s.status[plugin.id]);
  const install = useMutation({
    mutationFn: async () => {
      if (!plugin.repoUrl) throw new Error(t("plugins.client.hybridDev"));
      const repo = findRepo(await loadTrustedRepos(hostIds), plugin.repoUrl);
      return installClientPlugin({
        repo,
        id: plugin.id,
        version: plugin.version,
        grantedCapabilities: plugin.grantedCapabilities,
      });
    },
  });
  const testID = `plugins-needs-client-${plugin.id}`;
  const runInstall = useCallback(() => install.mutate(), [install]);

  if (!isClientPluginRuntimeSupported()) {
    return (
      <Text style={styles.meta} testID={testID}>
        {t("plugins.client.hybridUnsupported")}
      </Text>
    );
  }
  if (record && record.version === plugin.version) {
    if (status?.state === "error") {
      return (
        <Text style={styles.error} testID={testID}>
          {t("plugins.client.hybridFailed", { error: status.error ?? "" })}
        </Text>
      );
    }
    return (
      <Text style={styles.meta} testID={`plugins-client-component-${plugin.id}`}>
        {t("plugins.client.hybridInstalled")}
      </Text>
    );
  }
  if (!plugin.repoUrl && !record) {
    return (
      <Text style={styles.meta} testID={testID}>
        {t("plugins.client.hybridDev")}
      </Text>
    );
  }
  return (
    <View style={styles.list} testID={testID}>
      <Text style={styles.meta}>{t("plugins.client.needsClient")}</Text>
      {install.error ? (
        <Text style={styles.error}>{describePluginError(install.error)}</Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          size="sm"
          variant="secondary"
          onPress={runInstall}
          loading={install.isPending}
          testID={`plugins-install-client-${plugin.id}`}
        >
          {t("plugins.client.hybridInstall")}
        </Button>
      </View>
    </View>
  );
}
