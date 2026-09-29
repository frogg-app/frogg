import { z } from "zod";
import {
  PluginCapabilitySchema,
  PluginIdSchema,
  PluginScopeSchema,
  PluginVersionSchema,
} from "./manifest.js";

/**
 * Repository index (`index.json`), served with a detached ed25519 signature
 * (`index.json.sig`, base64 over the exact bytes of index.json) and, for TOFU on
 * user repos, the repo's public key (`index.json.pub`, base64 raw 32 bytes).
 */

export const PLUGIN_INDEX_SCHEMA_VERSION = 1;
export const PLUGIN_INDEX_SIGNATURE_SUFFIX = ".sig";
export const PLUGIN_INDEX_PUBLIC_KEY_SUFFIX = ".pub";

export const PLUGIN_REPO_TIERS = ["official", "brand", "user"] as const;
export const PluginRepoTierSchema = z.enum(PLUGIN_REPO_TIERS);
export type PluginRepoTier = z.infer<typeof PluginRepoTierSchema>;

export const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
/** base64 of a raw 32-byte ed25519 public key. */
export const Ed25519PublicKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9+/]{43}=$/, "expected base64 of a raw 32-byte ed25519 public key");

export const PluginIndexVersionSchema = z.object({
  version: PluginVersionSchema,
  apiVersion: z.number().int().positive(),
  scope: PluginScopeSchema,
  capabilities: z.array(PluginCapabilitySchema),
  tarball: z.string().url(),
  sha256: Sha256HexSchema,
  commit: z.string().optional(),
  /** Optional display metadata copied from the manifest at index build time. */
  name: z.string().optional(),
  description: z.string().optional(),
  author: z.string().optional(),
  homepage: z.string().optional(),
  publishedAt: z.string().optional(),
});
export type PluginIndexVersion = z.infer<typeof PluginIndexVersionSchema>;

export const PluginIndexEntrySchema = z.object({
  id: PluginIdSchema,
  category: z.string().max(64).optional(),
  versions: z.array(PluginIndexVersionSchema).min(1),
});
export type PluginIndexEntry = z.infer<typeof PluginIndexEntrySchema>;

export const PluginIndexSchema = z
  .object({
    schemaVersion: z.literal(PLUGIN_INDEX_SCHEMA_VERSION),
    name: z.string().min(1).max(120),
    generatedAt: z.string(),
    plugins: z.array(PluginIndexEntrySchema),
  })
  .superRefine((idx, ctx) => {
    const ids = new Set<string>();
    idx.plugins.forEach((p, i) => {
      if (ids.has(p.id))
        ctx.addIssue({
          code: "custom",
          path: ["plugins", i, "id"],
          message: `duplicate plugin ${p.id}`,
        });
      ids.add(p.id);
      const vs = new Set<string>();
      p.versions.forEach((v, j) => {
        if (vs.has(v.version)) {
          ctx.addIssue({
            code: "custom",
            path: ["plugins", i, "versions", j],
            message: `duplicate version ${v.version}`,
          });
        }
        vs.add(v.version);
      });
    });
  });
export type PluginIndex = z.infer<typeof PluginIndexSchema>;

// ---------------------------------------------------------------------------
// Minimal semver helpers (no dependency). Enough for index ordering and the
// brand `preinstalled` ranges: exact, `^x`, `^x.y`, `^x.y.z`, `~x.y`, `*`, `latest`.

interface Parsed {
  major: number;
  minor: number;
  patch: number;
  pre: string | null;
}

export function parsePluginVersion(v: string): Parsed | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v);
  if (!m) return null;
  return { major: +m[1]!, minor: +m[2]!, patch: +m[3]!, pre: m[4] ?? null };
}

export function comparePluginVersions(a: string, b: string): number {
  const pa = parsePluginVersion(a);
  const pb = parsePluginVersion(b);
  if (!pa || !pb) return a.localeCompare(b);
  for (const k of ["major", "minor", "patch"] as const) {
    if (pa[k] !== pb[k]) return pa[k] - pb[k];
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return pa.pre.localeCompare(pb.pre, undefined, { numeric: true });
}

function isWildcardRange(r: string): boolean {
  return r === "" || r === "*" || r === "latest";
}

/** Upper-bound check once `version` is known to be >= the range floor. */
function withinRangeCeiling(v: Parsed, op: string, nums: number[]): boolean {
  const [maj, min = 0] = nums as [number, number?];
  const sameMinor = nums.length < 2 || v.minor === min;
  if (op !== "^") return v.major === maj && sameMinor;
  if (maj > 0) return v.major === maj;
  return v.major === 0 && (nums.length >= 2 ? v.minor === min : true);
}

export function pluginVersionSatisfies(version: string, range: string | undefined): boolean {
  const r = (range ?? "*").trim();
  const v = parsePluginVersion(version);
  if (!v) return false;
  if (isWildcardRange(r)) return v.pre === null;
  const op = r.startsWith("^") || r.startsWith("~") ? r[0]! : "";
  const body = r.slice(op.length);
  const parts = body.split(".");
  if (op === "" && parts.length === 3) return version === body;
  const nums = parts.map((p) => Number(p));
  if (v.pre !== null || nums.some((n) => !Number.isInteger(n) || n < 0)) return false;
  const floor = [0, 1, 2].map((i) => nums[i] ?? 0).join(".");
  if (comparePluginVersions(version, floor) < 0) return false;
  return withinRangeCeiling(v, op, nums);
}

/** Highest version in `versions` satisfying `range` (and a supported apiVersion if given). */
export function pickPluginVersion<T extends { version: string; apiVersion?: number }>(
  versions: readonly T[],
  range?: string,
  isApiSupported?: (apiVersion: number) => boolean,
): T | null {
  const ok = versions.filter(
    (v) =>
      pluginVersionSatisfies(v.version, range) &&
      (!isApiSupported || v.apiVersion === undefined || isApiSupported(v.apiVersion)),
  );
  ok.sort((a, b) => comparePluginVersions(b.version, a.version));
  return ok[0] ?? null;
}

/** Glob match for brand allow/deny lists: `*` matches any run of characters. */
export function pluginIdMatchesGlob(id: string, glob: string): boolean {
  const re = new RegExp(
    "^" +
      glob
        .split("*")
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*") +
      "$",
  );
  return re.test(id);
}

/** Brand allow/deny: deny wins; an empty or absent allow list allows everything. */
export function isPluginIdAllowed(
  id: string,
  policy: { allow?: readonly string[]; deny?: readonly string[] },
): boolean {
  if (policy.deny?.some((g) => pluginIdMatchesGlob(id, g))) return false;
  if (!policy.allow || policy.allow.length === 0) return true;
  return policy.allow.some((g) => pluginIdMatchesGlob(id, g));
}

/** Frogg's official repository (frogg-app/frogg-plugins). Only the public key is compiled in. */
export const OFFICIAL_PLUGIN_REPO = {
  name: "Frogg plugins",
  url: "https://frogg-app.github.io/frogg-plugins/index.json",
  publicKey: "6NkzNDGG54fvBJE/dDlQGmPD2ZZRiA9bKo6alMU+2H4=",
} as const;
