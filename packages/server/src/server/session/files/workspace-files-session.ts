import type pino from "pino";
import { getErrorMessage } from "@frogg/protocol/error-utils";
import {
  encodeFileTransferFrame,
  FileTransferOpcode,
  type FileTransferFrame,
} from "@frogg/protocol/binary-frames/index";
import type {
  FileDownloadTokenRequest,
  FileEntryCreateRequest,
  FileEntryDeleteRequest,
  FileEntryDuplicateRequest,
  FileEntryRenameRequest,
  FileExplorerRequest,
  FileUploadRequest,
  FileSubscribeRequest,
  FileUnsubscribeRequest,
  FileWriteRequest,
  SessionInboundMessage,
  SessionOutboundMessage,
} from "../../messages.js";
import { FileUploadStore } from "../../file-upload/index.js";
import type { DownloadTokenStore } from "../../file-download/token-store.js";
import {
  createExplorerEntry,
  deleteExplorerEntry,
  duplicateExplorerEntry,
  getDownloadableFileInfo,
  listDirectoryEntries,
  readExplorerFile,
  renameExplorerEntry,
  streamExplorerFile,
  writeExplorerFile,
} from "../../file-explorer/service.js";
import { workspaceFileObserver, type FileObserver } from "../../file-explorer/observer.js";
import { canonicalizePath, DaemonHomeGuard } from "../../file-explorer/daemon-home-guard.js";
import { expandUserPath, isSameOrDescendantPath } from "../../path-utils.js";
import type { DeviceRole } from "../../authorization/index.js";

export const VIEWER_OUTSIDE_WORKSPACE_MESSAGE =
  "Viewers can only access files inside a registered workspace";
import { getProjectIcon } from "../../../utils/project-icon.js";

/**
 * What a workspace file-access request reaches outside its own domain: the
 * outbound message channel (text + binary). `hasBinaryChannel` gates the
 * binary file-explorer transfer path the same way the terminal subsystem does
 * — old clients without a binary channel fall back to inline JSON file content.
 */
export interface WorkspaceFilesSessionHost {
  emit(msg: SessionOutboundMessage, source?: object): void;
  emitBinary(frame: Uint8Array, source?: object): Promise<void>;
  hasBinaryChannel(): boolean;
}

export interface WorkspaceFilesSessionOptions {
  host: WorkspaceFilesSessionHost;
  downloadTokenStore: DownloadTokenStore;
  froggHome: string;
  /** Configured worktrees root; exempted from the daemon-home deny. */
  worktreesRoot?: string;
  logger: pino.Logger;
  fileObserver?: FileObserver;
  /** The connection's current device role; owner when omitted. */
  getRole?: () => DeviceRole;
  /**
   * Roots of registered workspaces and worktrees. Viewers are confined to
   * these; owner and operator are not.
   */
  listWorkspaceRoots?: () => Promise<string[]>;
}

/**
 * A client's workspace file-access surface: browsing directories, reading file
 * contents (inline JSON or binary frames), receiving uploads, issuing download
 * tokens, and reading project icons. It owns the upload store and reaches no
 * workspace-git, registry, or subscription state — file I/O scoped to a cwd is
 * the whole concern.
 */
export class WorkspaceFilesSession {
  private readonly host: WorkspaceFilesSessionHost;
  private readonly downloadTokenStore: DownloadTokenStore;
  private readonly logger: pino.Logger;
  private readonly fileUploads: FileUploadStore;
  private readonly fileObserver: FileObserver;
  private readonly fileSubscriptions = new Map<string, () => void>();
  private readonly homeGuard: DaemonHomeGuard;
  private readonly getRole: () => DeviceRole;
  private readonly listWorkspaceRoots: () => Promise<string[]>;

  constructor(options: WorkspaceFilesSessionOptions) {
    this.host = options.host;
    this.downloadTokenStore = options.downloadTokenStore;
    this.logger = options.logger;
    this.fileUploads = new FileUploadStore({ froggHome: options.froggHome });
    this.fileObserver = options.fileObserver ?? workspaceFileObserver;
    this.homeGuard = new DaemonHomeGuard({
      froggHome: options.froggHome,
      worktreesRoot: options.worktreesRoot,
    });
    this.getRole = options.getRole ?? (() => "owner");
    this.listWorkspaceRoots = options.listWorkspaceRoots ?? (async () => []);
  }

  /**
   * Enforces the file-access boundary for a request: throws when the cwd or
   * any requested path resolves (through symlinks) into a forbidden location.
   */
  private async assertAccess(cwd: string, ...relativePaths: string[]): Promise<void> {
    await this.homeGuard.assertAccessible(cwd, ...relativePaths);
    if (this.getRole() === "viewer") await this.assertInsideWorkspace(cwd);
  }

  private async assertInsideWorkspace(cwd: string): Promise<void> {
    const canonicalCwd = await canonicalizePath(expandUserPath(cwd));
    for (const root of await this.listWorkspaceRoots()) {
      if (!root.trim()) continue;
      const canonicalRoot = await canonicalizePath(expandUserPath(root));
      if (isSameOrDescendantPath(canonicalRoot, canonicalCwd)) return;
    }
    throw new Error(VIEWER_OUTSIDE_WORKSPACE_MESSAGE);
  }

  /** Error message when access is refused, otherwise null. */
  private async accessError(cwd: string, ...relativePaths: string[]): Promise<string | null> {
    try {
      await this.assertAccess(cwd, ...relativePaths);
      return null;
    } catch (error) {
      return getErrorMessage(error);
    }
  }

  async handleFileSubscribeRequest(request: FileSubscribeRequest): Promise<void> {
    this.fileSubscriptions.get(request.subscriptionId)?.();
    try {
      await this.assertAccess(request.cwd, request.path);
      const subscription = await this.fileObserver.subscribe(
        { cwd: request.cwd, path: request.path },
        (version) => {
          this.host.emit({
            type: "fs.file.update",
            payload: { subscriptionId: request.subscriptionId, version },
          });
        },
      );
      this.fileSubscriptions.set(request.subscriptionId, subscription.unsubscribe);
      this.host.emit({
        type: "fs.file.subscribe.response",
        payload: {
          subscriptionId: request.subscriptionId,
          initial: subscription.initial,
          requestId: request.requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "fs.file.subscribe.response",
        payload: {
          subscriptionId: request.subscriptionId,
          initial: {
            status: "error",
            cwd: request.cwd,
            path: request.path,
            error: getErrorMessage(error),
          },
          requestId: request.requestId,
        },
      });
    }
  }

  handleFileUnsubscribeRequest(request: FileUnsubscribeRequest): void {
    this.fileSubscriptions.get(request.subscriptionId)?.();
    this.fileSubscriptions.delete(request.subscriptionId);
    this.host.emit({
      type: "fs.file.unsubscribe.response",
      payload: {
        subscriptionId: request.subscriptionId,
        requestId: request.requestId,
      },
    });
  }

  async handleFileWriteRequest(request: FileWriteRequest): Promise<void> {
    const denied = await this.accessError(request.cwd, request.path);
    const result: Awaited<ReturnType<typeof writeExplorerFile>> = denied
      ? { status: "error", error: denied }
      : await writeExplorerFile({
          root: request.cwd,
          relativePath: request.path,
          content: request.content,
          expectedModifiedAt: request.expectedModifiedAt,
          expectedRevision: request.expectedRevision,
        });
    this.host.emit({
      type: "fs.file.write.response",
      payload: { result, requestId: request.requestId },
    });
  }

  async handleFileEntryCreateRequest(request: FileEntryCreateRequest): Promise<void> {
    const denied = await this.accessError(
      request.cwd,
      request.parentPath,
      `${request.parentPath}/${request.name}`,
    );
    const result: Awaited<ReturnType<typeof createExplorerEntry>> = denied
      ? { status: "error", error: denied }
      : await createExplorerEntry({
          root: request.cwd,
          parentPath: request.parentPath,
          name: request.name,
          kind: request.kind,
        });
    this.host.emit({
      type: "fs.entry.create.response",
      payload: {
        cwd: request.cwd,
        parentPath: request.parentPath,
        path: result.status === "ok" ? result.path : null,
        success: result.status === "ok",
        error: result.status === "ok" ? null : result.error,
        requestId: request.requestId,
      },
    });
  }

  async handleFileEntryRenameRequest(request: FileEntryRenameRequest): Promise<void> {
    const denied = await this.accessError(request.cwd, request.path);
    const result: Awaited<ReturnType<typeof renameExplorerEntry>> = denied
      ? { status: "error", error: denied }
      : await renameExplorerEntry({
          root: request.cwd,
          relativePath: request.path,
          name: request.name,
        });
    this.host.emit({
      type: "fs.entry.rename.response",
      payload: {
        cwd: request.cwd,
        path: request.path,
        renamedPath: result.status === "ok" ? result.path : null,
        success: result.status === "ok",
        error: result.status === "ok" ? null : result.error,
        requestId: request.requestId,
      },
    });
  }

  async handleFileEntryDuplicateRequest(request: FileEntryDuplicateRequest): Promise<void> {
    const denied = await this.accessError(request.cwd, request.path);
    const result: Awaited<ReturnType<typeof duplicateExplorerEntry>> = denied
      ? { status: "error", error: denied }
      : await duplicateExplorerEntry({
          root: request.cwd,
          relativePath: request.path,
        });
    this.host.emit({
      type: "fs.entry.duplicate.response",
      payload: {
        cwd: request.cwd,
        path: request.path,
        duplicatedPath: result.status === "ok" ? result.path : null,
        success: result.status === "ok",
        error: result.status === "ok" ? null : result.error,
        requestId: request.requestId,
      },
    });
  }

  async handleFileEntryDeleteRequest(request: FileEntryDeleteRequest): Promise<void> {
    const denied = await this.accessError(request.cwd, request.path);
    const result: Awaited<ReturnType<typeof deleteExplorerEntry>> = denied
      ? { status: "error", error: denied }
      : await deleteExplorerEntry({
          root: request.cwd,
          relativePath: request.path,
        });
    this.host.emit({
      type: "fs.entry.delete.response",
      payload: {
        cwd: request.cwd,
        path: request.path,
        success: result.status === "ok",
        error: result.status === "ok" ? null : result.error,
        requestId: request.requestId,
      },
    });
  }

  dispose(): void {
    for (const unsubscribe of this.fileSubscriptions.values()) unsubscribe();
    this.fileSubscriptions.clear();
  }

  async handleFileExplorerRequest(request: FileExplorerRequest, source?: object): Promise<void> {
    const { cwd: workspaceCwd, path: requestedPath = ".", mode, requestId } = request;
    const cwd = workspaceCwd.trim();
    if (!cwd) {
      this.host.emit(
        {
          type: "file_explorer_response",
          payload: {
            cwd: workspaceCwd,
            path: requestedPath,
            mode,
            directory: null,
            file: null,
            error: "cwd is required",
            requestId,
          },
        },
        source,
      );
      return;
    }

    try {
      await this.assertAccess(cwd, requestedPath);
      if (mode === "list") {
        const directory = await listDirectoryEntries({
          root: cwd,
          relativePath: requestedPath,
        });

        this.host.emit(
          {
            type: "file_explorer_response",
            payload: {
              cwd,
              path: directory.path,
              mode,
              directory,
              file: null,
              error: null,
              requestId,
            },
          },
          source,
        );
      } else {
        if (request.maxBytes) {
          const file = await getDownloadableFileInfo({
            root: cwd,
            relativePath: requestedPath,
          });
          if (file.size > request.maxBytes) {
            throw new Error("File is too large to display");
          }
        }
        if (request.acceptBinary && this.host.hasBinaryChannel()) {
          await streamExplorerFile({ root: cwd, relativePath: requestedPath }, async (file) => {
            await this.host.emitBinary(
              encodeFileTransferFrame({
                opcode: FileTransferOpcode.FileBegin,
                requestId,
                metadata: {
                  mime: file.mimeType,
                  size: file.size,
                  encoding: file.encoding,
                  modifiedAt: file.modifiedAt,
                  revision: file.revision,
                },
              }),
              source,
            );
            for await (const chunk of file.chunks) {
              await this.host.emitBinary(
                encodeFileTransferFrame({
                  opcode: FileTransferOpcode.FileChunk,
                  requestId,
                  payload: chunk,
                }),
                source,
              );
            }
            await this.host.emitBinary(
              encodeFileTransferFrame({
                opcode: FileTransferOpcode.FileEnd,
                requestId,
              }),
              source,
            );
          });
        } else {
          const file = await readExplorerFile({
            root: cwd,
            relativePath: requestedPath,
          });

          this.host.emit(
            {
              type: "file_explorer_response",
              payload: {
                cwd,
                path: file.path,
                mode,
                directory: null,
                file,
                error: null,
                requestId,
              },
            },
            source,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        { err: error, cwd, path: requestedPath },
        `Failed to fulfill file explorer request for workspace ${cwd}`,
      );
      this.host.emit(
        {
          type: "file_explorer_response",
          payload: {
            cwd,
            path: requestedPath,
            mode,
            directory: null,
            file: null,
            error: getErrorMessage(error),
            requestId,
          },
        },
        source,
      );
    }
  }

  handleFileUploadRequest(request: FileUploadRequest): void {
    this.fileUploads.beginUpload(request);
  }

  async handleFileTransferFrame(frame: FileTransferFrame): Promise<void> {
    const response = await this.fileUploads.receiveFrame(frame);
    if (response) {
      this.host.emit(response);
    }
  }

  async handleProjectIconRequest(
    request: Extract<SessionInboundMessage, { type: "project_icon_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = request;

    try {
      await this.assertAccess(cwd);
      const icon = await getProjectIcon(cwd);
      this.host.emit({
        type: "project_icon_response",
        payload: {
          cwd,
          icon,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "project_icon_response",
        payload: {
          cwd,
          icon: null,
          error: getErrorMessage(error),
          requestId,
        },
      });
    }
  }

  async handleFileDownloadTokenRequest(request: FileDownloadTokenRequest): Promise<void> {
    const { cwd: workspaceCwd, path: requestedPath, requestId } = request;
    const cwd = workspaceCwd.trim();
    if (!cwd) {
      this.host.emit({
        type: "file_download_token_response",
        payload: {
          cwd: workspaceCwd,
          path: requestedPath,
          token: null,
          fileName: null,
          mimeType: null,
          size: null,
          error: "cwd is required",
          requestId,
        },
      });
      return;
    }

    this.logger.debug(
      { cwd, path: requestedPath },
      `Handling file download token request for workspace ${cwd} (${requestedPath})`,
    );

    try {
      await this.assertAccess(cwd, requestedPath);
      const info = await getDownloadableFileInfo({
        root: cwd,
        relativePath: requestedPath,
      });

      const entry = this.downloadTokenStore.issueToken({
        path: info.path,
        absolutePath: info.absolutePath,
        fileName: info.fileName,
        mimeType: info.mimeType,
        size: info.size,
      });

      this.host.emit({
        type: "file_download_token_response",
        payload: {
          cwd,
          path: info.path,
          token: entry.token,
          fileName: entry.fileName,
          mimeType: entry.mimeType,
          size: entry.size,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.logger.error(
        { err: error, cwd, path: requestedPath },
        `Failed to issue download token for workspace ${cwd}`,
      );
      this.host.emit({
        type: "file_download_token_response",
        payload: {
          cwd,
          path: requestedPath,
          token: null,
          fileName: null,
          mimeType: null,
          size: null,
          error: getErrorMessage(error),
          requestId,
        },
      });
    }
  }
}
