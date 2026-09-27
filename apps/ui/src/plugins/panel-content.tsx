import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import {
  PluginPanelContentSchema,
  type PluginPanelContent,
} from "@frogg/protocol/plugins/manifest";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { Button } from "@/components/ui/button";
import { PluginSpinner } from "./spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { useFetchQuery } from "@/data/query";
import { i18n } from "@/i18n/i18next";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { openExternalUrl } from "@/utils/open-external-url";
import { describePluginError } from "./errors";
import { usePluginMutation } from "./queries";
import { pluginsQueryKeys } from "./query-keys";
import { PluginFieldsForm, type FieldValues } from "./setting-fields";
import { pluginStyles as styles } from "./shared-styles";

type ListItem = Extract<PluginPanelContent, { kind: "list" }>["items"][number];
type PanelAction = NonNullable<ListItem["action"]>;

const NO_IMAGE_HANDLERS: readonly string[] = [];

/** Calls `panel.<id>.render` and validates the tree before it reaches a renderer. */
export async function fetchPanelContent(
  client: DaemonClient,
  pluginId: string,
  panelId: string,
): Promise<PluginPanelContent> {
  const { result } = await client.pluginsRpcCall({
    pluginId,
    method: `panel.${panelId}.render`,
    params: {},
  });
  const parsed = PluginPanelContentSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(i18n.t("plugins.panel.invalidContent"));
  }
  return parsed.data;
}

export function usePanelContent(serverId: string, pluginId: string, panelId: string) {
  const client = useHostRuntimeClient(serverId);
  return useFetchQuery({
    queryKey: pluginsQueryKeys.panel(serverId, pluginId, panelId),
    queryFn: () => {
      if (!client) throw new Error(i18n.t("common.errors.daemonClientUnavailable"));
      return fetchPanelContent(client, pluginId, panelId);
    },
    enabled: Boolean(client),
    dataShape: "value",
    staleTimeMs: 15_000,
    retry: false,
  });
}

/** A declarative plugin panel: list, markdown or form. No plugin code runs in the client. */
export function PluginPanelBody({
  serverId,
  pluginId,
  panelId,
}: {
  serverId: string;
  pluginId: string;
  panelId: string;
}): ReactElement {
  const { t } = useTranslation();
  const content = usePanelContent(serverId, pluginId, panelId);
  const reload = useCallback(() => void content.refetch(), [content]);

  if (content.isPending) {
    return (
      <View style={styles.list}>
        <PluginSpinner />
      </View>
    );
  }
  if (content.isError) {
    return (
      <View style={styles.list} testID="plugin-panel-error">
        <Text style={styles.error}>{describePluginError(content.error)}</Text>
        <View style={styles.actions}>
          <Button variant="secondary" size="sm" onPress={reload}>
            {t("plugins.panel.retry")}
          </Button>
        </View>
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.list} testID="plugin-panel">
      <PanelContent
        serverId={serverId}
        pluginId={pluginId}
        panelId={panelId}
        content={content.data}
      />
    </ScrollView>
  );
}

export function PanelContent({
  serverId,
  pluginId,
  panelId,
  content,
}: {
  serverId: string;
  pluginId: string;
  panelId: string;
  content: PluginPanelContent;
}): ReactElement {
  if (content.kind === "markdown") {
    return (
      <MarkdownRenderer
        text={content.markdown}
        compact
        enableHtmlish={false}
        allowedImageHandlers={NO_IMAGE_HANDLERS}
      />
    );
  }
  if (content.kind === "form") {
    return (
      <PanelForm serverId={serverId} pluginId={pluginId} panelId={panelId} content={content} />
    );
  }
  return <PanelList serverId={serverId} pluginId={pluginId} content={content} />;
}

function PanelList({
  serverId,
  pluginId,
  content,
}: {
  serverId: string;
  pluginId: string;
  content: Extract<PluginPanelContent, { kind: "list" }>;
}): ReactElement {
  const { t } = useTranslation();
  if (content.items.length === 0) {
    return <Text style={styles.empty}>{content.emptyText ?? t("plugins.panel.empty")}</Text>;
  }
  return (
    <View style={styles.list}>
      {content.items.map((item) => (
        <PanelListItem key={item.id} serverId={serverId} pluginId={pluginId} item={item} />
      ))}
    </View>
  );
}

const runAction = (client: DaemonClient, input: { pluginId: string; action: PanelAction }) =>
  client.pluginsRpcCall({
    pluginId: input.pluginId,
    method: input.action.method,
    params: input.action.params ?? {},
  });

function PanelListItem({
  serverId,
  pluginId,
  item,
}: {
  serverId: string;
  pluginId: string;
  item: ListItem;
}): ReactElement {
  const action = usePluginMutation(serverId, runAction);
  const onPress = useCallback(() => {
    if (item.action) {
      action.mutate({ pluginId, action: item.action });
      return;
    }
    if (item.url) void openExternalUrl(item.url);
  }, [action, item.action, item.url, pluginId]);
  const interactive = Boolean(item.action || item.url);
  return (
    <Pressable
      onPress={interactive ? onPress : undefined}
      disabled={!interactive || action.isPending}
      accessibilityRole={interactive ? "button" : undefined}
      style={styles.row}
      testID={`plugin-panel-item-${item.id}`}
    >
      <View style={styles.rowHeader}>
        <View style={styles.rowTitleBlock}>
          <Text style={styles.title}>{item.title}</Text>
          {item.subtitle ? <Text style={styles.meta}>{item.subtitle}</Text> : null}
        </View>
        {item.badge ? <StatusBadge label={item.badge} /> : null}
        {action.isPending ? <PluginSpinner /> : null}
      </View>
      {action.error ? <Text style={styles.error}>{describePluginError(action.error)}</Text> : null}
    </Pressable>
  );
}

function PanelForm({
  serverId,
  pluginId,
  panelId,
  content,
}: {
  serverId: string;
  pluginId: string;
  panelId: string;
  content: Extract<PluginPanelContent, { kind: "form" }>;
}): ReactElement {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const submitForm = useCallback(
    (client: DaemonClient, values: FieldValues) =>
      client.pluginsRpcCall({ pluginId, method: `panel.${panelId}.submit`, params: { values } }),
    [panelId, pluginId],
  );
  const submitter = usePluginMutation(serverId, submitForm);
  const submit = useCallback(
    (_changed: FieldValues, all: FieldValues) =>
      submitter.mutate(all, {
        onSuccess: () =>
          void queryClient.invalidateQueries({
            queryKey: pluginsQueryKeys.panel(serverId, pluginId, panelId),
          }),
      }),
    [panelId, pluginId, queryClient, serverId, submitter],
  );
  return (
    <>
      <PluginFieldsForm
        fields={content.fields}
        values={content.values}
        submitLabel={content.submitLabel ?? t("plugins.panel.submit")}
        pending={submitter.isPending}
        error={submitter.error ? describePluginError(submitter.error) : null}
        onSubmit={submit}
        testID="plugin-panel-form"
      />
      {submitter.isSuccess ? <Text style={styles.meta}>{t("plugins.panel.submitted")}</Text> : null}
    </>
  );
}
