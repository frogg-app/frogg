import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { color, font, web } from "../../theme/tokens";
import { Select } from "../Select";
import { Toggle } from "../settings/controls";
import { T } from "../Text";
import type { HostProviders } from "./create";
import {
  accountChoices,
  accountIdFor,
  FLAG_PROVIDERS,
  flagsText,
  parseFlags,
  saveProjectAgentDefaults,
  tokenize,
  useDraftFeatures,
  useProjectAgentDefaults,
  type ExtraArgs,
  type Feature,
} from "./launch";

type Entry = HostProviders["entries"][number];

/** What a new agent launches with beyond provider, model and mode. */
export interface LaunchInput {
  providerAccountId?: string | null;
  featureValues?: Record<string, unknown>;
  providerOptions?: { extraArgs: ExtraArgs };
}

export interface Launch {
  input: LaunchInput;
  /** Why the typed flags cannot launch, or null. */
  error: string | null;
  fields: LaunchFieldsProps;
}

interface LaunchFieldsProps {
  accounts: ReturnType<typeof accountChoices>;
  account: string | null;
  setAccount: (v: string) => void;
  flagsOn: boolean;
  flags: string;
  setFlags: (v: string) => void;
  features: Feature[];
  values: Record<string, unknown>;
  setValue: (id: string, v: unknown) => void;
  dirty: boolean;
  canSave: boolean;
  saving: boolean;
  saved: boolean;
  save: () => void;
  error: string | null;
}

/**
 * Account, extra flags and feature values for a new agent on `client`'s host, starting from the
 * provider's active account and the project's frogg.json `agentDefaults` for that provider.
 */
export function useLaunch(f: {
  client: DaemonClient | null;
  entry: Entry | undefined;
  root: string | undefined;
  flagsSupported: boolean;
}): Launch {
  const { client, entry, root, flagsSupported } = f;
  const provider = entry?.provider;
  const accounts = useMemo(() => accountChoices(entry), [entry]);
  const [account, setAccount] = useState<string | null>(null);
  useEffect(() => setAccount(accounts?.initial ?? null), [accounts]);

  const [reload, setReload] = useState(0);
  const all = useProjectAgentDefaults(client, root, reload);
  const defaults = provider ? all?.[provider] : undefined;
  const flagsOn = flagsSupported && !!provider && FLAG_PROVIDERS.has(provider);
  const seedFlags = flagsText(defaults?.args);
  const [flags, setFlags] = useState("");
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  useEffect(() => {
    setFlags(seedFlags);
    setEdits({});
  }, [seedFlags, provider, root]);
  const features = useDraftFeatures(client, provider, root, defaults?.featureValues);
  const values = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const x of features) out[x.id] = x.id in edits ? edits[x.id] : x.value;
    return out;
  }, [features, edits]);
  const setValue = useCallback(
    (id: string, v: unknown) => setEdits((e) => ({ ...e, [id]: v })),
    [],
  );

  const parsed = useMemo(() => parseFlags(flagsOn ? flags : ""), [flags, flagsOn]);
  const error = "error" in parsed ? parsed.error : null;
  const extraArgs = useMemo(() => ("args" in parsed ? parsed.args : {}), [parsed]);
  const featureValues = useMemo(
    () => ({ ...defaults?.featureValues, ...edits }),
    [defaults?.featureValues, edits],
  );
  const input = useMemo<LaunchInput>(
    () => ({
      providerAccountId: accounts ? accountIdFor(account, accounts.primary) : undefined,
      ...(Object.keys(featureValues).length ? { featureValues } : {}),
      ...(Object.keys(extraArgs).length ? { providerOptions: { extraArgs } } : {}),
    }),
    [accounts, account, featureValues, extraArgs],
  );

  const dirty =
    flags.trim() !== seedFlags.trim() ||
    Object.keys(edits).some((k) => edits[k] !== defaults?.featureValues?.[k]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => setSaved(false), [provider, root]);
  const save = useCallback(() => {
    if (!client || !root || !provider || error) return;
    setSaving(true);
    setSaveError(null);
    saveProjectAgentDefaults(client, root, provider, {
      args: flagsOn ? tokenize(flags) : (defaults?.args ?? []),
      featureValues,
    })
      .then(() => {
        setSaved(true);
        setReload((n) => n + 1);
        return undefined;
      })
      .catch((e: unknown) => setSaveError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSaving(false));
  }, [client, root, provider, error, flagsOn, flags, defaults?.args, featureValues]);

  return {
    input,
    error,
    fields: {
      accounts,
      account,
      setAccount,
      flagsOn,
      flags,
      setFlags,
      features,
      values,
      setValue,
      dirty,
      canSave: !!root && all !== null,
      saving,
      saved,
      save,
      error: error ?? saveError,
    },
  };
}

type FieldShell = ComponentType<{
  label: string;
  phone?: boolean;
  z?: number;
  children: ReactNode;
}>;

/** Account, flags and feature rows of the new-session sheet; each shows only when it applies. */
export function LaunchFields({
  phone,
  Field,
  ...p
}: LaunchFieldsProps & { phone: boolean; Field: FieldShell }) {
  return (
    <>
      {p.accounts && (
        <Field label="Account" phone={phone} z={3}>
          <Select
            width={phone ? "100%" : 240}
            label="Account"
            value={p.account}
            onChange={p.setAccount}
            options={p.accounts.options}
          />
        </Field>
      )}
      {p.features.map((x) => (
        <FeatureField
          key={x.id}
          feature={x}
          value={p.values[x.id]}
          onChange={p.setValue}
          phone={phone}
          Field={Field}
        />
      ))}
      {p.flagsOn && (
        <Field label="Flags" phone={phone}>
          <View style={[s.flagsRow, phone && s.flagsPhone]}>
            <TextInput
              value={p.flags}
              onChangeText={p.setFlags}
              placeholder="--chrome"
              placeholderTextColor={color.faint}
              autoCapitalize="none"
              autoCorrect={false}
              style={[s.flags, phone && s.flagsInputPhone]}
              accessibilityLabel="Extra launch flags"
            />
            <SaveDefaults {...p} />
          </View>
        </Field>
      )}
      {!p.flagsOn && p.features.length > 0 && (
        <View style={s.saveOnly}>
          <SaveDefaults {...p} />
        </View>
      )}
      {p.error && (
        <T v="mono" style={s.err}>
          {p.error}
        </T>
      )}
    </>
  );
}

/** Keeps the current flags and feature values as this project's defaults for the provider. */
function SaveDefaults({ dirty, canSave, saving, saved, save, error }: LaunchFieldsProps) {
  if (!canSave) return null;
  if (saved && !dirty) return <T style={s.note}>Project default</T>;
  if (!dirty) return null;
  const off = saving || !!error;
  return (
    <Pressable onPress={save} disabled={off} accessibilityLabel="Save as project default">
      {({ hovered }) => (
        <T style={[s.link, hovered && !off && s.linkOn, off && s.linkOff]}>
          {saving ? "Saving…" : "Save for project"}
        </T>
      )}
    </Pressable>
  );
}

function FeatureField({
  feature,
  value,
  onChange,
  phone,
  Field,
}: {
  feature: Feature;
  value: unknown;
  onChange: (id: string, v: unknown) => void;
  phone: boolean;
  Field: FieldShell;
}) {
  const set = useCallback((v: unknown) => onChange(feature.id, v), [feature.id, onChange]);
  const options = useMemo(
    () =>
      feature.type === "select"
        ? feature.options.map((o) => ({ value: o.id, label: o.label }))
        : [],
    [feature],
  );
  return (
    <Field label={feature.label} phone={phone}>
      {feature.type === "toggle" ? (
        <Toggle value={value === true} onChange={set} />
      ) : (
        <Select
          width={phone ? "100%" : 240}
          label={feature.label}
          value={typeof value === "string" ? value : null}
          onChange={set}
          options={options}
        />
      )}
    </Field>
  );
}

const s = StyleSheet.create({
  flagsRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  flagsPhone: { flexDirection: "column", alignItems: "stretch", gap: 6 },
  flags: {
    width: 240,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: color.bg,
    borderWidth: 1,
    borderColor: color.line,
    color: color.text,
    fontFamily: font.mono,
    fontSize: 12.5,
    ...web({ outlineStyle: "none" }),
  },
  flagsInputPhone: { width: "100%", paddingVertical: 10 },
  saveOnly: { alignItems: "flex-end" },
  link: { fontSize: 12, color: color.muted },
  linkOn: { color: color.text },
  linkOff: { color: color.faint },
  note: { fontSize: 12, color: color.faint },
  err: { color: color.coral, fontSize: 11 },
});
