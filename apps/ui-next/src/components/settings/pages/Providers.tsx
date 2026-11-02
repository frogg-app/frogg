import { ChevronRight } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { loadConfig, patchConfig, useConfig } from "../../../daemon/config";
import { getClient } from "../../../daemon/store";
import { color, ease, glide, motion, web } from "../../../theme/tokens";
import { agoText, providerLabel } from "../../../util";
import { T } from "../../Text";
import { Note, Pill, Section, Toggle } from "../controls";

type Snapshot = NonNullable<ReturnType<typeof useConfig.getState>["providers"]>;
type Entry = Snapshot["entries"][number];

interface Model {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
  isSelectable?: boolean;
  contextWindowMaxTokens?: number;
}

function statusTint(st: string): string {
  if (st === "ready") return color.mint;
  if (st === "error" || st === "unavailable") return color.coral;
  return color.amber;
}

const EXPANDED = { expanded: true };
const COLLAPSED = { expanded: false };

/** Re-read while any provider is still probing its CLI (just enabled, or the host just started). */
const PROBE_MS = 2500;

/** Owners change host config; an older daemon reports no role and acts as owner. */
const isOwner = () => {
  const role = (getClient()?.getLastServerInfoMessage() as { callerRole?: string } | null)
    ?.callerRole;
  return !role || role === "owner";
};

/** Turns a provider on or off in the host's config.json, then re-reads its status. */
async function setProviderEnabled(provider: string, enabled: boolean): Promise<void> {
  await patchConfig({ providers: { [provider]: { enabled } } });
  const client = getClient();
  if (enabled)
    await client?.refreshProvidersSnapshot({ providers: [provider as never] }).catch(() => null);
  await loadConfig();
}

const tokens = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : `${Math.round(n / 1000)}k`);

/** Settings → Providers & models: every installed provider; open one to see all its models. */
export function Providers() {
  const providers = useConfig((st) => st.providers);
  const [open, setOpen] = useState<string | null>(null);
  const probing = providers?.entries.some((e) => e.status === "loading") ?? false;
  useEffect(() => {
    if (!probing) return;
    const t = setTimeout(() => void loadConfig(), PROBE_MS);
    return () => clearTimeout(t);
  }, [probing, providers]);
  if (!providers) return <T v="label">loading…</T>;
  const last = providers.entries.at(-1)?.provider;
  const owner = isOwner();
  return (
    <>
      <Section title="Installed providers">
        {providers.entries.map((p) => (
          <ProviderRow
            key={p.provider}
            entry={p}
            open={open === p.provider}
            onToggle={setOpen}
            canEdit={owner}
            last={p.provider === last}
          />
        ))}
      </Section>
      <Note>
        {owner
          ? "A provider that is off stays installed but can't start new agents on this host."
          : "Only the host's owner can turn providers on or off."}
      </Note>
    </>
  );
}

function ProviderRow({
  entry: p,
  open,
  onToggle,
  canEdit,
  last,
}: {
  entry: Entry;
  open: boolean;
  onToggle: (id: string | null) => void;
  canEdit: boolean;
  last: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const setEnabled = useCallback(
    (on: boolean) => {
      setBusy(true);
      void setProviderEnabled(p.provider, on).finally(() => setBusy(false));
    },
    [p.provider],
  );
  const toggle = useCallback(
    () => onToggle(open ? null : p.provider),
    [onToggle, open, p.provider],
  );
  const models = useModels(p, open);
  const count = models.list.length;
  const hint =
    p.error ??
    `${count} model${count === 1 ? "" : "s"}${p.fetchedAt ? ` · checked ${agoText(p.fetchedAt)}` : ""}`;
  return (
    <View style={!last && s.line}>
      <View style={s.head}>
        <Pressable
          style={s.grow}
          onPress={toggle}
          accessibilityRole="button"
          accessibilityState={open ? EXPANDED : COLLAPSED}
          accessibilityLabel={`${open ? "Hide" : "Show"} ${p.label ?? providerLabel(p.provider)} models`}
        >
          {({ hovered }) => (
            <View style={[s.row, hovered && s.hover]}>
              <View style={[s.chev, open && s.chevOpen]}>
                <ChevronRight size={13} color={open ? color.cyan2 : color.faint} />
              </View>
              <View style={s.text}>
                <T style={s.label}>{p.label ?? providerLabel(p.provider)}</T>
                <T style={p.error ? s.err : s.hint}>{hint}</T>
              </View>
              <View style={s.pills}>
                {p.enabled ? (
                  <Pill text={p.status} tint={statusTint(p.status)} />
                ) : (
                  <Pill text="off" />
                )}
              </View>
            </View>
          )}
        </Pressable>
        <View style={s.switch}>
          <Toggle
            value={p.enabled}
            onChange={setEnabled}
            disabled={!canEdit || busy}
            label={`${p.enabled ? "Turn off" : "Turn on"} ${p.label ?? providerLabel(p.provider)}`}
          />
        </View>
      </View>
      {open && (
        <View style={s.models}>
          {models.list.map((m) => (
            <ModelRow key={m.id} m={m} />
          ))}
          {!count && !models.loading && <T style={s.hint}>This provider reports no models.</T>}
          {models.loading && <T style={s.hint}>Asking the provider for its full list…</T>}
          {models.error && !count && <T style={s.err}>{models.error}</T>}
        </View>
      )}
    </View>
  );
}

/** The snapshot's models at once; opening a provider asks it for the full, current list. */
function useModels(p: Entry, open: boolean) {
  const [fresh, setFresh] = useState<Model[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const c = getClient();
    if (!open || !c || fresh) return;
    let live = true;
    setLoading(true);
    c.listProviderModels(p.provider as never)
      .then((r) => {
        if (!live) return undefined;
        if (r.error) setError(r.error);
        else setFresh(r.models ?? []);
        return undefined;
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [open, p.provider, fresh]);
  const list = useMemo<Model[]>(() => fresh ?? p.models ?? [], [fresh, p.models]);
  return { list, loading, error };
}

function ModelRow({ m }: { m: Model }) {
  return (
    <View style={s.model}>
      <View style={s.text}>
        <View style={s.modelHead}>
          <T style={m.isSelectable === false ? s.modelOff : s.modelName}>{m.label}</T>
          {m.isDefault && <Pill text="default" tint={color.cyan2} />}
          {m.isSelectable === false && <Pill text="hidden" />}
        </View>
        {m.description ? (
          <T style={s.hint} numberOfLines={2}>
            {m.description}
          </T>
        ) : null}
      </View>
      {m.contextWindowMaxTokens ? (
        <T v="mono" style={s.meta}>
          {tokens(m.contextWindowMaxTokens)} ctx
        </T>
      ) : null}
      <T v="mono" style={s.id} numberOfLines={1} selectable>
        {m.id}
      </T>
    </View>
  );
}

const s = StyleSheet.create({
  line: { borderBottomWidth: 1, borderBottomColor: color.line },
  head: { flexDirection: "row", alignItems: "center" },
  grow: { flex: 1 },
  switch: { paddingRight: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    ...web({ transition: `background-color ${glide.ms}ms ${ease}` }),
  },
  hover: { backgroundColor: color.wash },
  chev: { ...web({ transition: `transform ${glide.ms}ms ${ease}` }) },
  chevOpen: { transform: [{ rotate: "90deg" }] },
  text: { flex: 1, minWidth: 160 },
  label: { fontWeight: "500" },
  hint: { color: color.faint, fontSize: 12.5, marginTop: 3, lineHeight: 18 },
  err: { color: color.coral, fontSize: 12.5, marginTop: 3, lineHeight: 18 },
  pills: { flexDirection: "row", gap: 6 },
  models: { paddingLeft: 41, paddingRight: 16, paddingBottom: 12, gap: 2, ...motion.enter },
  model: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  modelHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  modelName: { fontSize: 13 },
  modelOff: { fontSize: 13, color: color.muted },
  meta: { fontSize: 11, color: color.faint },
  id: { fontSize: 11, color: color.muted, maxWidth: 260 },
});
