export const pluginsQueryKeys = {
  host: (serverId: string) => ["plugins", serverId] as const,
  list: (serverId: string) => ["plugins", serverId, "list"] as const,
  catalog: (serverId: string) => ["plugins", serverId, "catalog"] as const,
  repos: (serverId: string) => ["plugins", serverId, "repos"] as const,
  contributions: (serverId: string) => ["plugins", serverId, "contributions"] as const,
  settings: (serverId: string, pluginId: string) =>
    ["plugins", serverId, "settings", pluginId] as const,
  panel: (serverId: string, pluginId: string, panelId: string) =>
    ["plugins", serverId, "panel", pluginId, panelId] as const,
};
