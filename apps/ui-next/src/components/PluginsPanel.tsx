import { RefreshCw } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import {
  describePluginError,
  installPlugin,
  refreshWatchedPlugins,
  usePlugins,
  useWatchPlugins,
  type CatalogPlugin as Catalog,
  type PluginRepo as Repo,
} from "../daemon/plugins";
import { color, font } from "../theme/tokens";
import { Button } from "./Button";
import { GroupHead, PanelHead } from "./PanelHead";
import { Pill } from "./settings/controls";
import { T } from "./Text";
import { Tabs } from "./tools/Tabs";
import { useConfirm } from "./tools/Confirm";
import { PluginSources } from "./tools/PluginSources";
import { capabilityLine, InstalledRow, type Act } from "./tools/PluginInstalled";

type Tab = "installed" | "browse" | "sources";

export function PluginsPanel() {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("installed");
  // The lists live in the shared store and follow the host's plugins.changed events.
  useWatchPlugins("installed");
  useWatchPlugins("catalog", tab === "browse");
  const installed = usePlugins((s) => s.installed);
  const policy = usePlugins((s) => s.policy);
  const catalog = usePlugins((s) => s.catalog);
  const repoErrors = usePlugins((s) => s.catalogErrors);
  const loadError = usePlugins(
    (s) => s.errors.installed ?? (tab === "browse" ? s.errors.catalog : undefined),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    setActError(null);
    refreshWatchedPlugins();
  }, []);
  const act = useCallback(async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setActError(null);
    try {
      await fn();
    } catch (e) {
      setActError(describePluginError(e));
    } finally {
      setBusy(null);
    }
  }, []);
  const error = actError ?? loadError ?? null;
  const segOptions = useMemo<Array<[Tab, string]>>(
    () => [
      ["installed", `Installed ${installed?.length ?? ""}`],
      ["browse", "Browse"],
      ["sources", "Sources"],
    ],
    [installed?.length],
  );
  const tabs = useMemo(() => segOptions.map(([id, label]) => ({ id, label })), [segOptions]);
  const off = policy?.enabled === false;
  const rcForbidden = policy?.remoteControl === "forbidden";
  const filtered = catalog?.filter((p) =>
    `${p.name} ${p.description ?? ""} ${p.category ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <View style={st.fill}>
      <PanelHead title="Plugins">
        <Pressable onPress={refresh} accessibilityLabel="Refresh">
          <RefreshCw size={14} color={color.faint} />
        </Pressable>
      </PanelHead>
      <View style={st.segWrap}>
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
      </View>
      {tab === "browse" && (
        <TextInput
          accessibilityLabel="Search plugins"
          placeholder="Search plugins"
          placeholderTextColor={color.faint}
          value={query}
          onChangeText={setQuery}
          style={st.search}
        />
      )}
      <ScrollView contentContainerStyle={st.scroll}>
        {tab === "sources" && <PluginSources />}
        {tab === "installed" && !installed && !error && <T v="label">Loading plugins…</T>}
        {error && (
          <T v="mono" style={st.error}>
            {error}
          </T>
        )}
        {off && <T style={st.faint}>Plugins are turned off for this build.</T>}
        {tab === "installed" && !off && installed?.length === 0 && (
          <T style={st.faint}>No plugins installed. Browse the catalog to add one.</T>
        )}
        {tab === "installed" &&
          installed?.map((p) => (
            <InstalledRow
              key={p.id}
              p={p}
              busy={busy === p.id}
              act={act}
              remoteControlForbidden={rcForbidden}
            />
          ))}
        {tab === "browse" && (
          <Browse
            catalog={catalog}
            filtered={filtered}
            repoErrors={repoErrors}
            busy={busy}
            act={act}
            remoteControlForbidden={rcForbidden}
          />
        )}
      </ScrollView>
    </View>
  );
}

/** The Browse tab: sources that failed to fetch or verify, then the catalog. */
function Browse({
  catalog,
  filtered,
  repoErrors,
  busy,
  act,
  remoteControlForbidden,
}: {
  catalog: Catalog[] | null;
  filtered: Catalog[] | undefined;
  repoErrors: Repo[];
  busy: string | null;
  act: Act;
  remoteControlForbidden: boolean;
}) {
  return (
    <>
      {!catalog && <T v="label">loading catalog…</T>}
      {catalog?.length === 0 && <T style={st.faint}>No plugin sources configured.</T>}
      {repoErrors.map((r) => (
        <T key={r.url} v="mono" style={st.rowError}>
          {r.name}: {r.error}
        </T>
      ))}
      {catalog && catalog.length > 0 && <GroupHead label="Catalog" count={filtered?.length} />}
      {filtered?.map((p) => (
        <CatalogRow
          key={`${p.repoUrl}:${p.id}`}
          p={p}
          busy={busy === p.id}
          act={act}
          remoteControlForbidden={remoteControlForbidden}
        />
      ))}
    </>
  );
}

function CatalogRow({
  p,
  busy,
  act,
  remoteControlForbidden,
}: {
  p: Catalog;
  busy: boolean;
  act: Act;
  remoteControlForbidden: boolean;
}) {
  const confirm = useConfirm();
  const onInstall = useCallback(
    () =>
      confirm.ask({
        eyebrow: "Plugin permissions",
        title: `Install ${p.name}?`,
        body: `Source: ${p.repoName}\nVersion: ${p.latest?.version ?? "unknown"}\n\nPermissions requested:\n${p.latest?.capabilities.map(capabilityLine(remoteControlForbidden)).join("\n") || "No additional capabilities"}\n\nHost plugins are not sandboxed. Only install plugins from sources you trust.`,
        action: "Grant and install",
        run: () =>
          void act(p.id, () =>
            installPlugin({
              id: p.id,
              repoUrl: p.repoUrl,
              version: p.latest?.version,
              grantedCapabilities: p.latest?.capabilities ?? [],
            }),
          ),
      }),
    [confirm, act, p, remoteControlForbidden],
  );
  return (
    <View style={st.catalogCard}>
      {confirm.dialog}
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
        {[p.repoName, p.category, p.tier, p.latest ? `v${p.latest.version}` : incompatible(p)]
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

/** Why a listed plugin has no version this host can load. */
function incompatible(p: Catalog): string {
  const api = Math.max(0, ...p.versions.map((v) => v.apiVersion));
  return api > 0 ? `needs a newer host (plugin API v${api})` : "no compatible version";
}

const st = StyleSheet.create({
  search: {
    margin: 12,
    padding: 10,
    color: color.text,
    fontFamily: font.body,
    borderWidth: 1,
    borderColor: color.line2,
  },
  fill: { flex: 1, backgroundColor: color.bg2 },
  segWrap: { paddingHorizontal: 12, paddingBottom: 6 },
  scroll: { padding: 12, gap: 10 },
  error: { color: color.coral },
  faint: { color: color.faint },
  catalogCard: { backgroundColor: color.panel, padding: 14, gap: 6 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { flex: 1, fontWeight: "600" },
  desc: { color: color.muted, fontSize: 12.5 },
  mono: { fontSize: 10.5 },
  rowError: { color: color.coral, fontSize: 11 },
  needs: { fontSize: 10.5, color: color.amber },
});
