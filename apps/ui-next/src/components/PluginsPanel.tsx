import { Puzzle, RefreshCw } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
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
    void c.pluginsList().then(
      (r) => setInstalled(r.plugins),
      (e: unknown) => setError(String(e)),
    );
    void c.pluginsGetCatalog().then(
      (r) => setCatalog(r.plugins),
      () => setCatalog([]),
    );
  }, []);
  useEffect(() => {
    if (conn === "online") load();
  }, [conn, load]);
  const act = useCallback(
    async (id: string, fn: () => Promise<unknown>) => {
      setBusy(id);
      try {
        await fn();
        load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [load],
  );
  const segOptions = useMemo<Array<["installed" | "browse", string]>>(
    () => [
      ["installed", `Installed ${installed?.length ?? ""}`],
      ["browse", "Browse"],
    ],
    [installed?.length],
  );
  return (
    <View style={st.fill}>
      <PanelHead title="Plugins">
        <Pressable onPress={load} accessibilityLabel="Refresh">
          <RefreshCw size={14} color={color.faint} />
        </Pressable>
      </PanelHead>
      <View style={st.segWrap}>
        <Seg options={segOptions} value={tab} onChange={setTab} />
      </View>
      <ScrollView contentContainerStyle={st.scroll}>
        {error && (
          <T v="mono" style={st.error}>
            {error}
          </T>
        )}
        {tab === "installed" && installed?.length === 0 && (
          <T style={st.faint}>No plugins installed. Browse the catalog to add one.</T>
        )}
        {tab === "installed" &&
          installed?.map((p) => <InstalledRow key={p.id} p={p} busy={busy === p.id} act={act} />)}
        {tab === "browse" && !catalog && <T v="label">loading catalog…</T>}
        {tab === "browse" && catalog?.length === 0 && (
          <T style={st.faint}>No plugin sources configured.</T>
        )}
        {tab === "browse" && catalog && catalog.length > 0 && (
          <GroupHead label="Catalog" count={catalog.length} />
        )}
        {tab === "browse" &&
          catalog?.map((p) => (
            <CatalogRow key={`${p.repoUrl}:${p.id}`} p={p} busy={busy === p.id} act={act} />
          ))}
      </ScrollView>
    </View>
  );
}

type Act = (id: string, fn: () => Promise<unknown>) => Promise<void>;

function InstalledRow({ p, busy, act }: { p: Installed; busy: boolean; act: Act }) {
  const onToggle = useCallback(
    (v: boolean) => void act(p.id, () => getClient()!.pluginsSetEnabled(p.id, v)),
    [act, p.id],
  );
  return (
    <Cut size={10} flip style={st.installedCard}>
      <View style={st.headRow}>
        <Puzzle size={15} color={p.enabled ? color.violet : color.faint} />
        <T style={st.name}>{p.name}</T>
        <Toggle value={p.enabled} disabled={busy} onChange={onToggle} />
      </View>
      {p.description && <T style={st.descInstalled}>{p.description}</T>}
      <View style={st.pills}>
        <T v="mono" style={st.mono}>
          v{p.version}
        </T>
        {p.devPath && <Pill text="dev link" tint={color.amber} />}
        {p.preinstalled && <Pill text="built in" />}
        {p.updateAvailable && <Pill text={`update ${p.updateAvailable}`} tint={color.cyan2} />}
        {p.status !== "active" && p.status !== "ok" && (
          <Pill text={p.status} tint={p.error ? color.coral : color.muted} />
        )}
      </View>
      {p.error && (
        <T v="mono" style={st.rowError}>
          {p.error}
        </T>
      )}
    </Cut>
  );
}

function CatalogRow({ p, busy, act }: { p: Catalog; busy: boolean; act: Act }) {
  const onInstall = useCallback(
    () =>
      void act(p.id, () =>
        getClient()!.pluginsInstall({
          id: p.id,
          repoUrl: p.repoUrl,
          grantedCapabilities: p.latest?.capabilities ?? [],
        }),
      ),
    [act, p.id, p.repoUrl, p.latest?.capabilities],
  );
  return (
    <View style={st.catalogCard}>
      <View style={st.headRow}>
        <T style={st.name}>{p.name}</T>
        {p.installedVersion ? (
          <Pill text={`installed ${p.installedVersion}`} tint={color.mint} />
        ) : (
          <Button
            kind="primary"
            label={busy ? "Installing…" : "Install"}
            disabled={!p.latest?.compatible || busy}
            onPress={onInstall}
          />
        )}
      </View>
      {p.description && <T style={st.desc}>{p.description}</T>}
      <T v="mono" style={st.mono}>
        {[
          p.repoName,
          p.category,
          p.tier,
          p.latest ? `v${p.latest.version}` : "no compatible version",
        ]
          .filter(Boolean)
          .join(" · ")}
      </T>
      {!!p.latest?.capabilities.length && (
        <T v="mono" style={st.needs}>
          needs: {p.latest.capabilities.join(", ")}
        </T>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg2 },
  segWrap: { paddingHorizontal: 12, paddingBottom: 6 },
  scroll: { padding: 12, gap: 10 },
  error: { color: color.coral },
  faint: { color: color.faint },
  installedCard: { backgroundColor: color.panel, padding: 14, gap: 8 },
  catalogCard: { backgroundColor: color.panel, padding: 14, gap: 6 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { flex: 1, fontWeight: "600" },
  descInstalled: { color: color.muted, fontSize: 12.5, lineHeight: 18 },
  desc: { color: color.muted, fontSize: 12.5 },
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    alignItems: "center",
  },
  mono: { fontSize: 10.5 },
  rowError: { color: color.coral, fontSize: 11 },
  needs: { fontSize: 10.5, color: color.amber },
});
