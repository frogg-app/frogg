import { Puzzle, RefreshCw } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { getClient, useDaemon } from "../daemon/store";
import { color } from "../theme/tokens";
import { Button } from "./Button";
import { Cut } from "./Cut";
import { GroupHead, PanelHead } from "./PanelHead";
import { Pill, Seg, Toggle } from "./settings/controls";
import { T } from "./Text";

type Client = NonNullable<ReturnType<typeof getClient>>;
type Installed = Awaited<ReturnType<Client["pluginsList"]>>["plugins"][number];
type Catalog = Awaited<ReturnType<Client["pluginsGetCatalog"]>>["plugins"][number];

export function PluginsPanel() {
  const conn = useDaemon((s) => s.conn);
  const [tab, setTab] = useState<"installed" | "browse">("installed");
  const [installed, setInstalled] = useState<Installed[] | null>(null);
  const [catalog, setCatalog] = useState<Catalog[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    const c = getClient();
    if (!c?.supportsPlugins()) return setError("This host's daemon has no plugin support.");
    void c.pluginsList().then((r) => setInstalled(r.plugins), (e: unknown) => setError(String(e)));
    void c.pluginsGetCatalog().then((r) => setCatalog(r.plugins), () => setCatalog([]));
  }, []);
  useEffect(() => {
    if (conn === "online") load();
  }, [conn, load]);
  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await fn();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <View style={{ flex: 1, backgroundColor: color.bg2 }}>
      <PanelHead title="Plugins">
        <Pressable onPress={load} accessibilityLabel="Refresh"><RefreshCw size={14} color={color.faint} /></Pressable>
      </PanelHead>
      <View style={{ paddingHorizontal: 12, paddingBottom: 6 }}>
        <Seg options={[["installed", `Installed ${installed?.length ?? ""}`], ["browse", "Browse"]]} value={tab} onChange={setTab} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }}>
        {error && <T v="mono" style={{ color: color.coral }}>{error}</T>}
        {tab === "installed" && installed?.length === 0 && <T style={{ color: color.faint }}>No plugins installed. Browse the catalog to add one.</T>}
        {tab === "installed" &&
          installed?.map((p) => (
            <Cut key={p.id} size={10} flip style={{ backgroundColor: color.panel, padding: 14, gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Puzzle size={15} color={p.enabled ? color.violet : color.faint} />
                <T style={{ flex: 1, fontWeight: "600" }}>{p.name}</T>
                <Toggle value={p.enabled} disabled={busy === p.id} onChange={(v) => void act(p.id, () => getClient()!.pluginsSetEnabled(p.id, v))} />
              </View>
              {p.description && <T style={{ color: color.muted, fontSize: 12.5, lineHeight: 18 }}>{p.description}</T>}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                <T v="mono" style={{ fontSize: 10.5 }}>v{p.version}</T>
                {p.devPath && <Pill text="dev link" tint={color.amber} />}
                {p.preinstalled && <Pill text="built in" />}
                {p.updateAvailable && <Pill text={`update ${p.updateAvailable}`} tint={color.cyan2} />}
                {p.status !== "active" && p.status !== "ok" && <Pill text={p.status} tint={p.error ? color.coral : color.muted} />}
              </View>
              {p.error && <T v="mono" style={{ color: color.coral, fontSize: 11 }}>{p.error}</T>}
            </Cut>
          ))}
        {tab === "browse" && !catalog && <T v="label">loading catalog…</T>}
        {tab === "browse" && catalog?.length === 0 && <T style={{ color: color.faint }}>No plugin sources configured.</T>}
        {tab === "browse" && catalog && catalog.length > 0 && <GroupHead label="Catalog" count={catalog.length} />}
        {tab === "browse" &&
          catalog?.map((p) => (
            <View key={`${p.repoUrl}:${p.id}`} style={{ backgroundColor: color.panel, padding: 14, gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <T style={{ flex: 1, fontWeight: "600" }}>{p.name}</T>
                {p.installedVersion ? (
                  <Pill text={`installed ${p.installedVersion}`} tint={color.mint} />
                ) : (
                  <Button
                    kind="primary"
                    label={busy === p.id ? "Installing…" : "Install"}
                    disabled={!p.latest?.compatible || busy === p.id}
                    onPress={() =>
                      void act(p.id, () =>
                        getClient()!.pluginsInstall({ id: p.id, repoUrl: p.repoUrl, grantedCapabilities: p.latest?.capabilities ?? [] }),
                      )
                    }
                  />
                )}
              </View>
              {p.description && <T style={{ color: color.muted, fontSize: 12.5 }}>{p.description}</T>}
              <T v="mono" style={{ fontSize: 10.5 }}>
                {[p.repoName, p.category, p.tier, p.latest ? `v${p.latest.version}` : "no compatible version"].filter(Boolean).join(" · ")}
              </T>
              {!!p.latest?.capabilities.length && (
                <T v="mono" style={{ fontSize: 10.5, color: color.amber }}>needs: {p.latest.capabilities.join(", ")}</T>
              )}
            </View>
          ))}
      </ScrollView>
    </View>
  );
}
