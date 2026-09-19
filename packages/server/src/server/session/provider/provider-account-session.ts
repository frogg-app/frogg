import type pino from "pino";

import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import {
  ProviderAccountError,
  type ProviderAccountMutationResult,
  type ProviderAccountStore,
} from "../../provider-accounts/provider-account-store.js";

type ProviderAccountResponseType =
  | "provider.account.list.response"
  | "provider.account.create.response"
  | "provider.account.delete.response"
  | "provider.account.set_active.response"
  | "provider.account.rename.response"
  | "provider.account.sign_out.response"
  | "provider.account.import.response"
  | "provider.account.set_allowed_models.response"
  | "provider.account.set_preferences.response";

export interface ProviderAccountSessionHost {
  emit(msg: SessionOutboundMessage): void;
  /**
   * Called after a mutation so the provider registry picks up the new active
   * account's env overlay without a daemon restart.
   */
  onProviderAccountsChanged?(): void;
}

export interface ProviderAccountSessionOptions {
  host: ProviderAccountSessionHost;
  store: ProviderAccountStore;
  logger: pino.Logger;
}

/**
 * The multi-sign-in RPC surface. Every response carries the full account list
 * and the capability manifest so a client renders the whole screen — enabled
 * providers, accounts, linkable-folder checkboxes — from a single round trip.
 */
export class ProviderAccountSession {
  private readonly host: ProviderAccountSessionHost;
  private readonly store: ProviderAccountStore;
  private readonly logger: pino.Logger;

  constructor(options: ProviderAccountSessionOptions) {
    this.host = options.host;
    this.store = options.store;
    this.logger = options.logger;
  }

  async handleProviderAccountListRequest(
    msg: Extract<SessionInboundMessage, { type: "provider.account.list.request" }>,
  ): Promise<void> {
    this.run("provider.account.list.response", msg.requestId, () => this.store.buildResult([]));
  }

  async handleProviderAccountCreateRequest(
    msg: Extract<SessionInboundMessage, { type: "provider.account.create.request" }>,
  ): Promise<void> {
    this.run("provider.account.create.response", msg.requestId, () =>
      this.store.create({
        provider: msg.provider,
        name: msg.name,
        ...(msg.linkedFolders ? { linkedFolders: msg.linkedFolders } : {}),
      }),
    );
  }

  async handleProviderAccountDeleteRequest(
    msg: Extract<SessionInboundMessage, { type: "provider.account.delete.request" }>,
  ): Promise<void> {
    this.run("provider.account.delete.response", msg.requestId, () =>
      this.store.delete(msg.accountId),
    );
  }

  async handleProviderAccountSetActiveRequest(
    msg: Extract<SessionInboundMessage, { type: "provider.account.set_active.request" }>,
  ): Promise<void> {
    this.run("provider.account.set_active.response", msg.requestId, () =>
      this.store.setActive(msg.provider, msg.accountId),
    );
  }

  async handleProviderAccountRenameRequest(
    msg: Extract<SessionInboundMessage, { type: "provider.account.rename.request" }>,
  ): Promise<void> {
    this.run("provider.account.rename.response", msg.requestId, () =>
      this.store.rename(msg.accountId, msg.name),
    );
  }

  async handleProviderAccountSignOutRequest(
    msg: Extract<SessionInboundMessage, { type: "provider.account.sign_out.request" }>,
  ): Promise<void> {
    this.run("provider.account.sign_out.response", msg.requestId, () =>
      this.store.signOut(msg.accountId),
    );
  }

  async handleProviderAccountImportRequest(
    msg: Extract<SessionInboundMessage, { type: "provider.account.import.request" }>,
  ): Promise<void> {
    this.run("provider.account.import.response", msg.requestId, () =>
      this.store.import(msg.bundle),
    );
  }

  async handleProviderAccountSetPreferencesRequest(
    msg: Extract<SessionInboundMessage, { type: "provider.account.set_preferences.request" }>,
  ): Promise<void> {
    this.run("provider.account.set_preferences.response", msg.requestId, () =>
      this.store.setPreferences(msg.accountId, msg.preferences),
    );
  }

  async handleProviderAccountSetAllowedModelsRequest(
    msg: Extract<SessionInboundMessage, { type: "provider.account.set_allowed_models.request" }>,
  ): Promise<void> {
    this.run("provider.account.set_allowed_models.response", msg.requestId, () =>
      this.store.setAllowedModels(msg.accountId, msg.allowedModels),
    );
  }

  /**
   * Export does not share the common response payload: it returns the bundle.
   *
   * The bundle is SECRET MATERIAL — live provider credentials. It is emitted on
   * this authenticated session only, is never written to disk daemon-side, and
   * must never be logged, so the error path here logs the message alone.
   */
  async handleProviderAccountExportRequest(
    msg: Extract<SessionInboundMessage, { type: "provider.account.export.request" }>,
  ): Promise<void> {
    try {
      const bundle = this.store.export(msg.provider, msg.accountIds);
      this.host.emit({
        type: "provider.account.export.response",
        payload: { requestId: msg.requestId, bundle, error: null },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!(error instanceof ProviderAccountError)) {
        this.logger.error({ err: error }, "Provider account export failed");
      }
      this.host.emit({
        type: "provider.account.export.response",
        payload: { requestId: msg.requestId, bundle: null, error: message },
      });
    }
  }

  private run(
    type: ProviderAccountResponseType,
    requestId: string,
    mutate: () => ProviderAccountMutationResult,
  ): void {
    try {
      const result = mutate();
      if (type !== "provider.account.list.response") {
        this.host.onProviderAccountsChanged?.();
      }
      this.emitResult(type, requestId, result, null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!(error instanceof ProviderAccountError)) {
        this.logger.error({ err: error }, "Provider account request failed");
      }
      // A rejected mutation still returns the current list so the client's view
      // stays correct next to the error.
      let snapshot: ProviderAccountMutationResult;
      try {
        snapshot = this.store.buildResult([]);
      } catch {
        snapshot = {
          accounts: [],
          capabilities: [],
          activeAccountIds: {},
          warnings: [],
        };
      }
      this.emitResult(type, requestId, snapshot, message);
    }
  }

  private emitResult(
    type: ProviderAccountResponseType,
    requestId: string,
    result: ProviderAccountMutationResult,
    error: string | null,
  ): void {
    this.host.emit({
      type,
      payload: {
        requestId,
        accounts: result.accounts,
        capabilities: result.capabilities,
        activeAccountIds: result.activeAccountIds,
        ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
        error,
      },
    });
  }
}
