// Daemon versions a host can install: the release list the daemon's self-update reads
// (GitHub releases of the brand's repository), filtered to its channel.
import type { DaemonUpdateChannel } from "@frogg/protocol/messages";
import { useEffect, useState } from "react";

const REPOSITORY = process.env.EXPO_PUBLIC_FROGG_RELEASE_REPO?.trim() || "frogg-app/frogg";
/** The brand's daemon bundle names (packages/branding artifact-contract daemonArtifactName). */
const PREFIXES = {
  brand: process.env.EXPO_PUBLIC_FROGG_BRAND_ARTIFACT_PREFIX?.trim() || "frogg",
  daemon: process.env.EXPO_PUBLIC_FROGG_DAEMON_ARTIFACT_PREFIX?.trim() || "frogg-daemon",
};

/**
 * Whether a release asset is this brand's daemon bundle for `version`: `frogg-1.6.11-linux-x86_64-
 * daemon.tar.gz`, or the older `frogg-daemon-0.2.15-linux-x64.tar.gz`. Another identity's bundle
 * (the retired `frogg-beta-daemon-…`) is not one this daemon can install.
 */
export function isDaemonBundle(name: string, version: string, prefixes = PREFIXES): boolean {
  const bundle = /\.(zip|tar\.gz)$/.test(name);
  return (
    bundle &&
    (name.startsWith(`${prefixes.daemon}-${version}-`) ||
      (name.startsWith(`${prefixes.brand}-${version}-`) && /-daemon\.(zip|tar\.gz)$/.test(name)))
  );
}

export interface Release {
  tag_name: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  assets?: Array<{ name: string }>;
}

export interface DaemonVersion {
  version: string;
  prerelease: boolean;
  publishedAt: string | null;
}

/**
 * Installable daemon versions, newest first: releases that ship this brand's daemon. Stable lists
 * stable releases only; beta lists both, as the daemon's beta channel follows the newest of
 * either. Drafts never.
 */
export function daemonVersions(
  releases: readonly Release[],
  channel: DaemonUpdateChannel,
  prefixes = PREFIXES,
): DaemonVersion[] {
  return releases
    .filter((r) => !r.draft && (channel === "beta" || !r.prerelease))
    .map((r) => ({
      version: r.tag_name.replace(/^v/, ""),
      prerelease: r.prerelease === true,
      publishedAt: r.published_at ?? null,
      assets: r.assets ?? [],
    }))
    .filter(
      (v) =>
        /^\d+\.\d+\.\d+/.test(v.version) &&
        v.assets.some((a) => isDaemonBundle(a.name, v.version, prefixes)),
    )
    .map(({ assets: _assets, ...v }) => v)
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** Semver order, a prerelease below its release; numeric prerelease parts compare as numbers. */
export function compareVersions(a: string, b: string): number {
  const [ma = "", pa] = a.split("-", 2);
  const [mb = "", pb] = b.split("-", 2);
  const na = ma.split(".").map(Number);
  const nb = mb.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const d = (na[i] ?? 0) - (nb[i] ?? 0);
    if (d) return d;
  }
  if (pa === pb) return 0;
  if (pa === undefined) return 1;
  if (pb === undefined) return -1;
  const xa = pa.split(".");
  const xb = pb.split(".");
  for (let i = 0; i < Math.max(xa.length, xb.length); i += 1) {
    const sa = xa[i];
    const sb = xb[i];
    if (sa === undefined) return -1;
    if (sb === undefined) return 1;
    const both = /^\d+$/.test(sa) && /^\d+$/.test(sb);
    const d = both ? Number(sa) - Number(sb) : sa.localeCompare(sb);
    if (d) return d;
  }
  return 0;
}

let cache: Promise<Release[]> | null = null;

/** The repository's recent releases, fetched once per app run (a failure is retried). */
export function fetchReleases(): Promise<Release[]> {
  cache ??= fetch(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=50`, {
    headers: { Accept: "application/vnd.github+json" },
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`GitHub releases answered HTTP ${res.status}`);
      const body: unknown = await res.json();
      return Array.isArray(body) ? (body as Release[]) : [];
    })
    .catch((e: unknown) => {
      cache = null;
      throw e;
    });
  return cache;
}

/** Where the version picker reads releases; the component lab swaps in fixtures. */
export const releaseSource: { load: () => Promise<Release[]> } = { load: fetchReleases };

/** The releases for the version picker; an error leaves typing a version as the way in. */
export function useReleases(load: () => Promise<Release[]> = releaseSource.load): {
  releases: Release[] | null;
  error: string | null;
} {
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    load()
      .then((r) => {
        if (live) setReleases(r);
        return undefined;
      })
      .catch((e: unknown) => {
        if (!live) return;
        setReleases([]);
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [load]);
  return { releases, error };
}
