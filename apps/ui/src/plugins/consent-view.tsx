import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describeCapability, PluginTierBadge } from "./badges";
import { describePluginError } from "./errors";
import { usePluginsModalStore, type PluginsView } from "./modal-store";
import { usePluginMutation } from "./queries";
import { pluginStyles as styles } from "./shared-styles";

type ConsentViewState = Extract<PluginsView, { kind: "consent" }>;

interface ConsentRequest {
  id: string;
  repoUrl: string;
  version: string | undefined;
  capabilities: string[];
  mode: "install" | "update";
}

const submit = (client: DaemonClient, request: ConsentRequest) =>
  request.mode === "install"
    ? client.pluginsInstall({
        id: request.id,
        version: request.version,
        repoUrl: request.repoUrl,
        grantedCapabilities: request.capabilities,
      })
    : client.pluginsUpdate({ id: request.id, grantedCapabilities: request.capabilities });

function toRequest(view: ConsentViewState): ConsentRequest {
  if (view.mode === "install") {
    return {
      id: view.entry.id,
      repoUrl: view.entry.repoUrl,
      version: view.entry.latest?.version,
      capabilities: view.entry.latest?.capabilities ?? [],
      mode: "install",
    };
  }
  return {
    id: view.plugin.id,
    repoUrl: view.plugin.repoUrl ?? "",
    version: undefined,
    capabilities: [...new Set([...view.plugin.grantedCapabilities, ...view.addedCapabilities])],
    mode: "update",
  };
}

/**
 * Consent before install (every capability the version asks for) or before an update that adds
 * capabilities (just the new ones). Consent is all-or-nothing: the host rejects partial grants.
 */
export function ConsentView({
  serverId,
  view,
}: {
  serverId: string;
  view: ConsentViewState;
}): ReactElement {
  const { t } = useTranslation();
  const setView = usePluginsModalStore((state) => state.setView);
  const setTab = usePluginsModalStore((state) => state.setTab);
  const mutation = usePluginMutation(serverId, submit);
  const request = toRequest(view);
  const shown = view.mode === "install" ? request.capabilities : view.addedCapabilities;
  const tier = view.mode === "install" ? view.entry.tier : view.plugin.source;
  const repoName = view.mode === "install" ? view.entry.repoName : view.plugin.repoUrl;

  const cancel = useCallback(() => setView({ kind: "tabs" }), [setView]);
  const confirm = useCallback(() => {
    mutation.mutate(request, {
      onSuccess: () => {
        setTab("installed");
        setView({ kind: "tabs" });
      },
    });
  }, [mutation, request, setTab, setView]);

  return (
    <View style={styles.list} testID="plugins-consent">
      <View style={styles.badges}>
        <PluginTierBadge tier={tier} />
        {repoName ? <Text style={styles.meta}>{repoName}</Text> : null}
      </View>
      {tier === "user" ? (
        <Alert variant="warning" description={t("plugins.consent.userRepoWarning")} />
      ) : null}
      <Text style={styles.body}>
        {view.mode === "install"
          ? t("plugins.consent.installIntro")
          : t("plugins.consent.updateIntro")}
      </Text>
      <View style={styles.list} testID="plugins-consent-capabilities">
        {shown.length === 0 ? (
          <Text style={styles.meta}>{t("plugins.consent.noCapabilities")}</Text>
        ) : null}
        {shown.map((cap) => (
          <View key={cap} style={styles.rowTitleBlock}>
            <Text style={styles.title}>{cap}</Text>
            <Text style={styles.meta}>{describeCapability(cap)}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.meta}>{t("plugins.consent.notSandboxed")}</Text>
      {mutation.error ? (
        <Text style={styles.error} testID="plugins-consent-error">
          {describePluginError(mutation.error)}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button variant="secondary" size="sm" onPress={cancel} disabled={mutation.isPending}>
          {t("common.actions.cancel")}
        </Button>
        <Button
          size="sm"
          onPress={confirm}
          loading={mutation.isPending}
          testID="plugins-consent-confirm"
        >
          {view.mode === "install" ? t("plugins.consent.install") : t("plugins.consent.update")}
        </Button>
      </View>
    </View>
  );
}
