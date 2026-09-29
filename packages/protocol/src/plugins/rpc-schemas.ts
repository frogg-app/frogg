import { z } from "zod";
import {
  PluginCommandContributionSchema,
  PluginPanelContributionSchema,
  PluginSessionActionContributionSchema,
  PluginSettingFieldSchema,
} from "./manifest.js";

/**
 * Session RPCs for the plugin system, gated on `server_info.features.plugins`.
 * Contract summary lives at the bottom of docs/plans/plugins.md.
 *
 * Enum-like fields (status, source, tier, capability, scope) are open strings on the
 * wire so a newer daemon can report values an older client does not know. Known
 * values are the exported constants in ./manifest.ts and ./repo-index.ts plus the
 * PLUGIN_STATUSES / PLUGIN_SOURCES lists below.
 */

/** active: loaded and running. disabled: turned off by the user. error: failed to load/activate.
 * incompatible: unsupported apiVersion. blocked: denied by brand policy. inactive: nothing to
 * run on the daemon (client/build scope). */
export const PLUGIN_STATUSES = [
  "active",
  "disabled",
  "error",
  "incompatible",
  "blocked",
  "inactive",
] as const;
/** Where an installed plugin came from. `dev` = linked local folder. */
export const PLUGIN_SOURCES = ["official", "brand", "user", "dev"] as const;

export const PluginErrorSchema = z.object({
  /** Known codes: not_found, invalid_request, forbidden, consent_required, signature_invalid,
   * hash_mismatch, manifest_mismatch, fetch_failed, incompatible, already_installed,
   * plugin_error, not_active, timeout, internal. */
  code: z.string(),
  message: z.string(),
  /** consent_required: capabilities the update adds that were not granted. */
  capabilities: z.array(z.string()).optional(),
});
export type PluginError = z.infer<typeof PluginErrorSchema>;

export const PluginInstalledSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  apiVersion: z.number(),
  scope: z.string(),
  description: z.string().nullable(),
  author: z.string().nullable(),
  homepage: z.string().nullable(),
  source: z.string(),
  /** Repo URL for repo installs; null for dev links. */
  repoUrl: z.string().nullable(),
  /** Absolute folder for dev links; null otherwise. */
  devPath: z.string().nullable(),
  enabled: z.boolean(),
  status: z.string(),
  error: z.string().nullable(),
  capabilities: z.array(z.string()),
  grantedCapabilities: z.array(z.string()),
  /** Newest compatible version in its repo, when newer than `version`. */
  updateAvailable: z.string().nullable(),
  /** Installed by brand `preinstalled`; cannot be uninstalled. */
  preinstalled: z.boolean(),
  installedAt: z.string().nullable(),
});
export type PluginInstalled = z.infer<typeof PluginInstalledSchema>;

export const PluginPolicySchema = z.object({
  /** Brand `plugins.enabled`. When false every plugin RPC fails with forbidden. */
  enabled: z.boolean(),
  allowUserRepos: z.boolean(),
  /** "allowed" | "forbidden" */
  developerMode: z.string(),
  /** The host's developer-mode setting (only meaningful when allowed). */
  developerModeEnabled: z.boolean(),
  apiVersions: z.array(z.number()),
});
export type PluginPolicy = z.infer<typeof PluginPolicySchema>;

export const PluginRepoSchema = z.object({
  url: z.string(),
  name: z.string(),
  /** "official" | "brand" | "user" */
  tier: z.string(),
  publicKey: z.string(),
  removable: z.boolean(),
  pluginCount: z.number().nullable(),
  lastFetchedAt: z.string().nullable(),
  error: z.string().nullable(),
});
export type PluginRepo = z.infer<typeof PluginRepoSchema>;

export const PluginCatalogVersionSchema = z.object({
  version: z.string(),
  apiVersion: z.number(),
  scope: z.string(),
  capabilities: z.array(z.string()),
  compatible: z.boolean(),
  publishedAt: z.string().nullable(),
  /** Tarball URL and sha256, so a client can fetch and verify a client/hybrid half itself. */
  tarball: z.string().optional(),
  sha256: z.string().optional(),
});

export const PluginCatalogEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  author: z.string().nullable(),
  homepage: z.string().nullable(),
  category: z.string().nullable(),
  repoUrl: z.string(),
  repoName: z.string(),
  tier: z.string(),
  /** Newest compatible version, or null if none is compatible. */
  latest: PluginCatalogVersionSchema.nullable(),
  versions: z.array(PluginCatalogVersionSchema),
  installedVersion: z.string().nullable(),
});
export type PluginCatalogEntry = z.infer<typeof PluginCatalogEntrySchema>;

export const PluginContributionSetSchema = z.object({
  pluginId: z.string(),
  pluginName: z.string(),
  dev: z.boolean(),
  commands: z.array(PluginCommandContributionSchema),
  sessionActions: z.array(PluginSessionActionContributionSchema),
  panels: z.array(PluginPanelContributionSchema),
  settings: z.array(PluginSettingFieldSchema),
  /** ctx.ui.setBadge values keyed by contribution id (panel/command/sessionAction). */
  badges: z.record(z.string(), z.string()),
});
export type PluginContributionSet = z.infer<typeof PluginContributionSetSchema>;

const req = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.object({ type: z.literal(type), requestId: z.string(), ...shape });
const res = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.object({
    type: z.literal(type),
    payload: z.object({ requestId: z.string(), error: PluginErrorSchema.nullable(), ...shape }),
  });

// --- Requests ---------------------------------------------------------------

export const PluginsListRequestSchema = req("plugins.list.request", {});
export const PluginsReposListRequestSchema = req("plugins.repos.list.request", {});
export const PluginsReposAddRequestSchema = req("plugins.repos.add.request", {
  url: z.string(),
  /** Omit to trust-on-first-use the key served at `<url>.pub`; the pinned key is returned. */
  publicKey: z.string().optional(),
  name: z.string().optional(),
});
export const PluginsReposRemoveRequestSchema = req("plugins.repos.remove.request", {
  url: z.string(),
});
export const PluginsGetCatalogRequestSchema = req("plugins.get_catalog.request", {
  /** Bypass the index cache. */
  refresh: z.boolean().optional(),
});
export const PluginsInstallRequestSchema = req("plugins.install.request", {
  id: z.string(),
  /** Exact version or range; omit for newest compatible. */
  version: z.string().optional(),
  repoUrl: z.string(),
  /** Must include every capability the version requests. */
  grantedCapabilities: z.array(z.string()),
});
export const PluginsUninstallRequestSchema = req("plugins.uninstall.request", { id: z.string() });
export const PluginsSetEnabledRequestSchema = req("plugins.set_enabled.request", {
  id: z.string(),
  enabled: z.boolean(),
});
export const PluginsUpdateRequestSchema = req("plugins.update.request", {
  id: z.string(),
  version: z.string().optional(),
  /** Required when the update adds capabilities; else fails with consent_required. */
  grantedCapabilities: z.array(z.string()).optional(),
});
export const PluginsDevLinkRequestSchema = req("plugins.dev.link.request", { path: z.string() });
export const PluginsDevUnlinkRequestSchema = req("plugins.dev.unlink.request", { id: z.string() });
export const PluginsDevSetEnabledRequestSchema = req("plugins.dev.set_enabled.request", {
  enabled: z.boolean(),
});
export const PluginsRpcCallRequestSchema = req("plugins.rpc.call.request", {
  pluginId: z.string(),
  method: z.string(),
  params: z.unknown().optional(),
});
export const PluginsGetContributionsRequestSchema = req("plugins.get_contributions.request", {});
export const PluginsSettingsGetRequestSchema = req("plugins.settings.get.request", {
  id: z.string(),
});
export const PluginsSettingsSetRequestSchema = req("plugins.settings.set.request", {
  id: z.string(),
  /** Keys to set; a null value deletes the key. */
  values: z.record(z.string(), z.unknown()),
});

// --- Responses --------------------------------------------------------------

export const PluginsListResponseSchema = res("plugins.list.response", {
  plugins: z.array(PluginInstalledSchema),
  policy: PluginPolicySchema,
});
export const PluginsReposListResponseSchema = res("plugins.repos.list.response", {
  repos: z.array(PluginRepoSchema),
});
export const PluginsReposAddResponseSchema = res("plugins.repos.add.response", {
  repo: PluginRepoSchema.nullable(),
});
export const PluginsReposRemoveResponseSchema = res("plugins.repos.remove.response", {
  success: z.boolean(),
});
export const PluginsGetCatalogResponseSchema = res("plugins.get_catalog.response", {
  plugins: z.array(PluginCatalogEntrySchema),
  /** Per-repo fetch/verify failures; other repos still contribute. */
  repos: z.array(PluginRepoSchema),
});
export const PluginsInstallResponseSchema = res("plugins.install.response", {
  plugin: PluginInstalledSchema.nullable(),
});
export const PluginsUninstallResponseSchema = res("plugins.uninstall.response", {
  success: z.boolean(),
});
export const PluginsSetEnabledResponseSchema = res("plugins.set_enabled.response", {
  plugin: PluginInstalledSchema.nullable(),
});
export const PluginsUpdateResponseSchema = res("plugins.update.response", {
  plugin: PluginInstalledSchema.nullable(),
});
export const PluginsDevLinkResponseSchema = res("plugins.dev.link.response", {
  plugin: PluginInstalledSchema.nullable(),
});
export const PluginsDevUnlinkResponseSchema = res("plugins.dev.unlink.response", {
  success: z.boolean(),
});
export const PluginsDevSetEnabledResponseSchema = res("plugins.dev.set_enabled.response", {
  policy: PluginPolicySchema,
});
export const PluginsRpcCallResponseSchema = res("plugins.rpc.call.response", {
  result: z.unknown().optional(),
});
export const PluginsGetContributionsResponseSchema = res("plugins.get_contributions.response", {
  contributions: z.array(PluginContributionSetSchema),
});
export const PluginsSettingsGetResponseSchema = res("plugins.settings.get.response", {
  fields: z.array(PluginSettingFieldSchema),
  /** Values for declared fields only. Secret fields come back as "" when set; unset keys are absent. */
  values: z.record(z.string(), z.unknown()),
});
export const PluginsSettingsSetResponseSchema = res("plugins.settings.set.response", {
  success: z.boolean(),
});

// --- Push events -------------------------------------------------------------

/** Installed set, enabled state, status, contributions or repos changed; clients refetch. */
export const PluginsChangedMessageSchema = z.object({
  type: z.literal("plugins.changed"),
  payload: z.object({
    /** Plugin that changed, or null for repo/policy changes. */
    pluginId: z.string().nullable(),
    /** Known: installed, uninstalled, enabled, disabled, updated, status, contributions, repos, policy, reloaded. */
    reason: z.string(),
  }),
});
/** ctx.ui.notify() from a plugin. */
export const PluginsNotifyMessageSchema = z.object({
  type: z.literal("plugins.notify"),
  payload: z.object({
    pluginId: z.string(),
    message: z.string(),
    /** "info" | "success" | "warning" | "error" */
    level: z.string(),
  }),
});

export type PluginsListRequest = z.infer<typeof PluginsListRequestSchema>;
export type PluginsReposListRequest = z.infer<typeof PluginsReposListRequestSchema>;
export type PluginsReposAddRequest = z.infer<typeof PluginsReposAddRequestSchema>;
export type PluginsReposRemoveRequest = z.infer<typeof PluginsReposRemoveRequestSchema>;
export type PluginsGetCatalogRequest = z.infer<typeof PluginsGetCatalogRequestSchema>;
export type PluginsInstallRequest = z.infer<typeof PluginsInstallRequestSchema>;
export type PluginsUninstallRequest = z.infer<typeof PluginsUninstallRequestSchema>;
export type PluginsSetEnabledRequest = z.infer<typeof PluginsSetEnabledRequestSchema>;
export type PluginsUpdateRequest = z.infer<typeof PluginsUpdateRequestSchema>;
export type PluginsDevLinkRequest = z.infer<typeof PluginsDevLinkRequestSchema>;
export type PluginsDevUnlinkRequest = z.infer<typeof PluginsDevUnlinkRequestSchema>;
export type PluginsDevSetEnabledRequest = z.infer<typeof PluginsDevSetEnabledRequestSchema>;
export type PluginsRpcCallRequest = z.infer<typeof PluginsRpcCallRequestSchema>;
export type PluginsGetContributionsRequest = z.infer<typeof PluginsGetContributionsRequestSchema>;
export type PluginsSettingsGetRequest = z.infer<typeof PluginsSettingsGetRequestSchema>;
export type PluginsSettingsSetRequest = z.infer<typeof PluginsSettingsSetRequestSchema>;

export type PluginsListResponse = z.infer<typeof PluginsListResponseSchema>;
export type PluginsReposListResponse = z.infer<typeof PluginsReposListResponseSchema>;
export type PluginsReposAddResponse = z.infer<typeof PluginsReposAddResponseSchema>;
export type PluginsReposRemoveResponse = z.infer<typeof PluginsReposRemoveResponseSchema>;
export type PluginsGetCatalogResponse = z.infer<typeof PluginsGetCatalogResponseSchema>;
export type PluginsInstallResponse = z.infer<typeof PluginsInstallResponseSchema>;
export type PluginsUninstallResponse = z.infer<typeof PluginsUninstallResponseSchema>;
export type PluginsSetEnabledResponse = z.infer<typeof PluginsSetEnabledResponseSchema>;
export type PluginsUpdateResponse = z.infer<typeof PluginsUpdateResponseSchema>;
export type PluginsDevLinkResponse = z.infer<typeof PluginsDevLinkResponseSchema>;
export type PluginsDevUnlinkResponse = z.infer<typeof PluginsDevUnlinkResponseSchema>;
export type PluginsDevSetEnabledResponse = z.infer<typeof PluginsDevSetEnabledResponseSchema>;
export type PluginsRpcCallResponse = z.infer<typeof PluginsRpcCallResponseSchema>;
export type PluginsGetContributionsResponse = z.infer<typeof PluginsGetContributionsResponseSchema>;
export type PluginsSettingsGetResponse = z.infer<typeof PluginsSettingsGetResponseSchema>;
export type PluginsSettingsSetResponse = z.infer<typeof PluginsSettingsSetResponseSchema>;
export type PluginsChangedMessage = z.infer<typeof PluginsChangedMessageSchema>;
export type PluginsNotifyMessage = z.infer<typeof PluginsNotifyMessageSchema>;

export const PLUGINS_INBOUND_SCHEMAS = [
  PluginsListRequestSchema,
  PluginsReposListRequestSchema,
  PluginsReposAddRequestSchema,
  PluginsReposRemoveRequestSchema,
  PluginsGetCatalogRequestSchema,
  PluginsInstallRequestSchema,
  PluginsUninstallRequestSchema,
  PluginsSetEnabledRequestSchema,
  PluginsUpdateRequestSchema,
  PluginsDevLinkRequestSchema,
  PluginsDevUnlinkRequestSchema,
  PluginsDevSetEnabledRequestSchema,
  PluginsRpcCallRequestSchema,
  PluginsGetContributionsRequestSchema,
  PluginsSettingsGetRequestSchema,
  PluginsSettingsSetRequestSchema,
] as const;
