import { z } from "zod";

/**
 * Frogg plugin manifest (`frogg-plugin.json`) and declarative contribution schemas.
 * Shared by the daemon, client, CLI and repo CI. See docs/plans/plugins.md.
 *
 * These schemas are strict about what a *manifest* may contain. Wire messages that
 * echo manifest data (plugins.list, plugins.get_catalog) use open strings for enum-like
 * fields so an older client can still parse a newer daemon's output.
 */

export const PLUGIN_MANIFEST_FILENAME = "frogg-plugin.json";

/** API versions this build of the host can load. */
export const SUPPORTED_PLUGIN_API_VERSIONS = [1] as const;
export const CURRENT_PLUGIN_API_VERSION = 1;

export const PLUGIN_ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
/** Semver core with optional prerelease/build, e.g. 1.2.0, 1.2.0-beta.1. */
export const PLUGIN_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
/** Contribution ids: lowercase, digits, dot, dash, underscore. Command and session action ids
 * are also the plugin RPC method they invoke, so plugins conventionally prefix them with the
 * plugin id (e.g. `acme.jira-links.open`). */
export const PLUGIN_CONTRIBUTION_ID_PATTERN = /^[a-z0-9][a-z0-9_.-]*$/;

export const PluginIdSchema = z.string().max(128).regex(PLUGIN_ID_PATTERN);
export const PluginVersionSchema = z.string().max(64).regex(PLUGIN_VERSION_PATTERN);

export const PLUGIN_SCOPES = ["daemon", "client", "hybrid", "build"] as const;
export const PluginScopeSchema = z.enum(PLUGIN_SCOPES);
export type PluginScope = z.infer<typeof PluginScopeSchema>;

export const PLUGIN_CAPABILITIES = [
  "network",
  "filesystem.workspace",
  "process.spawn",
  "agent.read",
  "agent.write",
  "settings.store",
  "ui.contribute",
  "rpc",
  "ui.view",
  "media.microphone",
  "media.audio",
  "composer",
  "speech",
] as const;
export const PluginCapabilitySchema = z.enum(PLUGIN_CAPABILITIES);
export type PluginCapability = z.infer<typeof PluginCapabilitySchema>;

export function isPluginCapability(value: unknown): value is PluginCapability {
  return typeof value === "string" && (PLUGIN_CAPABILITIES as readonly string[]).includes(value);
}

const ContributionIdSchema = z.string().max(64).regex(PLUGIN_CONTRIBUTION_ID_PATTERN);
const TitleSchema = z.string().min(1).max(120);

/** Command Center entry. Invoking it calls plugin RPC method `<id>` with `{}`. */
export const PluginCommandContributionSchema = z.object({
  id: ContributionIdSchema,
  title: TitleSchema,
  description: z.string().max(500).optional(),
});

/**
 * Session header button. Invoking it calls plugin RPC method `<id>` with `{ agentId, cwd }`.
 */
export const PluginSessionActionContributionSchema = z.object({
  id: ContributionIdSchema,
  title: TitleSchema,
  icon: z.string().max(64).optional(),
});

/**
 * Custom view: a visible sandboxed iframe in the app that loads the plugin's client entry and
 * calls its exported `views[<id>](root, ctx)`. Needs a client entry and the "ui.view" capability.
 */
export const PluginViewContributionSchema = z.object({
  id: ContributionIdSchema,
  title: TitleSchema,
  icon: z.string().max(64).optional(),
});

/**
 * Composer button. Invoking it calls plugin RPC method `<id>` with `{ agentId, cwd }` (either may
 * be null when the composer is not attached to an agent). Needs the "composer" capability.
 */
export const PluginComposerActionContributionSchema = z.object({
  id: ContributionIdSchema,
  title: TitleSchema,
  icon: z.string().max(64).optional(),
});

export const PLUGIN_PANEL_KINDS = ["list", "markdown", "form"] as const;
export const PluginPanelKindSchema = z.enum(PLUGIN_PANEL_KINDS);

/**
 * Panel. Content comes from plugin RPC `panel.<id>.render` (see PluginPanelContentSchema);
 * form submissions go to `panel.<id>.submit` with `{ values }`.
 */
export const PluginPanelContributionSchema = z.object({
  id: ContributionIdSchema,
  title: TitleSchema,
  kind: PluginPanelKindSchema,
});

export const PLUGIN_SETTING_TYPES = ["string", "secret", "number", "boolean", "select"] as const;
export const PluginSettingTypeSchema = z.enum(PLUGIN_SETTING_TYPES);

/** Value of a declared settings field. The settings store itself holds any JSON value. */
export const PluginSettingValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type PluginSettingValue = z.infer<typeof PluginSettingValueSchema>;

/** One field on the plugin's settings page. Values live in the per-plugin settings store. */
export const PluginSettingFieldSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_.-]+$/),
  title: TitleSchema,
  type: PluginSettingTypeSchema,
  description: z.string().max(500).optional(),
  default: PluginSettingValueSchema.optional(),
  required: z.boolean().optional(),
  options: z
    .array(z.object({ value: z.string(), label: z.string() }))
    .max(100)
    .optional(),
});

/**
 * Built-in features a plugin can switch on. The code ships with the host; installing the
 * plugin is the opt-in, so the feature reaches a host through the plugin pipeline (ad-hoc
 * download, consent, enable/disable) without its code living in the plugin. Honoured only
 * for official and brand plugins, and dev links in developer mode.
 */
export const PLUGIN_BUILTIN_FEATURES = ["companion"] as const;
export const PluginBuiltinFeatureSchema = z.enum(PLUGIN_BUILTIN_FEATURES);
export type PluginBuiltinFeature = z.infer<typeof PluginBuiltinFeatureSchema>;

export const PluginContributesSchema = z.object({
  commands: z.array(PluginCommandContributionSchema).max(50).optional(),
  sessionActions: z.array(PluginSessionActionContributionSchema).max(20).optional(),
  panels: z.array(PluginPanelContributionSchema).max(20).optional(),
  views: z.array(PluginViewContributionSchema).max(20).optional(),
  composerActions: z.array(PluginComposerActionContributionSchema).max(10).optional(),
  settings: z.array(PluginSettingFieldSchema).max(100).optional(),
  features: z.array(PluginBuiltinFeatureSchema).max(PLUGIN_BUILTIN_FEATURES.length).optional(),
});
export type PluginContributes = z.infer<typeof PluginContributesSchema>;

export const PluginEntrySchema = z
  .object({
    daemon: z.string().min(1).max(256).optional(),
    client: z.string().min(1).max(256).optional(),
  })
  .refine((e) => !e.daemon || isSafeRelativePath(e.daemon), {
    message: "entry.daemon must be a relative path inside the plugin",
  })
  .refine((e) => !e.client || isSafeRelativePath(e.client), {
    message: "entry.client must be a relative path inside the plugin",
  });

export const PluginManifestSchema = z
  .object({
    id: PluginIdSchema,
    name: z.string().min(1).max(80),
    version: PluginVersionSchema,
    apiVersion: z.number().int().positive(),
    scope: PluginScopeSchema,
    description: z.string().max(500).optional(),
    author: z.string().max(120).optional(),
    homepage: z.string().url().max(500).optional(),
    license: z.string().max(64).optional(),
    entry: PluginEntrySchema.optional(),
    capabilities: z.array(PluginCapabilitySchema).max(PLUGIN_CAPABILITIES.length),
    contributes: PluginContributesSchema.optional(),
  })
  .superRefine((m, ctx) => {
    for (const issue of manifestIssues(m)) ctx.addIssue({ code: "custom", ...issue });
  });
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

interface ManifestIssue {
  path: (string | number)[];
  message: string;
}

function entryIssues(m: {
  scope: PluginScope;
  entry?: { daemon?: string; client?: string };
}): ManifestIssue[] {
  const issues: ManifestIssue[] = [];
  if ((m.scope === "daemon" || m.scope === "hybrid") && !m.entry?.daemon) {
    issues.push({ path: ["entry", "daemon"], message: `scope "${m.scope}" requires entry.daemon` });
  }
  if ((m.scope === "client" || m.scope === "hybrid") && !m.entry?.client) {
    issues.push({ path: ["entry", "client"], message: `scope "${m.scope}" requires entry.client` });
  }
  return issues;
}

/** Views and composer actions: the contributions added for app-side surfaces. */
function surfaceIssues(
  scope: PluginScope,
  capabilities: readonly string[],
  c: PluginContributes,
): ManifestIssue[] {
  const issues: ManifestIssue[] = [];
  if (c.views?.length) {
    if (!capabilities.includes("ui.view")) {
      issues.push({
        path: ["capabilities"],
        message: 'views contributions require the "ui.view" capability',
      });
    }
    if (scope !== "client" && scope !== "hybrid") {
      issues.push({
        path: ["contributes", "views"],
        message: "views need a client entry (scope client or hybrid)",
      });
    }
  }
  const panelIds = new Set((c.panels ?? []).map((p) => p.id));
  if ((c.views ?? []).some((v) => panelIds.has(v.id))) {
    issues.push({
      path: ["contributes", "views"],
      message: "a view id must not repeat a panel id; both open as the same tab",
    });
  }
  if (c.composerActions?.length && !capabilities.includes("composer")) {
    issues.push({
      path: ["capabilities"],
      message: 'composerActions contributions require the "composer" capability',
    });
  }
  if (c.settings?.length && !capabilities.includes("settings.store")) {
    issues.push({
      path: ["capabilities"],
      message: 'settings contributions require the "settings.store" capability',
    });
  }
  return issues;
}

function contributionIssues(
  scope: PluginScope,
  capabilities: readonly string[],
  c: PluginContributes | undefined,
): ManifestIssue[] {
  if (!c) return [];
  const issues: ManifestIssue[] = [];
  const invokesRpc =
    (c.commands?.length ?? 0) +
      (c.sessionActions?.length ?? 0) +
      (c.panels?.length ?? 0) +
      (c.composerActions?.length ?? 0) >
    0;
  if (invokesRpc && !capabilities.includes("rpc")) {
    issues.push({
      path: ["capabilities"],
      message: 'commands, sessionActions, panels and composerActions require the "rpc" capability',
    });
  }
  issues.push(...surfaceIssues(scope, capabilities, c));
  const idLists: Record<string, string[]> = {
    commands: (c.commands ?? []).map((x) => x.id),
    sessionActions: (c.sessionActions ?? []).map((x) => x.id),
    panels: (c.panels ?? []).map((x) => x.id),
    views: (c.views ?? []).map((x) => x.id),
    composerActions: (c.composerActions ?? []).map((x) => x.id),
    settings: (c.settings ?? []).map((x) => x.key),
    features: [...(c.features ?? [])],
  };
  for (const [key, ids] of Object.entries(idLists)) {
    if (new Set(ids).size !== ids.length)
      issues.push({ path: ["contributes", key], message: `duplicate ${key} id` });
  }
  return issues;
}

function manifestIssues(m: {
  scope: PluginScope;
  entry?: { daemon?: string; client?: string };
  capabilities: readonly string[];
  contributes?: PluginContributes;
}): ManifestIssue[] {
  const issues: ManifestIssue[] = [];
  if (new Set(m.capabilities).size !== m.capabilities.length) {
    issues.push({ path: ["capabilities"], message: "duplicate capability" });
  }
  return [
    ...issues,
    ...entryIssues(m),
    ...contributionIssues(m.scope, m.capabilities, m.contributes),
  ];
}

export function isSafeRelativePath(p: string): boolean {
  if (p.startsWith("/") || p.startsWith("\\") || /^[A-Za-z]:/.test(p)) return false;
  return !p.split(/[\\/]/).some((seg) => seg === "..");
}

export function isSupportedPluginApiVersion(v: number): boolean {
  return (SUPPORTED_PLUGIN_API_VERSIONS as readonly number[]).includes(v);
}

/** Capabilities in `next` not present in `prev` — an update that adds any needs re-consent. */
export function addedCapabilities(prev: readonly string[], next: readonly string[]): string[] {
  const before = new Set(prev);
  return next.filter((c) => !before.has(c));
}

// ---------------------------------------------------------------------------
// Panel content returned by `panel.<id>.render`. Pure schemas; the client validates
// the plugins.rpc.call result against this before rendering.

export const PluginPanelActionSchema = z.object({
  /** Plugin RPC method invoked when the item/button is pressed. */
  method: z.string().min(1).max(128),
  params: z.record(z.string(), z.unknown()).optional(),
});

export const PluginPanelListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  badge: z.string().optional(),
  url: z.string().optional(),
  action: PluginPanelActionSchema.optional(),
});

export const PluginPanelContentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("list"),
    items: z.array(PluginPanelListItemSchema),
    emptyText: z.string().optional(),
  }),
  z.object({ kind: z.literal("markdown"), markdown: z.string() }),
  z.object({
    kind: z.literal("form"),
    fields: z.array(PluginSettingFieldSchema),
    values: z.record(z.string(), PluginSettingValueSchema).optional(),
    submitLabel: z.string().optional(),
  }),
]);
export type PluginPanelContent = z.infer<typeof PluginPanelContentSchema>;

/** RPC method names the host invokes for declarative contributions. */
export const pluginContributionMethods = {
  command: (id: string) => id,
  sessionAction: (id: string) => id,
  composerAction: (id: string) => id,
  panelRender: (id: string) => `panel.${id}.render`,
  panelSubmit: (id: string) => `panel.${id}.submit`,
} as const;
