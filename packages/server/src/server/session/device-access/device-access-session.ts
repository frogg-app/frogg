import type pino from "pino";
import type { ConnectedClient, PresenceTarget } from "@frogg/protocol/device-access";

import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { DeviceAccessCaller, DeviceAccessService } from "../../device-access-service.js";
import { DeviceAccessError } from "../../device-access-service.js";
import type { PresenceIdentity, PresenceService } from "../../presence-service.js";
import { presenceTargetKey } from "../../presence-service.js";

export interface DeviceAccessSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

export interface DeviceAccessSessionOptions {
  host: DeviceAccessSessionHost;
  /** Absent when the daemon runs without a device store (tests, embedded hosts). */
  deviceAccess: DeviceAccessService | null;
  presence: PresenceService | null;
  /** The paired device this connection authenticated as, re-read per request. */
  caller: () => DeviceAccessCaller;
  presenceIdentity: () => PresenceIdentity;
  /** Every live connection, described for this one. Absent: just this one. */
  listConnections?: () => ConnectedClient[];
  /** A client renamed itself through `presence.report`. */
  onSelfName?: (name: string) => void;
  logger: pino.Logger;
}

const UNAVAILABLE = "Device access is not available on this daemon";

/**
 * Marshals the `auth.*` and `presence.*` session RPCs: it turns a message into
 * a call on the device-access service or the presence service and emits the
 * response. Every access rule lives in those services, not here.
 *
 * Presence updates reach a client for the targets it has reported itself on,
 * which is exactly the set it is looking at.
 */
export class DeviceAccessSession {
  private readonly host: DeviceAccessSessionHost;
  private readonly deviceAccess: DeviceAccessService | null;
  private readonly presence: PresenceService | null;
  private readonly caller: () => DeviceAccessCaller;
  private readonly presenceIdentity: () => PresenceIdentity;
  private readonly listConnections: () => ConnectedClient[];
  private readonly onSelfName: ((name: string) => void) | null;
  private readonly logger: pino.Logger;
  private readonly reportedTargets = new Set<string>();
  private unsubscribePresence: (() => void) | null = null;

  constructor(options: DeviceAccessSessionOptions) {
    this.host = options.host;
    this.deviceAccess = options.deviceAccess;
    this.presence = options.presence;
    this.caller = options.caller;
    this.presenceIdentity = options.presenceIdentity;
    this.listConnections = options.listConnections ?? (() => []);
    this.onSelfName = options.onSelfName ?? null;
    this.logger = options.logger;
    this.unsubscribePresence =
      options.presence?.subscribe((target) => this.publishPresence(target)) ?? null;
  }

  cleanup(): void {
    this.unsubscribePresence?.();
    this.unsubscribePresence = null;
    this.reportedTargets.clear();
    this.presence?.leaveAll(this.presenceIdentity().participantId);
  }

  /** Notes an activity the daemon saw for every target this connection is on. */
  noteActivity(target: PresenceTarget, activity: "sending" | "input"): void {
    if (!this.presence) return;
    if (!this.reportedTargets.has(presenceTargetKey(target))) return;
    this.presence.noteActivity(this.presenceIdentity(), target, activity);
  }

  async handleDeviceListRequest(
    msg: Extract<SessionInboundMessage, { type: "auth.device.list.request" }>,
  ): Promise<void> {
    const service = this.deviceAccess;
    if (!service) {
      this.host.emit({
        type: "auth.device.list.response",
        payload: { requestId: msg.requestId, devices: [], error: UNAVAILABLE },
      });
      return;
    }
    try {
      this.host.emit({
        type: "auth.device.list.response",
        payload: {
          requestId: msg.requestId,
          devices: service.listDevices(this.caller()),
          error: null,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "auth.device.list.response",
        payload: { requestId: msg.requestId, devices: [], error: this.describe(error, msg.type) },
      });
    }
  }

  async handleDeviceRenameRequest(
    msg: Extract<SessionInboundMessage, { type: "auth.device.rename.request" }>,
  ): Promise<void> {
    try {
      const service = this.require();
      const device = service.renameDevice(this.caller(), {
        deviceId: msg.deviceId,
        name: msg.name,
      });
      this.host.emit({
        type: "auth.device.rename.response",
        payload: { requestId: msg.requestId, device, error: null },
      });
    } catch (error) {
      this.host.emit({
        type: "auth.device.rename.response",
        payload: { requestId: msg.requestId, device: null, error: this.describe(error, msg.type) },
      });
    }
  }

  async handleDeviceRevokeRequest(
    msg: Extract<SessionInboundMessage, { type: "auth.device.revoke.request" }>,
  ): Promise<void> {
    try {
      const service = this.require();
      const revoked = service.revokeDevice(this.caller(), msg.deviceId);
      this.host.emit({
        type: "auth.device.revoke.response",
        payload: { requestId: msg.requestId, revoked, error: null },
      });
    } catch (error) {
      this.host.emit({
        type: "auth.device.revoke.response",
        payload: {
          requestId: msg.requestId,
          revoked: false,
          error: this.describe(error, msg.type),
        },
      });
    }
  }

  async handlePairingCodeCreateRequest(
    msg: Extract<SessionInboundMessage, { type: "auth.pairing_code.create.request" }>,
  ): Promise<void> {
    try {
      const service = this.require();
      const issued = service.createPairingCode(this.caller(), {
        ...(msg.role ? { role: msg.role } : {}),
        ...(msg.ttlSeconds === undefined ? {} : { ttlSeconds: msg.ttlSeconds }),
      });
      this.host.emit({
        type: "auth.pairing_code.create.response",
        payload: { requestId: msg.requestId, ...issued, error: null },
      });
    } catch (error) {
      this.host.emit({
        type: "auth.pairing_code.create.response",
        payload: {
          requestId: msg.requestId,
          code: null,
          expiresAt: null,
          role: null,
          serverId: this.deviceAccess?.serverId ?? "",
          fingerprint: this.deviceAccess?.fingerprint() ?? "",
          endpoints: [],
          error: this.describe(error, msg.type),
        },
      });
    }
  }

  async handlePairingRequestListRequest(
    msg: Extract<SessionInboundMessage, { type: "auth.pairing_request.list.request" }>,
  ): Promise<void> {
    try {
      const service = this.require();
      this.host.emit({
        type: "auth.pairing_request.list.response",
        payload: { requestId: msg.requestId, requests: service.listPairingRequests(), error: null },
      });
    } catch (error) {
      this.host.emit({
        type: "auth.pairing_request.list.response",
        payload: { requestId: msg.requestId, requests: [], error: this.describe(error, msg.type) },
      });
    }
  }

  async handlePairingRequestDecideRequest(
    msg: Extract<SessionInboundMessage, { type: "auth.pairing_request.decide.request" }>,
  ): Promise<void> {
    try {
      const service = this.require();
      service.decidePairingRequest(this.caller(), {
        pairingRequestId: msg.pairingRequestId,
        decision: msg.decision,
        ...(msg.role ? { role: msg.role } : {}),
        ...(msg.name ? { name: msg.name } : {}),
      });
      this.host.emit({
        type: "auth.pairing_request.decide.response",
        // The credential is minted when the waiting device collects the
        // approval, so an approved request has no device to return yet.
        payload: { requestId: msg.requestId, device: null, error: null },
      });
    } catch (error) {
      this.host.emit({
        type: "auth.pairing_request.decide.response",
        payload: { requestId: msg.requestId, device: null, error: this.describe(error, msg.type) },
      });
    }
  }

  async handleSettingsGetRequest(
    msg: Extract<SessionInboundMessage, { type: "auth.settings.get.request" }>,
  ): Promise<void> {
    try {
      const service = this.require();
      this.host.emit({
        type: "auth.settings.get.response",
        payload: { requestId: msg.requestId, settings: service.settings(), error: null },
      });
    } catch (error) {
      this.host.emit({
        type: "auth.settings.get.response",
        payload: {
          requestId: msg.requestId,
          settings: null,
          error: this.describe(error, msg.type),
        },
      });
    }
  }

  async handleSettingsUpdateRequest(
    msg: Extract<SessionInboundMessage, { type: "auth.settings.update.request" }>,
  ): Promise<void> {
    try {
      const service = this.require();
      const settings = await service.updateSettings(this.caller(), {
        ...(msg.claimMode === undefined ? {} : { claimMode: msg.claimMode }),
        ...(msg.trustLan === undefined ? {} : { trustLan: msg.trustLan }),
      });
      this.host.emit({
        type: "auth.settings.update.response",
        payload: { requestId: msg.requestId, settings, error: null },
      });
    } catch (error) {
      this.host.emit({
        type: "auth.settings.update.response",
        payload: {
          requestId: msg.requestId,
          settings: null,
          error: this.describe(error, msg.type),
        },
      });
    }
  }

  async handlePasswordSetRequest(
    msg: Extract<SessionInboundMessage, { type: "auth.password.set.request" }>,
  ): Promise<void> {
    try {
      const service = this.require();
      const settings = await service.setPassword(this.caller(), msg.password);
      this.host.emit({
        type: "auth.password.set.response",
        payload: { requestId: msg.requestId, settings, error: null },
      });
    } catch (error) {
      this.host.emit({
        type: "auth.password.set.response",
        payload: {
          requestId: msg.requestId,
          settings: null,
          error: this.describe(error, msg.type),
        },
      });
    }
  }

  async handlePresenceReportRequest(
    msg: Extract<SessionInboundMessage, { type: "presence.report.request" }>,
  ): Promise<void> {
    if (!this.presence) {
      this.host.emit({
        type: "presence.report.response",
        payload: { requestId: msg.requestId, error: "Presence is not available on this daemon" },
      });
      return;
    }
    if (msg.deviceName !== undefined) {
      // Control characters would let a name forge extra lines in other clients.
      // eslint-disable-next-line no-control-regex -- stripping them is the point
      const name = msg.deviceName.replace(/[\u0000-\u001f\u007f]/g, "").trim();
      if (name) this.onSelfName?.(name);
    }
    const key = presenceTargetKey(msg.target);
    if (msg.state === "left") this.reportedTargets.delete(key);
    else this.reportedTargets.add(key);
    this.presence.report(this.presenceIdentity(), msg.target, msg.state);
    this.host.emit({
      type: "presence.report.response",
      payload: { requestId: msg.requestId, error: null },
    });
  }

  async handlePresenceGetRequest(
    msg: Extract<SessionInboundMessage, { type: "presence.get.request" }>,
  ): Promise<void> {
    const snapshot = this.presence
      ? this.presence.snapshot(msg.target, this.presenceIdentity().participantId)
      : { target: msg.target, participants: [] };
    this.host.emit({
      type: "presence.get.response",
      payload: {
        requestId: msg.requestId,
        snapshot,
        error: this.presence ? null : "Presence is not available on this daemon",
      },
    });
  }

  async handleListConnectionsRequest(
    msg: Extract<SessionInboundMessage, { type: "presence.list_connections.request" }>,
  ): Promise<void> {
    const connections = [...this.listConnections()].sort(
      (left, right) =>
        Number(right.isSelf) - Number(left.isSelf) ||
        left.connectedAt.localeCompare(right.connectedAt),
    );
    this.host.emit({
      type: "presence.list_connections.response",
      payload: { requestId: msg.requestId, connections, error: null },
    });
  }

  private publishPresence(target: PresenceTarget): void {
    if (!this.presence) return;
    if (!this.reportedTargets.has(presenceTargetKey(target))) return;
    this.host.emit({
      type: "presence.update",
      payload: this.presence.snapshot(target, this.presenceIdentity().participantId),
    });
  }

  private require(): DeviceAccessService {
    if (!this.deviceAccess) throw new DeviceAccessError(UNAVAILABLE);
    return this.deviceAccess;
  }

  private describe(error: unknown, operation: string): string {
    if (error instanceof DeviceAccessError) return error.message;
    this.logger.warn({ err: error, operation }, "Device access request failed");
    return "The request failed";
  }
}
