import { brand } from "@frogg/branding";
import type pino from "pino";
import type { ProviderAvailability } from "../../agent/agent-manager.js";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import { getPidLockInfo } from "../../pid-lock.js";
import { generateLocalPairingOffer } from "../../pairing-offer.js";
import {
  collectDaemonDiagnostics,
  type DaemonWebSocketRuntimeDiagnosticSnapshot,
} from "./diagnostics.js";
import { DaemonSelfUpdateSessionController } from "./daemon-self-update-session-controller.js";
import type { ManagedAgent } from "../../agent/agent-manager.js";
import type { PersistedProjectRecord, PersistedWorkspaceRecord } from "../../workspace-registry.js";
import type { HubRelationshipManagement } from "../../hub/relationship-controller.js";
import type { DaemonConfigReloadResult } from "../../daemon-config-store.js";
import type { DaemonUpdateService } from "./daemon-update-service.js";
import type { BetaChannelService, BetaChannelStartResult } from "./beta-channel-service.js";
import type { DevDaemonService } from "./dev-daemon-service.js";
import type { WebUiServer } from "../../web-ui-server.js";
import type { SecurityPosture } from "@frogg/protocol/messages";
import type { HostResources } from "../../host/host-resources.js";
import type { SkillCatalog } from "../../skills/catalog.js";

export interface DaemonRuntimeConfig {
  listen: string | null;
  worktreesRoot?: string;
  appBaseUrl?: string;
  desktopManaged?: boolean;
  /** Versioned-install self-update; absent on daemons started without bootstrap wiring. */
  update?: DaemonUpdateService;
  /** Side-by-side beta daemon install/uninstall; absent without bootstrap wiring. */
  betaChannel?: BetaChannelService;
  /** Development daemon (`dev:live`) launch/stop; absent without bootstrap wiring. */
  devDaemon?: DevDaemonService;
  /** The web client's own server; absent without bootstrap wiring. */
  webUi?: WebUiServer;
  /** Live security findings (security-posture.ts); absent without bootstrap wiring. */
  getSecurityPosture?(): SecurityPosture;
  /** Host metrics and owned-storage sizes/cleanup; absent without bootstrap wiring. */
  hostResources?: HostResources;
  /** Skills the host's agents see and which are switched off; absent without bootstrap wiring. */
  skills?: SkillCatalog;
  /** Persist a warning as intended (or undo it); throws for a critical finding. */
  setSecurityFindingAcknowledged?(findingId: string, acknowledged: boolean): SecurityPosture;
  getRelayConfig(): {
    enabled: boolean;
    endpoint: string;
    publicEndpoint: string;
    useTls: boolean;
    publicUseTls: boolean;
  } | null;
}

export interface DaemonSessionHost {
  emit(msg: SessionOutboundMessage): void;
  emitLifecycleIntent(intent: {
    type: "restart";
    clientId: string;
    requestId: string;
    reason: string;
  }): void;
}

export interface DaemonSessionOptions {
  host: DaemonSessionHost;
  clientId: string;
  froggHome: string;
  serverId: string | undefined;
  daemonVersion: string | undefined;
  daemonRuntimeConfig: DaemonRuntimeConfig | undefined;
  listAgents: () => ManagedAgent[];
  listProjects: () => Promise<PersistedProjectRecord[]>;
  listWorkspaces: () => Promise<PersistedWorkspaceRecord[]>;
  listProviderAvailability: () => Promise<ProviderAvailability[]>;
  getWebSocketRuntimeMetrics?: () => DaemonWebSocketRuntimeDiagnosticSnapshot | null;
  logger: pino.Logger;
  hubRelationships?: HubRelationshipManagement;
  reloadConfig: () => DaemonConfigReloadResult;
}

/**
 * A client's read surface for the daemon process itself: its runtime status
 * (pid-lock start time, listen address, relay config, provider availability) and
 * a fresh local pairing offer for connecting a new client. Owns the `daemon.*`
 * RPCs. Reaches no state beyond the never-mutated runtime values injected at
 * construction and the outbound channel.
 */
export class DaemonSession {
  private readonly host: DaemonSessionHost;
  private readonly clientId: string;
  private readonly froggHome: string;
  private readonly serverId: string | undefined;
  private readonly daemonVersion: string | undefined;
  private readonly daemonRuntimeConfig: DaemonRuntimeConfig | undefined;
  private readonly listAgents: () => ManagedAgent[];
  private readonly listProjects: () => Promise<PersistedProjectRecord[]>;
  private readonly listWorkspaces: () => Promise<PersistedWorkspaceRecord[]>;
  private readonly listProviderAvailability: () => Promise<ProviderAvailability[]>;
  private readonly getWebSocketRuntimeMetrics: () => DaemonWebSocketRuntimeDiagnosticSnapshot | null;
  private readonly logger: pino.Logger;
  private readonly selfUpdate: DaemonSelfUpdateSessionController;
  private readonly hubRelationships: HubRelationshipManagement | null;
  private readonly reloadConfig: () => DaemonConfigReloadResult;

  constructor(options: DaemonSessionOptions) {
    this.host = options.host;
    this.clientId = options.clientId;
    this.froggHome = options.froggHome;
    this.serverId = options.serverId;
    this.daemonVersion = options.daemonVersion;
    this.daemonRuntimeConfig = options.daemonRuntimeConfig;
    this.listAgents = options.listAgents;
    this.listProjects = options.listProjects;
    this.listWorkspaces = options.listWorkspaces;
    this.listProviderAvailability = options.listProviderAvailability;
    this.getWebSocketRuntimeMetrics = options.getWebSocketRuntimeMetrics ?? (() => null);
    this.logger = options.logger;
    this.hubRelationships = options.hubRelationships ?? null;
    this.reloadConfig = options.reloadConfig;
    this.selfUpdate = new DaemonSelfUpdateSessionController({
      clientId: this.clientId,
      daemonVersion: this.daemonVersion ?? null,
      desktopManaged: this.daemonRuntimeConfig?.desktopManaged === true,
      emit: (msg) => this.host.emit(msg),
      emitLifecycleIntent: (intent) => this.host.emitLifecycleIntent(intent),
      sessionLogger: this.logger,
      versionedUpdate: this.daemonRuntimeConfig?.update?.installInfo.runningRoot
        ? this.daemonRuntimeConfig.update
        : undefined,
    });
  }

  async handleHubRelationshipRequest(
    msg: Extract<
      SessionInboundMessage,
      {
        type:
          | "hub.management.daemon.connect.request"
          | "hub.management.daemon.get_status.request"
          | "hub.management.daemon.disconnect.request"
          | "hub.management.daemon.permissions.update.request";
      }
    >,
  ): Promise<void> {
    try {
      if (!this.hubRelationships) throw new Error("Hub relationship management is unavailable");
      if (msg.type === "hub.management.daemon.connect.request") {
        const status = await this.hubRelationships.connect({
          hubUrl: msg.hubUrl,
          token: msg.token,
          permissions: msg.permissions,
        });
        this.host.emit({
          type: "hub.management.daemon.connect.response",
          payload: { requestId: msg.requestId, status },
        });
        return;
      }
      if (msg.type === "hub.management.daemon.permissions.update.request") {
        const status = await this.hubRelationships.updatePermissions({
          grant: msg.grant,
          revoke: msg.revoke,
        });
        this.host.emit({
          type: "hub.management.daemon.permissions.update.response",
          payload: { requestId: msg.requestId, status },
        });
        return;
      }
      if (msg.type === "hub.management.daemon.disconnect.request") {
        const result = await this.hubRelationships.disconnect({ force: msg.force ?? false });
        this.host.emit({
          type: "hub.management.daemon.disconnect.response",
          payload: { requestId: msg.requestId, ...result },
        });
        return;
      }
      this.host.emit({
        type: "hub.management.daemon.get_status.response",
        payload: { requestId: msg.requestId, status: this.hubRelationships.status() },
      });
    } catch (error) {
      this.logger.error({ err: error }, "Failed to handle Hub relationship request");
      this.host.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: error instanceof Error ? error.message : String(error),
          code: "handler_error",
        },
      });
    }
  }

  async handleHostGetMetricsRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.host.get_metrics.request" }>,
  ): Promise<void> {
    const host = this.daemonRuntimeConfig?.hostResources;
    try {
      if (!host) throw new Error("Host metrics are not available on this daemon");
      const metrics = await host.metrics.sample();
      this.host.emit({
        type: "daemon.host.get_metrics.response",
        payload: { requestId: msg.requestId, metrics, error: null },
      });
    } catch (error) {
      this.logger.warn({ err: error }, "Failed to sample host metrics");
      this.host.emit({
        type: "daemon.host.get_metrics.response",
        payload: { requestId: msg.requestId, metrics: null, error: errorMessage(error) },
      });
    }
  }

  async handleSkillsListRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.skills.list.request" }>,
  ): Promise<void> {
    const catalog = this.daemonRuntimeConfig?.skills;
    try {
      if (!catalog) throw new Error("Skills are not available on this daemon");
      const skills = await catalog.list();
      this.host.emit({
        type: "daemon.skills.list.response",
        payload: { requestId: msg.requestId, skills, error: null },
      });
    } catch (error) {
      this.logger.warn({ err: error }, "Failed to list skills");
      this.host.emit({
        type: "daemon.skills.list.response",
        payload: { requestId: msg.requestId, skills: [], error: errorMessage(error) },
      });
    }
  }

  async handleSkillsSetEnabledRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.skills.set_enabled.request" }>,
  ): Promise<void> {
    const catalog = this.daemonRuntimeConfig?.skills;
    try {
      if (!catalog) throw new Error("Skills are not available on this daemon");
      const skill = await catalog.setEnabled(msg.skillId, msg.enabled);
      if (!skill) throw new Error(`Unknown skill: ${msg.skillId}`);
      this.host.emit({
        type: "daemon.skills.set_enabled.response",
        payload: { requestId: msg.requestId, skill, error: null },
      });
    } catch (error) {
      this.logger.warn({ err: error, skillId: msg.skillId }, "Failed to switch skill");
      this.host.emit({
        type: "daemon.skills.set_enabled.response",
        payload: { requestId: msg.requestId, skill: null, error: errorMessage(error) },
      });
    }
  }

  async handleSkillsGetContentRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.skills.get_content.request" }>,
  ): Promise<void> {
    const catalog = this.daemonRuntimeConfig?.skills;
    try {
      if (!catalog) throw new Error("Skills are not available on this daemon");
      const content = await catalog.readContent(msg.skillId);
      if (content === null) throw new Error(`Unknown skill: ${msg.skillId}`);
      this.host.emit({
        type: "daemon.skills.get_content.response",
        payload: { requestId: msg.requestId, skillId: msg.skillId, content, error: null },
      });
    } catch (error) {
      this.host.emit({
        type: "daemon.skills.get_content.response",
        payload: {
          requestId: msg.requestId,
          skillId: msg.skillId,
          content: null,
          error: errorMessage(error),
        },
      });
    }
  }

  async handleStorageListRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.storage.list.request" }>,
  ): Promise<void> {
    const host = this.daemonRuntimeConfig?.hostResources;
    try {
      if (!host) throw new Error("Storage reporting is not available on this daemon");
      const report = await host.storage.list({ refresh: msg.refresh === true });
      this.host.emit({
        type: "daemon.storage.list.response",
        payload: {
          requestId: msg.requestId,
          computedAt: report.computedAt,
          categories: report.categories,
          error: null,
        },
      });
    } catch (error) {
      this.logger.warn({ err: error }, "Failed to measure owned storage");
      this.host.emit({
        type: "daemon.storage.list.response",
        payload: {
          requestId: msg.requestId,
          computedAt: null,
          categories: [],
          error: errorMessage(error),
        },
      });
    }
  }

  async handleStorageCleanRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.storage.clean.request" }>,
  ): Promise<void> {
    const host = this.daemonRuntimeConfig?.hostResources;
    try {
      if (!host) throw new Error("Storage cleanup is not available on this daemon");
      const result = await host.storage.cleanup(msg.categoryId);
      this.host.emit({
        type: "daemon.storage.clean.response",
        payload: { requestId: msg.requestId, ...result, error: null },
      });
    } catch (error) {
      this.logger.warn({ err: error, categoryId: msg.categoryId }, "Storage cleanup failed");
      this.host.emit({
        type: "daemon.storage.clean.response",
        payload: {
          requestId: msg.requestId,
          categoryId: msg.categoryId,
          bytesFreed: 0,
          removedCount: 0,
          error: errorMessage(error),
        },
      });
    }
  }

  async handleGetStatusRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.get_status.request" }>,
  ): Promise<void> {
    try {
      const pidInfo = await getPidLockInfo(this.froggHome);
      const providers = (await this.listProviderAvailability()).map((p) => ({
        provider: p.provider,
        available: p.available,
        error: p.error ?? null,
      }));
      this.host.emit({
        type: "daemon.get_status.response",
        payload: {
          requestId: msg.requestId,
          serverId: this.serverId ?? "",
          version: this.daemonVersion ?? null,
          pid: process.pid,
          nodePath: process.execPath,
          startedAt: pidInfo?.startedAt ?? null,
          listen: this.daemonRuntimeConfig?.listen ?? null,
          relay: this.daemonRuntimeConfig?.getRelayConfig() ?? null,
          providers,
        },
      });
    } catch (error) {
      this.logger.error({ err: error }, "Failed to handle daemon status request");
      this.host.emit({
        type: "daemon.get_status.response",
        payload: {
          requestId: msg.requestId,
          serverId: this.serverId ?? "",
          version: this.daemonVersion ?? null,
          pid: process.pid,
          nodePath: process.execPath,
          startedAt: null,
          listen: null,
          relay: null,
          providers: [],
        },
      });
    }
  }

  handleGetSecurityPostureRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.get_security_posture.request" }>,
  ): Promise<void> {
    const getPosture = this.daemonRuntimeConfig?.getSecurityPosture;
    this.host.emit({
      type: "daemon.get_security_posture.response",
      payload: getPosture
        ? { requestId: msg.requestId, posture: getPosture(), error: null }
        : {
            requestId: msg.requestId,
            posture: null,
            error: "Security posture is not available on this daemon",
          },
    });
    return Promise.resolve();
  }

  handleSetSecurityFindingAcknowledgedRequest(
    msg: Extract<
      SessionInboundMessage,
      { type: "daemon.set_security_finding_acknowledged.request" }
    >,
  ): Promise<void> {
    const setAcknowledged = this.daemonRuntimeConfig?.setSecurityFindingAcknowledged;
    let payload: { posture: SecurityPosture | null; error: string | null };
    if (!setAcknowledged) {
      payload = { posture: null, error: "Security findings cannot be acknowledged on this daemon" };
    } else {
      try {
        payload = { posture: setAcknowledged(msg.findingId, msg.acknowledged), error: null };
      } catch (error) {
        payload = { posture: null, error: error instanceof Error ? error.message : String(error) };
      }
    }
    this.host.emit({
      type: "daemon.set_security_finding_acknowledged.response",
      payload: { requestId: msg.requestId, ...payload },
    });
    return Promise.resolve();
  }

  async handleGetPairingOfferRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.get_pairing_offer.request" }>,
  ): Promise<void> {
    try {
      const relay = this.daemonRuntimeConfig?.getRelayConfig();
      const pairing = await generateLocalPairingOffer({
        froggHome: this.froggHome,
        relayEnabled: relay?.enabled ?? false,
        relayEndpoint: relay?.endpoint,
        relayPublicEndpoint: relay?.publicEndpoint,
        relayUseTls: relay?.useTls,
        relayPublicUseTls: relay?.publicUseTls,
        appBaseUrl: this.daemonRuntimeConfig?.appBaseUrl,
        includeQr: true,
        logger: this.logger,
      });
      this.host.emit({
        type: "daemon.get_pairing_offer.response",
        payload: {
          requestId: msg.requestId,
          url: pairing.url ?? "",
          qr: pairing.qr ?? null,
          relayEnabled: pairing.relayEnabled,
        },
      });
    } catch (error) {
      this.logger.error({ err: error }, "Failed to handle daemon pairing offer request");
      this.host.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: "daemon.get_pairing_offer.request",
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  handleConfigReloadRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.config.reload.request" }>,
  ): void {
    try {
      this.host.emit({
        type: "daemon.config.reload.response",
        payload: { requestId: msg.requestId, ...this.reloadConfig() },
      });
    } catch (error) {
      this.logger.error({ err: error }, "Failed to reload daemon config");
      this.host.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: error instanceof Error ? error.message : String(error),
          code: "handler_error",
        },
      });
    }
  }

  async handleDiagnosticsRequest(
    msg: Extract<SessionInboundMessage, { type: "diagnostics.request" }>,
  ): Promise<void> {
    try {
      const diagnostic = await collectDaemonDiagnostics({
        froggHome: this.froggHome,
        serverId: this.serverId,
        daemonVersion: this.daemonVersion,
        daemonRuntimeConfig: this.daemonRuntimeConfig,
        listAgents: this.listAgents,
        listProjects: this.listProjects,
        listWorkspaces: this.listWorkspaces,
        listProviderAvailability: this.listProviderAvailability,
        getWebSocketRuntimeMetrics: this.getWebSocketRuntimeMetrics,
        logger: this.logger,
      });
      this.host.emit({
        type: "diagnostics.response",
        payload: {
          requestId: msg.requestId,
          diagnostic,
        },
      });
    } catch (error) {
      this.logger.error({ err: error }, "Failed to handle diagnostics request");
      this.host.emit({
        type: "diagnostics.response",
        payload: {
          requestId: msg.requestId,
          diagnostic: `${brand.name} diagnostics\n  Error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      });
    }
  }

  async handleUpdateRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.update.request" }>,
  ): Promise<void> {
    await this.selfUpdate.dispatch(msg);
  }

  async handleUpdateCheckRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.update.check.request" }>,
  ): Promise<void> {
    const update = this.daemonRuntimeConfig?.update;
    const payload = update
      ? await update.check({ channel: msg.channel })
      : {
          ...this.updateUnavailable(),
          // Each build updates on its own channel; see DaemonUpdateService.check.
          channel: brand.channel,
          latestVersion: null,
          updateAvailable: false,
          releaseUrl: null,
          error: null,
        };
    this.host.emit({
      type: "daemon.update.check.response",
      payload: { requestId: msg.requestId, ...payload },
    });
  }

  async handleUpdateStartRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.update.start.request" }>,
  ): Promise<void> {
    const update = this.daemonRuntimeConfig?.update;
    const payload = update
      ? await update.start({ version: msg.version, channel: msg.channel })
      : {
          accepted: false,
          runId: null,
          targetVersion: null,
          error: this.updateUnavailable().reason,
        };
    this.host.emit({
      type: "daemon.update.start.response",
      payload: { requestId: msg.requestId, ...payload },
    });
  }

  handleUpdateGetStatusRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.update.get_status.request" }>,
  ): void {
    const update = this.daemonRuntimeConfig?.update;
    const payload = update
      ? update.status()
      : { ...this.updateUnavailable(), installDir: null, run: null, lastResult: null };
    this.host.emit({
      type: "daemon.update.get_status.response",
      payload: { requestId: msg.requestId, ...payload },
    });
  }

  async handleBetaChannelGetStatusRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.beta_channel.get_status.request" }>,
  ): Promise<void> {
    const service = this.daemonRuntimeConfig?.betaChannel;
    if (!service) {
      this.host.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: "Beta channel management is not available on this daemon.",
          code: "unsupported",
        },
      });
      return;
    }
    try {
      const status = await service.status();
      this.host.emit({
        type: "daemon.beta_channel.get_status.response",
        payload: { requestId: msg.requestId, ...status, error: null },
      });
    } catch (error) {
      this.logger.warn({ err: error }, "beta channel status failed");
      this.host.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: errorMessage(error),
        },
      });
    }
  }

  async handleBetaChannelInstallRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.beta_channel.install.request" }>,
  ): Promise<void> {
    const service = this.daemonRuntimeConfig?.betaChannel;
    const result = service ? service.install({ version: msg.version }) : BETA_CHANNEL_UNAVAILABLE;
    this.host.emit({
      type: "daemon.beta_channel.install.response",
      payload: { requestId: msg.requestId, ...result },
    });
  }

  async handleBetaChannelUninstallRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.beta_channel.uninstall.request" }>,
  ): Promise<void> {
    const service = this.daemonRuntimeConfig?.betaChannel;
    const result = service ? service.uninstall({ purge: msg.purge }) : BETA_CHANNEL_UNAVAILABLE;
    this.host.emit({
      type: "daemon.beta_channel.uninstall.response",
      payload: { requestId: msg.requestId, ...result },
    });
  }

  async handleBetaChannelStartRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.beta_channel.start.request" }>,
  ): Promise<void> {
    const service = this.daemonRuntimeConfig?.betaChannel;
    const error = service ? await service.setRunning(true) : BETA_CHANNEL_UNAVAILABLE.error;
    this.host.emit({
      type: "daemon.beta_channel.start.response",
      payload: { requestId: msg.requestId, error },
    });
  }

  async handleBetaChannelStopRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.beta_channel.stop.request" }>,
  ): Promise<void> {
    const service = this.daemonRuntimeConfig?.betaChannel;
    const error = service ? await service.setRunning(false) : BETA_CHANNEL_UNAVAILABLE.error;
    this.host.emit({
      type: "daemon.beta_channel.stop.response",
      payload: { requestId: msg.requestId, error },
    });
  }

  async handleDevDaemonGetStatusRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.dev_daemon.get_status.request" }>,
  ): Promise<void> {
    const service = this.daemonRuntimeConfig?.devDaemon;
    try {
      if (!service) throw new Error(DEV_DAEMON_UNAVAILABLE);
      const status = await service.status(await this.listWorkspaces());
      this.host.emit({
        type: "daemon.dev_daemon.get_status.response",
        payload: { requestId: msg.requestId, ...status, error: null },
      });
    } catch (error) {
      this.host.emit({
        type: "rpc_error",
        payload: { requestId: msg.requestId, requestType: msg.type, error: errorMessage(error) },
      });
    }
  }

  async handleDevDaemonStartRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.dev_daemon.start.request" }>,
  ): Promise<void> {
    const service = this.daemonRuntimeConfig?.devDaemon;
    const error = service ? await service.start(msg.cwd) : DEV_DAEMON_UNAVAILABLE;
    this.host.emit({
      type: "daemon.dev_daemon.start.response",
      payload: { requestId: msg.requestId, error },
    });
  }

  async handleDevDaemonRebuildRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.dev_daemon.rebuild.request" }>,
  ): Promise<void> {
    const service = this.daemonRuntimeConfig?.devDaemon;
    const error = service ? await service.rebuild(msg.target, msg.cwd) : DEV_DAEMON_UNAVAILABLE;
    this.host.emit({
      type: "daemon.dev_daemon.rebuild.response",
      payload: { requestId: msg.requestId, error },
    });
  }

  async handleDevDaemonStopRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.dev_daemon.stop.request" }>,
  ): Promise<void> {
    const service = this.daemonRuntimeConfig?.devDaemon;
    const error = service ? await service.stop(msg.cwd) : DEV_DAEMON_UNAVAILABLE;
    this.host.emit({
      type: "daemon.dev_daemon.stop.response",
      payload: { requestId: msg.requestId, error },
    });
  }

  async handleWebUiRequest(
    msg: Extract<
      SessionInboundMessage,
      {
        type:
          | "daemon.web_ui.get_status.request"
          | "daemon.web_ui.update.request"
          | "daemon.web_ui.start.request"
          | "daemon.web_ui.stop.request";
      }
    >,
  ): Promise<void> {
    const server = this.daemonRuntimeConfig?.webUi;
    if (!server) {
      this.host.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: "The web client is not available on this daemon.",
          code: "unsupported",
        },
      });
      return;
    }
    let error: string | null = null;
    try {
      switch (msg.type) {
        case "daemon.web_ui.update.request":
          error = await server.update({ startOnLaunch: msg.startOnLaunch, host: msg.host });
          break;
        case "daemon.web_ui.start.request":
          error = await server.start();
          break;
        case "daemon.web_ui.stop.request":
          await server.stop();
          break;
        case "daemon.web_ui.get_status.request":
          break;
      }
    } catch (err) {
      error = errorMessage(err);
    }
    const payload = { requestId: msg.requestId, ...server.status(), error };
    switch (msg.type) {
      case "daemon.web_ui.get_status.request":
        this.host.emit({ type: "daemon.web_ui.get_status.response", payload });
        return;
      case "daemon.web_ui.update.request":
        this.host.emit({ type: "daemon.web_ui.update.response", payload });
        return;
      case "daemon.web_ui.start.request":
        this.host.emit({ type: "daemon.web_ui.start.response", payload });
        return;
      case "daemon.web_ui.stop.request":
        this.host.emit({ type: "daemon.web_ui.stop.response", payload });
        return;
    }
  }

  private updateUnavailable(): { updatable: false; reason: string; currentVersion: string } {
    return {
      updatable: false,
      reason: "Self-update is not available on this daemon.",
      currentVersion: this.daemonVersion ?? "unknown",
    };
  }
}

const BETA_CHANNEL_UNAVAILABLE: BetaChannelStartResult = {
  accepted: false,
  runId: null,
  targetVersion: null,
  error: "Beta channel management is not available on this daemon.",
};

const DEV_DAEMON_UNAVAILABLE = "Development daemon management is not available on this daemon.";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
