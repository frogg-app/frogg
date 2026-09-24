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
import type { SecurityPosture } from "@frogg/protocol/messages";

export interface DaemonRuntimeConfig {
  listen: string | null;
  worktreesRoot?: string;
  appBaseUrl?: string;
  desktopManaged?: boolean;
  /** Versioned-install self-update; absent on daemons started without bootstrap wiring. */
  update?: DaemonUpdateService;
  /** Live security findings (security-posture.ts); absent without bootstrap wiring. */
  getSecurityPosture?(): SecurityPosture;
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
          channel: msg.channel ?? ("stable" as const),
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

  private updateUnavailable(): { updatable: false; reason: string; currentVersion: string } {
    return {
      updatable: false,
      reason: "Self-update is not available on this daemon.",
      currentVersion: this.daemonVersion ?? "unknown",
    };
  }
}
