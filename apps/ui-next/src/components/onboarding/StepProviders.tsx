// Pick and install providers: what the host has, one-click installs for the ones it can add.
import { Download, KeyRound } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { loadConfig, patchConfig, useConfig } from "../../daemon/config";
import { getClient, useDaemon } from "../../daemon/store";
import { color } from "../../theme/tokens";
import { providerLabel } from "../../util";
import { Button } from "../Button";
import { Pill, Toggle } from "../settings/controls";
import { T } from "../Text";
import { away, openSettingsPage } from "./nav";
import { Cmd, Para, Status, StepHead } from "./parts";
import { goStep, useOnboarding } from "./store";

type Client = NonNullable<ReturnType<typeof getClient>>;
type UpdateEntry = Awaited<ReturnType<Client["checkProviderUpdates"]>>["entries"][number];
type Entry = NonNullable<ReturnType<typeof useConfig.getState>["providers"]>["entries"][number];

/** Installs run npm on the host and can take a while. */
const INSTALL_TIMEOUT = 10 * 60_000;
const PROBE_MS = 2000;

/** Sign-in command per provider, run once on the host as the daemon's user. */
const SIGN_IN: Record<string, string> = { claude: "claude", codex: "codex login" };

const isTest = (id: string) => id.startsWith("mock");
const accounts = () => away("providers", () => openSettingsPage("accounts"));
const backToHost = () => goStep("host");

function statusOf(e: Entry, update: UpdateEntry | undefined): { text: string; tint: string } {
  if (e.enabled === false) return { text: "off", tint: color.faint };
  if (e.status === "ready") return { text: "ready", tint: color.mint };
  if (e.status === "loading") return { text: "checking", tint: color.amber };
  if (update?.status === "not-installed" || e.status === "unavailable")
    return { text: "not installed", tint: color.faint };
  return { text: "error", tint: color.coral };
}

export function ProvidersStep() {
  const online = useDaemon((st) => st.conn === "online");
  const snapshot = useConfig((st) => st.providers);
  const level = useOnboarding((st) => st.level);
  const [updates, setUpdates] = useState<Record<string, UpdateEntry>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = getClient();
    if (!online || !client) return;
    void loadConfig();
    let live = true;
    // Older hosts don't answer this; the list then just has no install buttons.
    client
      .checkProviderUpdates()
      .then((r) => {
        if (live) setUpdates(Object.fromEntries(r.entries.map((e) => [e.provider, e])));
        return r;
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [online]);

  // A host still probing its CLIs answers "loading"; read again until every provider settles.
  const probing = snapshot?.entries.some((e) => e.status === "loading") ?? false;
  useEffect(() => {
    if (!online || !probing) return;
    const t = setTimeout(() => void loadConfig(), PROBE_MS);
    return () => clearTimeout(t);
  }, [online, probing, snapshot]);

  const install = useCallback(async (provider: string) => {
    const client = getClient();
    if (!client) return;
    setBusy(provider);
    setError(null);
    try {
      const r = await client.installProviderUpdate({ provider, timeout: INSTALL_TIMEOUT });
      if (r.error) setError(`${providerLabel(provider)}: ${r.error}`);
      await client.refreshProvidersSnapshot({ providers: [provider] }).catch(() => undefined);
      await loadConfig();
      const fresh = await client.checkProviderUpdates().catch(() => null);
      if (fresh) setUpdates(Object.fromEntries(fresh.entries.map((e) => [e.provider, e])));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  if (!online)
    return (
      <>
        <StepHead title="Agent providers" lede="Providers are the agent CLIs the host runs." />
        <Status tone="wait">Connect a host first; providers are installed there.</Status>
        <Button label="Back to Connect a host" onPress={backToHost} />
      </>
    );

  const entries = snapshot?.entries.filter((e) => !isTest(e.provider)) ?? [];
  const ready = entries.filter((e) => e.status === "ready" && e.enabled !== false);
  return (
    <>
      <StepHead
        title="Agent providers"
        lede={
          level === "expert"
            ? "Turn on the CLIs you use. Frogg installs npm-distributed ones for you."
            : "A provider is an agent CLI like Claude Code or Codex. Frogg runs them on the host and shows their work here. Turn on the ones you have, or install one."
        }
      />
      {ready.length > 0 ? (
        <Status tone="ok">
          {ready.map((e) => e.label ?? providerLabel(e.provider)).join(", ")} ready
        </Status>
      ) : (
        <Status tone="wait">No provider is ready yet</Status>
      )}
      {!snapshot && <T v="label">loading…</T>}
      <View style={s.list}>
        {entries.map((e, i) => (
          <ProviderLine
            key={e.provider}
            entry={e}
            update={updates[e.provider]}
            busy={busy === e.provider}
            locked={busy !== null}
            onInstall={install}
            last={i === entries.length - 1}
          />
        ))}
      </View>
      {error && <T style={s.error}>{error}</T>}
      {level !== "expert" && (
        <>
          <Para>Sign in once on the host, as the user the daemon runs as:</Para>
          <Cmd>{"claude          # Claude Code\ncodex login     # Codex"}</Cmd>
        </>
      )}
      <View style={s.actions}>
        <Button label="Manage sign-ins" icon={KeyRound} onPress={accounts} />
      </View>
    </>
  );
}

function ProviderLine({
  entry: e,
  update,
  busy,
  locked,
  onInstall,
  last,
}: {
  entry: Entry;
  update: UpdateEntry | undefined;
  busy: boolean;
  locked: boolean;
  onInstall: (provider: string) => Promise<void>;
  last: boolean;
}) {
  const st = statusOf(e, update);
  const canInstall = update?.status === "not-installed" && update.updatable;
  const toggle = useCallback(
    (on: boolean) =>
      void patchConfig({ providers: { [e.provider]: { enabled: on } } }).then(loadConfig),
    [e.provider],
  );
  const install = useCallback(() => void onInstall(e.provider), [e.provider, onInstall]);
  const hint = SIGN_IN[e.provider] && st.text === "error" ? `sign in: ${SIGN_IN[e.provider]}` : "";
  return (
    <View style={[s.row, !last && s.rowLine]}>
      <View style={s.grow}>
        <T style={s.name}>{e.label ?? providerLabel(e.provider)}</T>
        {!!(e.error || hint) && (
          <T style={s.sub} numberOfLines={2}>
            {hint || e.error}
          </T>
        )}
      </View>
      <Pill text={busy ? "installing" : st.text} tint={busy ? color.cyan2 : st.tint} />
      {canInstall ? (
        <Button
          label={busy ? "Installing…" : "Install"}
          icon={Download}
          kind="primary"
          onPress={install}
          disabled={locked}
        />
      ) : (
        <Toggle value={e.enabled !== false} onChange={toggle} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  list: { backgroundColor: color.panel, marginBottom: 14 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  rowLine: { borderBottomWidth: 1, borderBottomColor: color.line },
  grow: { flex: 1 },
  name: { fontWeight: "500" },
  sub: { color: color.faint, fontSize: 12, marginTop: 2 },
  error: { color: color.coral, marginBottom: 10 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
