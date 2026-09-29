import type { PluginContributionSet } from "@frogg/client/internal/daemon-client";

export type PluginSettingField = PluginContributionSet["settings"][number];
export type FieldValues = Record<string, unknown>;

/** Initial form state: stored value, else the declared default. */
export function initialFieldValues(
  fields: readonly PluginSettingField[],
  values: FieldValues | undefined,
): FieldValues {
  const result: FieldValues = {};
  for (const field of fields) {
    const stored = values?.[field.key];
    result[field.key] = stored === undefined ? (field.default ?? null) : stored;
  }
  return result;
}

/** Only the keys the user changed; number fields are parsed, blank numbers clear the key. */
export function changedFieldValues(
  fields: readonly PluginSettingField[],
  initial: FieldValues,
  current: FieldValues,
): FieldValues {
  const out: FieldValues = {};
  for (const field of fields) {
    const next = current[field.key];
    if (Object.is(next, initial[field.key])) continue;
    if (field.type === "number" && typeof next === "string") {
      const parsed = Number(next);
      out[field.key] = next.trim() === "" || Number.isNaN(parsed) ? null : parsed;
      continue;
    }
    out[field.key] = next;
  }
  return out;
}
