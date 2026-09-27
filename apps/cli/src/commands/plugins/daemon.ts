// Host-side plugin management over the daemon connection.
import path from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import type { PluginInstalled, PluginRepo } from "@frogg/protocol/plugins/rpc-schemas";
import type { CommandOptions, ListResult, OutputSchema } from "../../output/index.js";
import { connectToDaemon } from "../../utils/client.js";
import { fields, type FieldRow } from "./shared.js";

interface PluginErrorLike {
  code: string;
  message: string;
  capabilities?: string[];
}

function asPluginError(err: unknown): PluginErrorLike | null {
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string"
  ) {
    return err as PluginErrorLike;
  }
  return null;
}

async function withPlugins<T>(
  options: CommandOptions,
  fn: (client: DaemonClient) => Promise<T>,
): Promise<T> {
  const client = await connectToDaemon({ host: options.host });
  try {
    if (!client.supportsPlugins()) {
      throw {
        code: "PLUGINS_UNAVAILABLE",
        message:
          "This host does not support plugins (disabled by the build, or the daemon needs an update)",
      };
    }
    try {
      return await fn(client);
    } catch (err) {
      // Daemon-side plugin errors become CLI errors with a stable PLUGIN_<CODE> code.
      if (err instanceof Error && err.name === "PluginRequestError") {
        const pe = err as Error & PluginErrorLike;
        throw { code: `PLUGIN_${pe.code.toUpperCase()}`, message: pe.message };
      }
      throw err;
    }
  } finally {
    await client.close().catch(() => {});
  }
}

export interface PluginRow {
  id: string;
  version: string;
  status: string;
  source: string;
  enabled: string;
  update: string;
  name: string;
}

const STATUS_COLORS: Record<string, string> = { active: "green", error: "red", blocked: "red" };

const pluginSchema: OutputSchema<PluginRow> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 30 },
    { header: "VERSION", field: "version", width: 10 },
    {
      header: "STATUS",
      field: "status",
      width: 12,
      color: (v) => STATUS_COLORS[String(v).split(":")[0]!],
    },
    { header: "SOURCE", field: "source", width: 9 },
    { header: "ENABLED", field: "enabled", width: 8 },
    { header: "UPDATE", field: "update", width: 10 },
    { header: "NAME", field: "name", width: 30 },
  ],
};

function row(p: PluginInstalled): PluginRow {
  return {
    id: p.id,
    version: p.version,
    status: p.error ? `${p.status}: ${p.error}` : p.status,
    source: p.source,
    enabled: p.enabled ? "yes" : "no",
    update: p.updateAvailable ?? "-",
    name: p.name,
  };
}

function one(p: PluginInstalled | null): ListResult<PluginRow> {
  return { type: "list", data: p ? [row(p)] : [], schema: pluginSchema };
}

export async function runListCommand(
  options: CommandOptions,
  _command: Command,
): Promise<ListResult<PluginRow>> {
  return withPlugins(options, async (client) => {
    await client.pluginsGetCatalog().catch(() => undefined); // warms update info
    const { plugins } = await client.pluginsList();
    return { type: "list", data: plugins.map(row), schema: pluginSchema };
  });
}

async function consent(
  what: string,
  capabilities: readonly string[],
  yes: boolean | undefined,
): Promise<void> {
  if (yes) return;
  const list = capabilities.length ? capabilities.join(", ") : "none";
  if (!process.stdin.isTTY) {
    throw {
      code: "CONSENT_REQUIRED",
      message: `${what} requests capabilities: ${list}. Re-run with --yes to grant them.`,
    };
  }
  const ok = await confirm({
    message: `${what} requests capabilities: ${list}. Grant and continue?`,
  });
  if (isCancel(ok) || !ok) throw { code: "CANCELLED", message: "Cancelled" };
}

const TIER_ORDER: Record<string, number> = { brand: 0, official: 1, user: 2 };

export async function runInstallCommand(
  id: string,
  options: CommandOptions & { version?: string; repo?: string; yes?: boolean },
  _command: Command,
): Promise<ListResult<PluginRow>> {
  return withPlugins(options, async (client) => {
    const { plugins } = await client.pluginsGetCatalog({ refresh: true });
    const matches = plugins
      .filter((p) => p.id === id && (!options.repo || p.repoUrl === options.repo))
      .sort((a, b) => (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9));
    const entry = matches[0];
    if (!entry)
      throw {
        code: "NOT_FOUND",
        message: `${id} is not in any configured repository${options.repo ? ` (${options.repo})` : ""}`,
      };
    const version = options.version
      ? entry.versions.find((v) => v.version === options.version)
      : entry.latest;
    const capabilities = version?.capabilities ?? entry.latest?.capabilities ?? [];
    await consent(
      `${id}${version ? ` ${version.version}` : ""} from ${entry.repoName} (${entry.tier})`,
      capabilities,
      options.yes,
    );
    const { plugin } = await client.pluginsInstall({
      id,
      ...(options.version ? { version: options.version } : {}),
      repoUrl: entry.repoUrl,
      grantedCapabilities: [...capabilities],
    });
    return one(plugin);
  });
}

export async function runUninstallCommand(
  id: string,
  options: CommandOptions,
  _command: Command,
): Promise<ListResult<FieldRow>> {
  return withPlugins(options, async (client) => {
    await client.pluginsUninstall(id);
    return fields({ uninstalled: id });
  });
}

export function makeSetEnabledCommand(enabled: boolean) {
  return async (
    id: string,
    options: CommandOptions,
    _command: Command,
  ): Promise<ListResult<PluginRow>> =>
    withPlugins(options, async (client) =>
      one((await client.pluginsSetEnabled(id, enabled)).plugin),
    );
}

export async function runUpdateCommand(
  id: string | undefined,
  options: CommandOptions & { version?: string; yes?: boolean; all?: boolean },
  _command: Command,
): Promise<ListResult<PluginRow>> {
  return withPlugins(options, async (client) => {
    await client.pluginsGetCatalog({ refresh: true }).catch(() => undefined);
    const { plugins } = await client.pluginsList();
    const withUpdates = plugins.filter((p) => p.updateAvailable);
    let targets = options.all ? withUpdates : [];
    if (id) targets = plugins.filter((p) => p.id === id);
    if (id && targets.length === 0) throw { code: "NOT_FOUND", message: `${id} is not installed` };
    if (!id && !options.all)
      return {
        type: "list",
        data: plugins.filter((p) => p.updateAvailable).map(row),
        schema: pluginSchema,
      };
    const out: PluginRow[] = [];
    for (const target of targets) {
      const req = { id: target.id, ...(options.version ? { version: options.version } : {}) };
      try {
        const { plugin } = await client.pluginsUpdate(req);
        if (plugin) out.push(row(plugin));
      } catch (err) {
        const pe = asPluginError(err);
        if (pe?.code !== "consent_required") throw err;
        await consent(`${target.id} update`, pe.capabilities ?? [], options.yes);
        const { plugin } = await client.pluginsUpdate({
          ...req,
          grantedCapabilities: pe.capabilities ?? [],
        });
        if (plugin) out.push(row(plugin));
      }
    }
    return { type: "list", data: out, schema: pluginSchema };
  });
}

interface RepoRow {
  url: string;
  name: string;
  tier: string;
  plugins: string;
  publicKey: string;
  error: string;
}

const repoSchema: OutputSchema<RepoRow> = {
  idField: "url",
  columns: [
    { header: "URL", field: "url", width: 50 },
    { header: "NAME", field: "name", width: 20 },
    { header: "TIER", field: "tier", width: 9 },
    { header: "PLUGINS", field: "plugins", width: 8 },
    { header: "PUBLIC KEY", field: "publicKey", width: 46 },
    { header: "ERROR", field: "error", width: 30 },
  ],
};

function repoRow(r: PluginRepo): RepoRow {
  return {
    url: r.url,
    name: r.name,
    tier: r.tier,
    plugins: r.pluginCount === null ? "-" : String(r.pluginCount),
    publicKey: r.publicKey,
    error: r.error ?? "",
  };
}

export async function runReposListCommand(
  options: CommandOptions,
  _command: Command,
): Promise<ListResult<RepoRow>> {
  return withPlugins(options, async (client) => {
    const { repos } = await client.pluginsGetCatalog({ refresh: true });
    return { type: "list", data: repos.map(repoRow), schema: repoSchema };
  });
}

export async function runReposAddCommand(
  url: string,
  options: CommandOptions & { publicKey?: string; name?: string },
  _command: Command,
): Promise<ListResult<RepoRow>> {
  return withPlugins(options, async (client) => {
    const { repo } = await client.pluginsReposAdd({
      url,
      ...(options.publicKey ? { publicKey: options.publicKey } : {}),
      ...(options.name ? { name: options.name } : {}),
    });
    return { type: "list", data: repo ? [repoRow(repo)] : [], schema: repoSchema };
  });
}

export async function runReposRemoveCommand(
  url: string,
  options: CommandOptions,
  _command: Command,
): Promise<ListResult<FieldRow>> {
  return withPlugins(options, async (client) => {
    await client.pluginsReposRemove(url);
    return fields({ removed: url });
  });
}

export async function runLinkCommand(
  dir: string,
  options: CommandOptions,
  _command: Command,
): Promise<ListResult<PluginRow>> {
  return withPlugins(options, async (client) =>
    one((await client.pluginsDevLink(path.resolve(dir))).plugin),
  );
}

export async function runUnlinkCommand(
  id: string,
  options: CommandOptions,
  _command: Command,
): Promise<ListResult<FieldRow>> {
  return withPlugins(options, async (client) => {
    await client.pluginsDevUnlink(id);
    return fields({ unlinked: id });
  });
}

export async function runDevModeCommand(
  state: string | undefined,
  options: CommandOptions,
  _command: Command,
): Promise<ListResult<FieldRow>> {
  return withPlugins(options, async (client) => {
    let policy;
    if (state === undefined) policy = (await client.pluginsList()).policy;
    else if (state === "on" || state === "off")
      policy = (await client.pluginsDevSetEnabled(state === "on")).policy;
    else throw { code: "INVALID_ARGUMENT", message: "Expected on or off" };
    return fields({
      developerMode: policy.developerModeEnabled ? "on" : "off",
      brand: policy.developerMode,
    });
  });
}
