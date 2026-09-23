import type { Command } from "commander";
import type { CommandOptions, OutputSchema, SingleResult } from "../../output/index.js";
import { connectToDaemon } from "../../utils/client.js";

export interface ProviderUpdateSettingsResult {
  checkEnabled: boolean;
  autoUpdate: boolean;
  checkIntervalMinutes: number;
  ignoredProviders: string;
}

export const providerUpdateSettingsSchema: OutputSchema<ProviderUpdateSettingsResult> = {
  idField: "checkEnabled",
  columns: [
    { header: "CHECK", field: "checkEnabled", width: 8 },
    { header: "AUTO-UPDATE", field: "autoUpdate", width: 13 },
    { header: "INTERVAL (MIN)", field: "checkIntervalMinutes", width: 15 },
    { header: "IGNORED", field: "ignoredProviders", width: 30 },
  ],
};

export interface ProviderUpdateSettingsOptions extends CommandOptions {
  host?: string;
  autoUpdate?: string;
  checkEnabled?: string;
  interval?: string;
  ignore?: string;
}

function parseBoolean(value: string | undefined, flag: string): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "on", "1"].includes(normalized)) return true;
  if (["false", "no", "off", "0"].includes(normalized)) return false;
  throw new Error(`${flag} expects true or false, got "${value}"`);
}

export async function runUpdateSettingsCommand(
  options: ProviderUpdateSettingsOptions,
  _command: Command,
): Promise<SingleResult<ProviderUpdateSettingsResult>> {
  const autoUpdate = parseBoolean(options.autoUpdate, "--auto-update");
  const checkEnabled = parseBoolean(options.checkEnabled, "--check-enabled");
  const checkIntervalMinutes =
    options.interval === undefined ? undefined : Number.parseInt(options.interval, 10);
  if (checkIntervalMinutes !== undefined && !Number.isFinite(checkIntervalMinutes)) {
    throw new Error(`--interval expects a number of minutes, got "${options.interval}"`);
  }
  const ignoredProviders =
    options.ignore === undefined
      ? undefined
      : options.ignore
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);

  const client = await connectToDaemon({ host: options.host });
  try {
    const hasChange =
      autoUpdate !== undefined ||
      checkEnabled !== undefined ||
      checkIntervalMinutes !== undefined ||
      ignoredProviders !== undefined;

    const payload = hasChange
      ? await client.setProviderUpdatePreferences({
          ...(autoUpdate !== undefined ? { autoUpdate } : {}),
          ...(checkEnabled !== undefined ? { checkEnabled } : {}),
          ...(checkIntervalMinutes !== undefined ? { checkIntervalMinutes } : {}),
          ...(ignoredProviders !== undefined ? { ignoredProviders } : {}),
        })
      : await client.checkProviderUpdates();

    return {
      type: "single",
      data: {
        checkEnabled: payload.preferences.checkEnabled,
        autoUpdate: payload.preferences.autoUpdate,
        checkIntervalMinutes: payload.preferences.checkIntervalMinutes,
        ignoredProviders: payload.preferences.ignoredProviders.join(", ") || "-",
      },
      schema: providerUpdateSettingsSchema,
    };
  } finally {
    await client.close().catch(() => {});
  }
}
