import type { Brand } from "./schema.js";

export type ProviderPolicy = Brand["providers"];

function matchesPattern(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

/** Whether this build may run `providerId` at all. */
export function isProviderAllowed(policy: ProviderPolicy, providerId: string): boolean {
  return policy.allowed === null || policy.allowed.includes(providerId);
}

/**
 * Whether `modelId` may be listed or selected under each of `providerIds` — the
 * provider itself and, for a derived profile, the provider it extends. A model
 * passes a policy when it matches an `allow` pattern (or `allow` is empty) and
 * no `deny` pattern.
 */
export function isModelAllowed(
  policy: ProviderPolicy,
  providerIds: Iterable<string>,
  modelId: string,
): boolean {
  for (const providerId of providerIds) {
    const models = policy.models[providerId];
    if (!models) continue;
    if (models.allow.length > 0 && !models.allow.some((p) => matchesPattern(p, modelId))) {
      return false;
    }
    if (models.deny.some((p) => matchesPattern(p, modelId))) return false;
  }
  return true;
}
