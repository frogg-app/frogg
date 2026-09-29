// plugins.* RPCs for one client session. Every handler answers with its typed response and a
// nullable `error`; the PluginService owns all state and policy.
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import { toPluginError } from "../../plugins/errors.js";
import type { PluginService } from "../../plugins/plugin-service.js";

type Inbound<T extends SessionInboundMessage["type"]> = Extract<SessionInboundMessage, { type: T }>;
type PluginsRequest = Extract<SessionInboundMessage, { type: `plugins.${string}` }>;

export interface PluginsSessionDependencies {
  service: PluginService | null | undefined;
  clientId: string;
  emit(message: SessionOutboundMessage): void;
}

const UNAVAILABLE = { code: "forbidden", message: "Plugins are not available on this host" };

export class PluginsSession {
  constructor(private readonly deps: PluginsSessionDependencies) {}

  dispatch(msg: SessionInboundMessage): Promise<void> | undefined {
    if (!msg.type.startsWith("plugins.")) return undefined;
    return this.handle(msg as PluginsRequest);
  }

  private async handle(msg: PluginsRequest): Promise<void> {
    const service = this.deps.service;
    const responseType = msg.type.replace(/\.request$/, ".response");
    const reply = (
      fields: Record<string, unknown>,
      error: { code: string; message: string } | null,
    ) =>
      this.deps.emit({
        type: responseType,
        payload: { requestId: msg.requestId, error, ...fields },
      } as SessionOutboundMessage);
    const empty = emptyFields(msg.type);
    if (!service) {
      reply(empty, UNAVAILABLE);
      return;
    }
    try {
      reply(await this.run(service, msg), null);
    } catch (err) {
      reply(empty, toPluginError(err));
    }
  }

  private async run(service: PluginService, msg: PluginsRequest): Promise<Record<string, unknown>> {
    switch (msg.type) {
      case "plugins.list.request":
        return service.list();
      case "plugins.repos.list.request":
        return { repos: service.listRepos() };
      case "plugins.repos.add.request":
        return { repo: await service.addRepo(msg) };
      case "plugins.repos.remove.request":
        await service.removeRepo(msg.url);
        return { success: true };
      case "plugins.get_catalog.request":
        return service.getCatalog(msg.refresh === true);
      case "plugins.install.request":
        return { plugin: await service.install(msg) };
      case "plugins.uninstall.request":
        await service.uninstall(msg.id);
        return { success: true };
      case "plugins.set_enabled.request":
        return { plugin: await service.setEnabled(msg.id, msg.enabled) };
      case "plugins.update.request":
        return { plugin: await service.update(msg) };
      case "plugins.dev.link.request":
        return { plugin: await service.devLink(msg.path) };
      case "plugins.dev.unlink.request":
        await service.devUnlink(msg.id);
        return { success: true };
      case "plugins.dev.set_enabled.request":
        return { policy: await service.setDeveloperMode(msg.enabled) };
      case "plugins.rpc.call.request":
        return {
          result: await service.callRpc(msg.pluginId, msg.method, msg.params, this.deps.clientId),
        };
      case "plugins.get_contributions.request":
        return { contributions: service.getContributions() };
      case "plugins.settings.get.request":
        return service.getSettings(msg.id);
      case "plugins.settings.set.request":
        await service.setSettings(msg.id, msg.values);
        return { success: true };
    }
  }
}

/** Required non-error fields for each response when the request failed. */
function emptyFields(type: PluginsRequest["type"]): Record<string, unknown> {
  switch (type) {
    case "plugins.list.request":
      return {
        plugins: [],
        policy: {
          enabled: false,
          allowUserRepos: false,
          developerMode: "forbidden",
          developerModeEnabled: false,
          apiVersions: [],
        },
      };
    case "plugins.repos.list.request":
      return { repos: [] };
    case "plugins.get_catalog.request":
      return { plugins: [], repos: [] };
    case "plugins.repos.add.request":
      return { repo: null };
    case "plugins.install.request":
    case "plugins.set_enabled.request":
    case "plugins.update.request":
    case "plugins.dev.link.request":
      return { plugin: null };
    case "plugins.dev.set_enabled.request":
      return {
        policy: {
          enabled: false,
          allowUserRepos: false,
          developerMode: "forbidden",
          developerModeEnabled: false,
          apiVersions: [],
        },
      };
    case "plugins.get_contributions.request":
      return { contributions: [] };
    case "plugins.settings.get.request":
      return { fields: [], values: {} };
    case "plugins.rpc.call.request":
      return {};
    case "plugins.repos.remove.request":
    case "plugins.uninstall.request":
    case "plugins.dev.unlink.request":
    case "plugins.settings.set.request":
      return { success: false };
  }
}

export type PluginsInbound<T extends PluginsRequest["type"]> = Inbound<T>;
