/**
 * Latest-version lookups against the npm registry.
 *
 * Only the packument's `dist-tags` document is requested (via the abbreviated
 * accept header) so the response stays small even for packages with thousands
 * of published versions.
 */

const NPM_REGISTRY_BASE = "https://registry.npmjs.org";
const REGISTRY_TIMEOUT_MS = 15_000;
const NPM_ABBREVIATED_ACCEPT = "application/vnd.npm.install-v1+json";

export type RegistryFetch = typeof fetch;

export interface LatestVersionResult {
  version: string | null;
  error?: string;
}

export async function fetchLatestNpmVersion(
  packageName: string,
  options: { fetch?: RegistryFetch; signal?: AbortSignal } = {},
): Promise<LatestVersionResult> {
  const doFetch = options.fetch ?? fetch;
  const timeout = AbortSignal.timeout(REGISTRY_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const response = await doFetch(`${NPM_REGISTRY_BASE}/${encodeURIComponent(packageName)}`, {
      headers: { accept: NPM_ABBREVIATED_ACCEPT },
      signal,
    });
    if (!response.ok) {
      return { version: null, error: `Registry responded ${response.status}` };
    }
    const body = (await response.json()) as { "dist-tags"?: Record<string, string> };
    const latest = body["dist-tags"]?.["latest"];
    return latest ? { version: latest } : { version: null, error: "No latest dist-tag" };
  } catch (error) {
    return { version: null, error: error instanceof Error ? error.message : String(error) };
  }
}
