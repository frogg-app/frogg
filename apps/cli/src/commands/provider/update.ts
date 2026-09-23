import type { Command } from "commander";
import type { CommandOptions, ListResult, OutputSchema } from "../../output/index.js";
import { connectToDaemon } from "../../utils/client.js";

export interface ProviderUpdateItem {
  provider: string;
  status: string;
  installed: string;
  latest: string;
  package: string;
  note: string;
}

export const providerUpdateSchema: OutputSchema<ProviderUpdateItem> = {
  idField: "provider",
  columns: [
    { header: "PROVIDER", field: "provider", width: 12 },
    {
      header: "STATUS",
      field: "status",
      width: 18,
      color: (value) => {
        if (value === "up-to-date") return "green";
        if (value === "update-available") return "yellow";
        if (value === "not-installed") return "red";
        return undefined;
      },
    },
    { header: "INSTALLED", field: "installed", width: 14 },
    { header: "LATEST", field: "latest", width: 14 },
    { header: "PACKAGE", field: "package", width: 26 },
    { header: "NOTE", field: "note", width: 40 },
  ],
};

export interface ProviderUpdateOptions extends CommandOptions {
  host?: string;
  check?: boolean;
  all?: boolean;
}

// Installing a provider CLI runs a full package install, which is far slower
// than any other daemon round trip.
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

export async function runUpdateCommand(
  provider: string | undefined,
  options: ProviderUpdateOptions,
  _command: Command,
): Promise<ListResult<ProviderUpdateItem>> {
  const client = await connectToDaemon({ host: options.host });
  try {
    const snapshot = await client.checkProviderUpdates({ forceRefresh: true });

    if (options.check || (!provider && !options.all)) {
      return { type: "list", data: snapshot.entries.map(toItem), schema: providerUpdateSchema };
    }

    const targets = provider
      ? snapshot.entries.filter((entry) => entry.provider === provider)
      : snapshot.entries.filter((entry) => entry.status === "update-available" && entry.updatable);

    if (provider && targets.length === 0) {
      throw new Error(`Unknown provider: ${provider}`);
    }

    const results: ProviderUpdateItem[] = [];
    for (const target of targets) {
      const result = await client.installProviderUpdate({
        provider: target.provider,
        timeout: INSTALL_TIMEOUT_MS,
      });
      let status = "up-to-date";
      if (result.error) {
        status = "failed";
      } else if (result.updated) {
        status = "updated";
      }
      results.push({
        provider: result.provider,
        status,
        installed: result.installedVersion ?? "-",
        latest: target.latestVersion ?? "-",
        package: target.packageName ?? "-",
        note: result.error ?? (result.updated ? `was ${result.previousVersion ?? "absent"}` : ""),
      });
    }

    return { type: "list", data: results, schema: providerUpdateSchema };
  } finally {
    await client.close().catch(() => {});
  }
}

function toItem(entry: {
  provider: string;
  status: string;
  installedVersion: string | null;
  latestVersion: string | null;
  packageName: string | null;
  manualInstallUrl: string | null;
  error: string | null;
}): ProviderUpdateItem {
  return {
    provider: entry.provider,
    status: entry.status,
    installed: entry.installedVersion ?? "-",
    latest: entry.latestVersion ?? "-",
    package: entry.packageName ?? "-",
    note: entry.error ?? (entry.status === "unmanaged" ? (entry.manualInstallUrl ?? "") : ""),
  };
}
