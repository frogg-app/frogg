// Additive plugin API features this host implements beyond the base API version, reported to
// plugins as `ctx.host.features`. Add an entry when shipping an optional member so plugins can
// feature-detect it instead of needing a new API version.
export const PLUGIN_HOST_FEATURES: readonly string[] = [
  "timeline.cursor",
  "attention",
  "permissions",
  "agents.manage",
  "attachments",
  "workspaces",
  "todos",
  "audit",
];
