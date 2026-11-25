import type { MutableDaemonConfigPatch } from "@frogg/protocol/messages";

/**
 * Providers the host doesn't build in but can run over ACP once they're added to its
 * config.json (`providers.<id>` with `extends: "acp"`). Mirrors the classic app's catalog
 * entries so a host set up from either app writes the same config.
 */
export interface CatalogProvider {
  id: string;
  title: string;
  description: string;
  command: readonly [string, ...string[]];
  env?: Readonly<Record<string, string>>;
}

export const PROVIDER_CATALOG: readonly CatalogProvider[] = [
  {
    id: "gemini",
    title: "Gemini CLI",
    description: "Google's official CLI for Gemini",
    command: ["npx", "-y", "@google/gemini-cli@0.52.0", "--acp"],
  },
];

/** Catalog providers the host doesn't list yet, so they can be offered for adding. */
export function addableProviders(installed: readonly string[]): CatalogProvider[] {
  const have = new Set(installed);
  return PROVIDER_CATALOG.filter((p) => !have.has(p.id));
}

/** The config patch that installs a catalog provider, switched on. */
export function catalogProviderPatch(entry: CatalogProvider): MutableDaemonConfigPatch {
  return {
    providers: {
      [entry.id]: {
        extends: "acp",
        label: entry.title,
        description: entry.description,
        command: [...entry.command],
        env: entry.env ? { ...entry.env } : {},
        enabled: true,
      },
    },
  };
}
