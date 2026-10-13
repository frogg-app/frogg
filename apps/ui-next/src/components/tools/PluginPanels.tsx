import {
  PluginPanelContentSchema,
  type PluginPanelContent,
} from "@frogg/protocol/plugins/manifest";
import { useCallback, useEffect, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { getClient } from "../../daemon/store";
import { color } from "../../theme/tokens";
import { Button } from "../Button";
import { Markdown } from "../Markdown";
import { T } from "../Text";
import { PluginForm } from "./PluginForm";

type Contribution = Awaited<
  ReturnType<NonNullable<ReturnType<typeof getClient>>["pluginsGetContributions"]>
>["contributions"][number];
export function PluginPanels({ pluginId }: { pluginId: string }) {
  const [contribution, setContribution] = useState<Contribution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    void getClient()
      ?.pluginsGetContributions()
      .then(
        (r) => {
          if (active) {
            setContribution(r.contributions.find((c) => c.pluginId === pluginId) ?? null);
            setLoaded(true);
          }
          return undefined;
        },
        (e: unknown) => {
          if (active) setError(String(e));
        },
      );
    return () => {
      active = false;
    };
  }, [pluginId]);
  return (
    <View style={s.stack}>
      {error && <T style={s.error}>{error}</T>}
      {!loaded && !error && <T>Loading panels…</T>}
      {loaded && !contribution?.panels.length && (
        <T>This plugin contributes no declarative panels.</T>
      )}
      {contribution?.panels.map((panel) => (
        <Panel key={panel.id} pluginId={pluginId} id={panel.id} title={panel.title} />
      ))}
    </View>
  );
}
function Panel({ pluginId, id, title }: { pluginId: string; id: string; title: string }) {
  const [content, setContent] = useState<PluginPanelContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const load = useCallback(() => {
    setError(null);
    void getClient()
      ?.pluginsRpcCall({ pluginId, method: `panel.${id}.render` })
      .then((r) => {
        const result = PluginPanelContentSchema.safeParse(r.result);
        if (!result.success) throw new Error("Plugin returned an unsupported panel response.");
        setContent(result.data);
        setRevision((v) => v + 1);
        return undefined;
      })
      .catch((e: unknown) => setError(String(e)));
  }, [pluginId, id]);
  useEffect(load, [load]);
  const submit = useCallback(
    async (values: Record<string, unknown>) => {
      const c = getClient();
      if (!c) throw new Error("Host is not connected.");
      await c.pluginsRpcCall({ pluginId, method: `panel.${id}.submit`, params: { values } });
    },
    [pluginId, id],
  );
  return (
    <View style={s.card}>
      <T>{title}</T>
      <Button label="Refresh panel" onPress={load} />
      {error && <T style={s.error}>{error}</T>}
      {!content && !error && <T>Loading…</T>}
      {content?.kind === "markdown" && <Markdown text={content.markdown} />}
      {content?.kind === "form" && (
        <PluginForm
          key={revision}
          fields={content.fields}
          initial={content.values}
          label={content.submitLabel ?? "Save"}
          submit={submit}
        />
      )}
      {content?.kind === "list" && content.items.length === 0 && (
        <T>{content.emptyText ?? "No items."}</T>
      )}
      {content?.kind === "list" &&
        content.items.map((item) => (
          <PanelItem key={item.id} pluginId={pluginId} item={item} reload={load} />
        ))}
    </View>
  );
}
function PanelItem({
  pluginId,
  item,
  reload,
}: {
  pluginId: string;
  item: Extract<PluginPanelContent, { kind: "list" }>["items"][number];
  reload: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (item.action) {
        const c = getClient();
        if (!c) throw new Error("Host is not connected.");
        await c.pluginsRpcCall({ pluginId, ...item.action });
        reload();
      } else if (item.url && /^https?:\/\//i.test(item.url)) await Linking.openURL(item.url);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, item, pluginId, reload]);
  return (
    <View style={s.stack}>
      <T>{item.title}</T>
      {item.subtitle && <T v="mono">{item.subtitle}</T>}
      {item.badge && <T v="label">{item.badge}</T>}
      {(item.action || (item.url && /^https?:\/\//i.test(item.url))) && (
        <Button label={busy ? "Opening…" : "Open"} onPress={run} disabled={busy} />
      )}
      {error && <T style={s.error}>{error}</T>}
    </View>
  );
}
const s = StyleSheet.create({
  stack: { gap: 10 },
  card: { gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: color.line },
  error: { color: color.coral },
});
