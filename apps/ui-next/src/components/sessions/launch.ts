// Launch options for a new agent: the provider account, extra CLI flags and feature values,
// pre-filled from the project's frogg.json `agentDefaults` and editable before launch.
import type { FroggAgentDefaults, FroggConfigRaw } from "@frogg/protocol/frogg-config-schema";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { useEffect, useState } from "react";
import type { HostProviders } from "./create";

type Entry = HostProviders["entries"][number];
export type Feature = NonNullable<
  Awaited<ReturnType<DaemonClient["listProviderFeatures"]>>["features"]
>[number];

/** The SDK's extra CLI flags: names without dashes, null for a bare switch. */
export type ExtraArgs = Record<string, string | null>;

/** Providers whose daemon passes extra CLI flags through (`features.claudeExtraArgs`). */
export const FLAG_PROVIDERS: ReadonlySet<string> = new Set(["claude"]);

// ---- flags ----

/** Splits typed flags on whitespace, keeping "quoted values" together. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}

/** Tokens back to text; tokens with spaces are quoted. */
export function flagsText(tokens: readonly string[] | undefined): string {
  return (tokens ?? []).map((t) => (/\s/.test(t) || t === "" ? `"${t}"` : t)).join(" ");
}

/**
 * Typed flags as SDK extraArgs: `--chrome` is a switch, `--add-dir /x` and `--add-dir=/x` carry
 * a value. Anything that is not a long flag or its value is an error.
 */
export function parseFlags(text: string): { args: ExtraArgs } | { error: string } {
  const args: ExtraArgs = {};
  const tokens = tokenize(text);
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i] ?? "";
    if (!tok.startsWith("--") || tok.length < 3)
      return { error: `“${tok}” is not a long flag; write flags as --name or --name value` };
    const eq = tok.indexOf("=");
    const name = (eq > 0 ? tok.slice(2, eq) : tok.slice(2)).toLowerCase();
    if (!/^[a-z][a-z0-9-]*$/.test(name)) return { error: `“${tok}” is not a flag name` };
    if (eq > 0) {
      args[name] = tok.slice(eq + 1);
      continue;
    }
    const next = tokens[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args[name] = next;
      i += 1;
    } else args[name] = null;
  }
  return { args };
}

// ---- accounts ----

export interface AccountChoice {
  value: string;
  label: string;
  hint?: string;
}

/** The synthetic row for the provider's primary config dir when the daemon does not list it. */
export const PRIMARY_ACCOUNT = "__primary";

/**
 * The account picker for a provider, or null when there is nothing to choose (no accounts
 * capability or a single sign-in). `initial` is the daemon's active account.
 */
export function accountChoices(
  entry: Pick<Entry, "accounts" | "defaultAccountId"> | undefined,
): { options: AccountChoice[]; initial: string; primary: string } | null {
  const accounts = entry?.accounts ?? [];
  if (!accounts.length) return null;
  const listed = accounts.find((a) => a.id.startsWith("default:"));
  const label = (a: (typeof accounts)[number]) =>
    a.id === listed?.id && a.name === "default" ? "Default" : a.name;
  const rows: AccountChoice[] = accounts.map((a) => ({
    value: a.id,
    label: label(a),
    hint: a.authenticated ? undefined : "signed out",
  }));
  const options = listed ? rows : [{ value: PRIMARY_ACCOUNT, label: "Default" }, ...rows];
  if (options.length < 2) return null;
  const primary = listed?.id ?? PRIMARY_ACCOUNT;
  const active = entry?.defaultAccountId;
  const initial = active && options.some((o) => o.value === active) ? active : primary;
  return { options, initial, primary };
}

/** The create-agent `providerAccountId` for a pick: the primary config dir is `null`. */
export function accountIdFor(pick: string | null, primary: string): string | null | undefined {
  if (pick === null) return undefined;
  return pick === primary ? null : pick;
}

// ---- project defaults ----

/** The project's agentDefaults from frogg.json, or null when it has none or cannot be read. */
export function useProjectAgentDefaults(
  client: DaemonClient | null,
  root: string | undefined,
  /** Bump to read the file again (after saving). */
  reload = 0,
): FroggAgentDefaults | null {
  const [defaults, setDefaults] = useState<FroggAgentDefaults | null>(null);
  useEffect(() => {
    setDefaults(null);
    if (!client || !root) return;
    let live = true;
    client
      .readProjectConfig(root)
      .then((r) => {
        if (live && r.ok) setDefaults(agentDefaultsOf(r.config));
        return undefined;
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [client, root, reload]);
  return defaults;
}

export function agentDefaultsOf(config: FroggConfigRaw | null | undefined): FroggAgentDefaults {
  const raw = config?.agentDefaults;
  return raw && typeof raw === "object" ? raw : {};
}

/** Writes one provider's defaults into the project's frogg.json, keeping everything else. */
export async function saveProjectAgentDefaults(
  client: DaemonClient,
  root: string,
  provider: string,
  value: { args: string[]; featureValues: Record<string, unknown> },
): Promise<void> {
  const read = await client.readProjectConfig(root);
  if (!read.ok) throw new Error(read.error.code.replace(/_/g, " "));
  const all = { ...agentDefaultsOf(read.config) };
  const { args: _args, featureValues: _features, ...rest } = all[provider] ?? {};
  const entry = {
    ...rest,
    ...(value.args.length ? { args: value.args } : {}),
    ...(Object.keys(value.featureValues).length ? { featureValues: value.featureValues } : {}),
  };
  if (Object.keys(entry).length) all[provider] = entry;
  else delete all[provider];
  const config = { ...read.config, agentDefaults: Object.keys(all).length ? all : undefined };
  const res = await client.writeProjectConfig({
    repoRoot: root,
    config,
    expectedRevision: read.revision,
  });
  if (!res.ok) throw new Error(res.error.code.replace(/_/g, " "));
}

/**
 * The provider's features for a new agent in `cwd`, valued as they would launch with `seed`
 * (the project defaults). Edits on top are the caller's; this does not refetch per edit.
 */
export function useDraftFeatures(
  client: DaemonClient | null,
  provider: string | undefined,
  cwd: string | undefined,
  seed: Record<string, unknown> | undefined,
): Feature[] {
  const [features, setFeatures] = useState<Feature[]>([]);
  const key = JSON.stringify(seed ?? {});
  useEffect(() => {
    setFeatures([]);
    if (!client || !provider || !cwd) return;
    let live = true;
    client
      .listProviderFeatures({
        provider: provider as never,
        cwd,
        featureValues: JSON.parse(key) as Record<string, unknown>,
      })
      .then((r) => {
        if (live) setFeatures(r.features ?? []);
        return undefined;
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [client, provider, cwd, key]);
  return features;
}
