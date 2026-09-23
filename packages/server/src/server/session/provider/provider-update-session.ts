/**
 * Session handlers for provider CLI version checks, updates and preferences.
 */

import type pino from "pino";

import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { ProviderUpdateService } from "../../../services/provider-updates/service.js";
import type { ProviderUpdatePreferencesStore } from "../../../services/provider-updates/preferences.js";

export interface ProviderUpdateSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

export class ProviderUpdateSession {
  constructor(
    private readonly host: ProviderUpdateSessionHost,
    private readonly logger: pino.Logger,
    private readonly service: ProviderUpdateService,
    private readonly preferences: ProviderUpdatePreferencesStore,
  ) {}

  async handleProviderUpdateCheckRequest(
    msg: Extract<SessionInboundMessage, { type: "provider.update.check.request" }>,
  ): Promise<void> {
    await this.emitSnapshot("provider.update.check.response", msg.requestId, msg.type, {
      forceRefresh: msg.forceRefresh === true,
    });
  }

  async handleProviderUpdateSetPreferencesRequest(
    msg: Extract<SessionInboundMessage, { type: "provider.update.set_preferences.request" }>,
  ): Promise<void> {
    try {
      this.preferences.write({
        ...(msg.checkEnabled !== undefined ? { checkEnabled: msg.checkEnabled } : {}),
        ...(msg.autoUpdate !== undefined ? { autoUpdate: msg.autoUpdate } : {}),
        ...(msg.checkIntervalMinutes !== undefined
          ? { checkIntervalMinutes: msg.checkIntervalMinutes }
          : {}),
        ...(msg.ignoredProviders !== undefined ? { ignoredProviders: msg.ignoredProviders } : {}),
      });
    } catch (error) {
      this.emitRpcError(
        msg.requestId,
        msg.type,
        `Failed to save provider update preferences: ${toMessage(error)}`,
        "provider_update_preferences_failed",
      );
      return;
    }
    await this.emitSnapshot("provider.update.set_preferences.response", msg.requestId, msg.type, {
      forceRefresh: false,
    });
  }

  async handleProviderUpdateInstallRequest(
    msg: Extract<SessionInboundMessage, { type: "provider.update.install.request" }>,
  ): Promise<void> {
    try {
      const result = await this.service.update(msg.provider);
      this.host.emit({
        type: "provider.update.install.response",
        payload: {
          requestId: msg.requestId,
          provider: result.provider,
          updated: result.updated,
          previousVersion: result.previousVersion,
          installedVersion: result.installedVersion,
          output: result.output,
          error: result.error,
        },
      });
    } catch (error) {
      this.logger.error({ err: error, provider: msg.provider }, "provider update failed");
      this.emitRpcError(
        msg.requestId,
        msg.type,
        `Failed to update ${msg.provider}: ${toMessage(error)}`,
        "provider_update_failed",
      );
    }
  }

  private async emitSnapshot(
    type: "provider.update.check.response" | "provider.update.set_preferences.response",
    requestId: string,
    requestType: string,
    options: { forceRefresh: boolean },
  ): Promise<void> {
    const preferences = this.preferences.resolved();
    try {
      const snapshot = await this.service.check({ forceRefresh: options.forceRefresh });
      this.host.emit({
        type,
        payload: {
          requestId,
          checkedAt: snapshot.checkedAt,
          entries: snapshot.entries,
          preferences,
          error: null,
        },
      });
    } catch (error) {
      this.logger.error({ err: error }, "provider update check failed");
      this.emitRpcError(
        requestId,
        requestType,
        `Failed to check provider updates: ${toMessage(error)}`,
        "provider_update_check_failed",
      );
    }
  }

  private emitRpcError(requestId: string, requestType: string, error: string, code: string): void {
    this.host.emit({
      type: "rpc_error",
      payload: { requestId, requestType, error, code },
    });
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
