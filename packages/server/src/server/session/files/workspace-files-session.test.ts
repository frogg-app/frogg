import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import pino from "pino";
import {
  decodeFileTransferFrame,
  encodeFileTransferFrame,
  FileTransferOpcode,
  type FileTransferFrame,
} from "@frogg/protocol/binary-frames/index";
import {
  WorkspaceFilesSession,
  type WorkspaceFilesSessionHost,
} from "./workspace-files-session.js";
import { DownloadTokenStore } from "../../file-download/token-store.js";
import type { SessionOutboundMessage } from "../../messages.js";
import type { DeviceRole } from "../../authorization/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

function makeSubsystem(
  options: {
    hasBinaryChannel?: boolean;
    emitBinary?: (frame: Uint8Array) => Promise<void> | void;
    role?: DeviceRole;
    workspaceRoots?: string[];
  } = {},
) {
  const emitted: SessionOutboundMessage[] = [];
  const binary: Uint8Array[] = [];
  let hasBinary = options.hasBinaryChannel ?? false;
  const host: WorkspaceFilesSessionHost = {
    emit: (msg) => emitted.push(msg),
    emitBinary: async (frame) => {
      binary.push(frame);
      await options.emitBinary?.(frame);
    },
    hasBinaryChannel: () => hasBinary,
  };
  const froggHome = makeDir("workspace-files-home-");
  const subsystem = new WorkspaceFilesSession({
    host,
    downloadTokenStore: new DownloadTokenStore({ ttlMs: 60_000 }),
    froggHome,
    logger: pino({ level: "silent" }),
    getRole: () => options.role ?? "owner",
    listWorkspaceRoots: async () => options.workspaceRoots ?? [],
  });
  return {
    subsystem,
    emitted,
    binary,
    froggHome,
    setHasBinary: (value: boolean) => {
      hasBinary = value;
    },
  };
}

function uploadFrame(args: Parameters<typeof encodeFileTransferFrame>[0]): FileTransferFrame {
  const frame = decodeFileTransferFrame(encodeFileTransferFrame(args));
  if (!frame) {
    throw new Error("Expected a file transfer frame");
  }
  return frame;
}

describe("WorkspaceFilesSession", () => {
  test("creates an entry and emits the complete success response", async () => {
    const cwd = makeDir("workspace-files-create-");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileEntryCreateRequest({
      type: "fs.entry.create.request",
      cwd,
      parentPath: ".",
      name: "notes.txt",
      kind: "file",
      requestId: "req-create",
    });

    expect(existsSync(join(cwd, "notes.txt"))).toBe(true);
    expect(emitted).toEqual([
      {
        type: "fs.entry.create.response",
        payload: {
          cwd,
          parentPath: ".",
          path: "notes.txt",
          success: true,
          error: null,
          requestId: "req-create",
        },
      },
    ]);
  });

  test("passes entry creation errors through in the response", async () => {
    const cwd = makeDir("workspace-files-create-error-");
    writeFileSync(join(cwd, "notes.txt"), "existing");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileEntryCreateRequest({
      type: "fs.entry.create.request",
      cwd,
      parentPath: ".",
      name: "notes.txt",
      kind: "file",
      requestId: "req-create-error",
    });

    expect(emitted).toEqual([
      {
        type: "fs.entry.create.response",
        payload: {
          cwd,
          parentPath: ".",
          path: null,
          success: false,
          error: '"notes.txt" already exists',
          requestId: "req-create-error",
        },
      },
    ]);
  });

  test("renames an entry and emits the resulting path", async () => {
    const cwd = makeDir("workspace-files-rename-");
    writeFileSync(join(cwd, "notes.txt"), "rename me");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileEntryRenameRequest({
      type: "fs.entry.rename.request",
      cwd,
      path: "notes.txt",
      name: "renamed.txt",
      requestId: "req-rename",
    });

    expect(existsSync(join(cwd, "notes.txt"))).toBe(false);
    expect(existsSync(join(cwd, "renamed.txt"))).toBe(true);
    expect(emitted).toEqual([
      {
        type: "fs.entry.rename.response",
        payload: {
          cwd,
          path: "notes.txt",
          renamedPath: "renamed.txt",
          success: true,
          error: null,
          requestId: "req-rename",
        },
      },
    ]);
  });

  test("passes entry rename errors through in the response", async () => {
    const cwd = makeDir("workspace-files-rename-error-");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileEntryRenameRequest({
      type: "fs.entry.rename.request",
      cwd,
      path: "missing.txt",
      name: "renamed.txt",
      requestId: "req-rename-error",
    });

    expect(emitted).toEqual([
      {
        type: "fs.entry.rename.response",
        payload: {
          cwd,
          path: "missing.txt",
          renamedPath: null,
          success: false,
          error: "File or folder no longer exists",
          requestId: "req-rename-error",
        },
      },
    ]);
  });

  test("duplicates an entry and emits the resulting path", async () => {
    const cwd = makeDir("workspace-files-duplicate-");
    writeFileSync(join(cwd, "notes.txt"), "duplicate me");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileEntryDuplicateRequest({
      type: "fs.entry.duplicate.request",
      cwd,
      path: "notes.txt",
      requestId: "req-duplicate",
    });

    expect(readFileSync(join(cwd, "notes copy.txt"), "utf8")).toBe("duplicate me");
    expect(emitted).toEqual([
      {
        type: "fs.entry.duplicate.response",
        payload: {
          cwd,
          path: "notes.txt",
          duplicatedPath: "notes copy.txt",
          success: true,
          error: null,
          requestId: "req-duplicate",
        },
      },
    ]);
  });

  test("passes entry duplication errors through in the response", async () => {
    const cwd = makeDir("workspace-files-duplicate-error-");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileEntryDuplicateRequest({
      type: "fs.entry.duplicate.request",
      cwd,
      path: "missing.txt",
      requestId: "req-duplicate-error",
    });

    expect(emitted).toEqual([
      {
        type: "fs.entry.duplicate.response",
        payload: {
          cwd,
          path: "missing.txt",
          duplicatedPath: null,
          success: false,
          error: "File or folder no longer exists",
          requestId: "req-duplicate-error",
        },
      },
    ]);
  });

  test("deletes an entry and emits the complete success response", async () => {
    const cwd = makeDir("workspace-files-delete-");
    writeFileSync(join(cwd, "notes.txt"), "delete me");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileEntryDeleteRequest({
      type: "fs.entry.delete.request",
      cwd,
      path: "notes.txt",
      requestId: "req-delete",
    });

    expect(existsSync(join(cwd, "notes.txt"))).toBe(false);
    expect(emitted).toEqual([
      {
        type: "fs.entry.delete.response",
        payload: {
          cwd,
          path: "notes.txt",
          success: true,
          error: null,
          requestId: "req-delete",
        },
      },
    ]);
  });

  test("passes entry deletion errors through in the response", async () => {
    const cwd = makeDir("workspace-files-delete-error-");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileEntryDeleteRequest({
      type: "fs.entry.delete.request",
      cwd,
      path: "missing.txt",
      requestId: "req-delete-error",
    });

    expect(emitted).toEqual([
      {
        type: "fs.entry.delete.response",
        payload: {
          cwd,
          path: "missing.txt",
          success: false,
          error: "File or folder no longer exists",
          requestId: "req-delete-error",
        },
      },
    ]);
  });

  test("lists directory entries", async () => {
    const cwd = makeDir("workspace-files-list-");
    writeFileSync(join(cwd, "a.txt"), "alpha");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: ".",
      mode: "list",
      requestId: "req-list",
    });

    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "file_explorer_response") {
      throw new Error(`expected file_explorer_response, got ${message.type}`);
    }
    expect(message.payload.error).toBeNull();
    expect(message.payload.directory).not.toBeNull();
  });

  test("reads file content inline when the client has no binary channel", async () => {
    const cwd = makeDir("workspace-files-read-");
    writeFileSync(join(cwd, "notes.txt"), "hello world");
    const { subsystem, emitted, binary } = makeSubsystem({ hasBinaryChannel: false });

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: "notes.txt",
      mode: "file",
      requestId: "req-read",
      acceptBinary: true,
    });

    expect(binary).toEqual([]);
    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "file_explorer_response") {
      throw new Error(`expected file_explorer_response, got ${message.type}`);
    }
    expect(message.payload.error).toBeNull();
    expect(message.payload.file).not.toBeNull();
  });

  test("streams binary frames when the client accepts binary and has a channel", async () => {
    const cwd = makeDir("workspace-files-binary-");
    writeFileSync(join(cwd, "notes.txt"), "hello world");
    const { subsystem, emitted, binary } = makeSubsystem({ hasBinaryChannel: true });

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: "notes.txt",
      mode: "file",
      requestId: "req-binary",
      acceptBinary: true,
    });

    expect(emitted).toEqual([]);
    expect(binary).toHaveLength(3);
    const opcodes = binary.map((frame) => decodeFileTransferFrame(frame)?.opcode);
    expect(opcodes).toEqual([
      FileTransferOpcode.FileBegin,
      FileTransferOpcode.FileChunk,
      FileTransferOpcode.FileEnd,
    ]);
  });

  test("rejects an over-budget file before opening a binary transfer", async () => {
    const cwd = makeDir("workspace-files-read-budget-");
    writeFileSync(join(cwd, "notes.txt"), "hello world");
    const { subsystem, emitted, binary } = makeSubsystem({ hasBinaryChannel: true });

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: "notes.txt",
      mode: "file",
      requestId: "req-read-budget",
      acceptBinary: true,
      maxBytes: 5,
    });

    expect(binary).toEqual([]);
    expect(emitted).toEqual([
      expect.objectContaining({
        type: "file_explorer_response",
        payload: expect.objectContaining({ error: "File is too large to display" }),
      }),
    ]);
  });

  test("streams a real file larger than the socket limit as paced ordered chunks", async () => {
    const cwd = makeDir("workspace-files-large-binary-");
    const fileBytes = Buffer.alloc(8 * 1024 * 1024 + 123);
    for (let index = 0; index < fileBytes.length; index += 1) {
      fileBytes[index] = index % 251;
    }
    writeFileSync(join(cwd, "large.bin"), fileBytes);

    let releaseFirstChunk: (() => void) | undefined;
    const firstChunkSent = new Promise<void>((resolve) => {
      releaseFirstChunk = resolve;
    });
    let chunkSends = 0;
    const { subsystem, emitted, binary } = makeSubsystem({
      hasBinaryChannel: true,
      emitBinary: async (frame) => {
        if (decodeFileTransferFrame(frame)?.opcode !== FileTransferOpcode.FileChunk) return;
        chunkSends += 1;
        if (chunkSends === 1) await firstChunkSent;
      },
    });

    const transfer = subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: "large.bin",
      mode: "file",
      requestId: "req-large-binary",
      acceptBinary: true,
    });

    await expect.poll(() => chunkSends).toBe(1);
    expect(binary.map((frame) => decodeFileTransferFrame(frame)?.opcode)).toEqual([
      FileTransferOpcode.FileBegin,
      FileTransferOpcode.FileChunk,
    ]);

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: ".",
      mode: "list",
      requestId: "req-unrelated-list",
    });
    expect(emitted).toEqual([
      expect.objectContaining({
        type: "file_explorer_response",
        payload: expect.objectContaining({ requestId: "req-unrelated-list", error: null }),
      }),
    ]);

    releaseFirstChunk?.();
    await transfer;

    const frames = binary.map((frame) => decodeFileTransferFrame(frame));
    const chunks = frames.flatMap((frame) =>
      frame?.opcode === FileTransferOpcode.FileChunk ? [frame.payload] : [],
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.byteLength <= 256 * 1024)).toBe(true);
    expect(
      Buffer.compare(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), fileBytes),
    ).toBe(0);
    expect(frames.at(0)?.opcode).toBe(FileTransferOpcode.FileBegin);
    expect(frames.at(-1)?.opcode).toBe(FileTransferOpcode.FileEnd);
    expect(emitted).toHaveLength(1);
  }, 30_000);

  test("rejects an empty file-explorer cwd with an error envelope", async () => {
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd: "  ",
      path: ".",
      mode: "list",
      requestId: "req-empty",
    });

    expect(emitted).toEqual([
      {
        type: "file_explorer_response",
        payload: expect.objectContaining({
          error: "cwd is required",
          directory: null,
          file: null,
          requestId: "req-empty",
        }),
      },
    ]);
  });

  test("issues a download token for a real file", async () => {
    const cwd = makeDir("workspace-files-token-");
    writeFileSync(join(cwd, "report.txt"), "hello world");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileDownloadTokenRequest({
      type: "file_download_token_request",
      cwd,
      path: "report.txt",
      requestId: "req-token",
    });

    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "file_download_token_response") {
      throw new Error(`expected file_download_token_response, got ${message.type}`);
    }
    expect(message.payload.error).toBeNull();
    expect(typeof message.payload.token).toBe("string");
    expect(message.payload.fileName).toBe("report.txt");
    expect(message.payload.size).toBe(11);
  });

  test("rejects an empty download-token cwd with an error envelope", async () => {
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileDownloadTokenRequest({
      type: "file_download_token_request",
      cwd: "",
      path: "report.txt",
      requestId: "req-token-empty",
    });

    expect(emitted).toEqual([
      {
        type: "file_download_token_response",
        payload: expect.objectContaining({
          token: null,
          error: "cwd is required",
          requestId: "req-token-empty",
        }),
      },
    ]);
  });

  test("responds to a project icon request", async () => {
    const cwd = makeDir("workspace-files-icon-");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleProjectIconRequest({
      type: "project_icon_request",
      cwd,
      requestId: "req-icon",
    });

    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "project_icon_response") {
      throw new Error(`expected project_icon_response, got ${message.type}`);
    }
    expect(message.payload.cwd).toBe(cwd);
    expect(message.payload.error).toBeNull();
  });

  test("round-trips an upload through transfer frames", async () => {
    const { subsystem, emitted, froggHome } = makeSubsystem();

    subsystem.handleFileUploadRequest({
      type: "file.upload.request",
      fileName: "notes.txt",
      mimeType: "text/plain",
      size: 11,
      modifiedAt: "2026-05-02T00:00:00.000Z",
      requestId: "req-upload",
    });
    await subsystem.handleFileTransferFrame(
      uploadFrame({
        opcode: FileTransferOpcode.FileBegin,
        requestId: "req-upload",
        metadata: {
          mime: "text/plain",
          size: 11,
          encoding: "binary",
          modifiedAt: "2026-05-02T00:00:00.000Z",
          fileName: "notes.txt",
        },
      }),
    );
    await subsystem.handleFileTransferFrame(
      uploadFrame({
        opcode: FileTransferOpcode.FileChunk,
        requestId: "req-upload",
        payload: new TextEncoder().encode("hello world"),
      }),
    );
    await subsystem.handleFileTransferFrame(
      uploadFrame({ opcode: FileTransferOpcode.FileEnd, requestId: "req-upload" }),
    );

    const message = emitted.find((entry) => entry.type === "file.upload.response");
    if (message?.type !== "file.upload.response") {
      throw new Error("expected a file.upload.response message");
    }
    expect(message.payload.error).toBeNull();
    expect(message.payload.file?.fileName).toBe("notes.txt");
    expect(readFileSync(join(froggHome, "uploads", "upload_req-upload", "notes.txt"), "utf8")).toBe(
      "hello world",
    );
  });
});

function errorOf(message: SessionOutboundMessage | undefined): unknown {
  return (message?.payload as { error?: unknown } | undefined)?.error;
}

describe("WorkspaceFilesSession daemon-home deny", () => {
  const DENIED = "Access to the daemon home is not allowed";

  test("refuses listing the daemon home or reading inside it", async () => {
    const { subsystem, emitted, froggHome } = makeSubsystem();
    writeFileSync(join(froggHome, "daemon-keypair.json"), "{}");

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd: froggHome,
      path: ".",
      mode: "list",
      requestId: "req-list-home",
    });
    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd: dirname(froggHome),
      path: `${basename(froggHome)}/daemon-keypair.json`,
      mode: "file",
      requestId: "req-read-key",
    });

    expect(emitted.map(errorOf)).toEqual([DENIED, DENIED]);
  });

  test("refuses a keypair download token", async () => {
    const { subsystem, emitted, froggHome } = makeSubsystem();
    writeFileSync(join(froggHome, "daemon-keypair.json"), "{}");

    await subsystem.handleFileDownloadTokenRequest({
      type: "file_download_token_request",
      cwd: froggHome,
      path: "daemon-keypair.json",
      requestId: "req-token-key",
    });

    expect(emitted).toEqual([
      {
        type: "file_download_token_response",
        payload: expect.objectContaining({ token: null, error: DENIED }),
      },
    ]);
  });

  test("refuses a write to principals.json", async () => {
    const { subsystem, emitted, froggHome } = makeSubsystem();
    writeFileSync(join(froggHome, "principals.json"), "{}");

    await subsystem.handleFileWriteRequest({
      type: "fs.file.write.request",
      cwd: froggHome,
      path: "principals.json",
      content: '{"owner":"me"}',
      requestId: "req-write-principals",
    });

    expect(readFileSync(join(froggHome, "principals.json"), "utf8")).toBe("{}");
    expect(emitted).toEqual([
      {
        type: "fs.file.write.response",
        payload: { result: { status: "error", error: DENIED }, requestId: "req-write-principals" },
      },
    ]);
  });

  test("refuses a workspace symlink that points into the daemon home", async () => {
    const cwd = makeDir("workspace-files-symlink-");
    const { subsystem, emitted, froggHome } = makeSubsystem();
    writeFileSync(join(froggHome, "local-token"), "secret");
    symlinkSync(froggHome, join(cwd, "home-link"));
    symlinkSync(join(froggHome, "local-token"), join(cwd, "token-link"));

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: "token-link",
      mode: "file",
      requestId: "req-file-link",
    });
    await subsystem.handleFileEntryCreateRequest({
      type: "fs.entry.create.request",
      cwd,
      parentPath: "home-link",
      name: "planted.txt",
      kind: "file",
      requestId: "req-create-link",
    });

    expect(emitted.map(errorOf)).toEqual([DENIED, DENIED]);
    expect(existsSync(join(froggHome, "planted.txt"))).toBe(false);
  });

  test("allows Frogg-owned worktrees under the daemon home", async () => {
    const { subsystem, emitted, froggHome } = makeSubsystem();
    const worktree = join(froggHome, "worktrees", "repo", "wt");
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, "README.md"), "hi");

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd: worktree,
      path: "README.md",
      mode: "file",
      requestId: "req-worktree",
    });

    expect(errorOf(emitted[0])).toBeNull();
  });
});

describe("WorkspaceFilesSession viewer workspace roots", () => {
  const OUTSIDE = "Viewers can only access files inside a registered workspace";

  async function list(subsystem: WorkspaceFilesSession, cwd: string, path = ".") {
    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path,
      mode: "list",
      requestId: `req-${cwd}`,
    });
  }

  test("refuses ~ and / for a viewer", async () => {
    const workspace = makeDir("workspace-files-viewer-");
    const { subsystem, emitted } = makeSubsystem({ role: "viewer", workspaceRoots: [workspace] });

    await list(subsystem, "~");
    await list(subsystem, "/");

    expect(emitted.map(errorOf)).toEqual([OUTSIDE, OUTSIDE]);
  });

  test("allows a viewer inside a registered workspace and its subdirectories", async () => {
    const workspace = makeDir("workspace-files-viewer-");
    mkdirSync(join(workspace, "src"));
    writeFileSync(join(workspace, "src", "a.ts"), "x");
    const { subsystem, emitted } = makeSubsystem({ role: "viewer", workspaceRoots: [workspace] });

    await list(subsystem, workspace);
    await list(subsystem, join(workspace, "src"));

    expect(emitted.map(errorOf)).toEqual([null, null]);
  });

  test("refuses a viewer download token outside workspaces", async () => {
    const workspace = makeDir("workspace-files-viewer-");
    const outside = makeDir("workspace-files-outside-");
    writeFileSync(join(outside, "id_rsa"), "key");
    const { subsystem, emitted } = makeSubsystem({ role: "viewer", workspaceRoots: [workspace] });

    await subsystem.handleFileDownloadTokenRequest({
      type: "file_download_token_request",
      cwd: outside,
      path: "id_rsa",
      requestId: "req-viewer-token",
    });

    expect(errorOf(emitted[0])).toBe(OUTSIDE);
  });

  test("refuses a viewer cwd that symlinks out of a workspace", async () => {
    const workspace = makeDir("workspace-files-viewer-");
    const outside = makeDir("workspace-files-outside-");
    symlinkSync(outside, join(workspace, "escape"));
    const { subsystem, emitted } = makeSubsystem({ role: "viewer", workspaceRoots: [workspace] });

    await list(subsystem, join(workspace, "escape"));

    expect(errorOf(emitted[0])).toBe(OUTSIDE);
  });

  test("roots a viewer's directory search in a workspace", async () => {
    const workspace = makeDir("workspace-files-viewer-");
    const outside = makeDir("workspace-files-outside-");
    const { subsystem } = makeSubsystem({ role: "viewer", workspaceRoots: [workspace] });

    await expect(subsystem.assertViewerSearchRoot(undefined)).rejects.toThrow(OUTSIDE);
    await expect(subsystem.assertViewerSearchRoot("  ")).rejects.toThrow(OUTSIDE);
    await expect(subsystem.assertViewerSearchRoot(outside)).rejects.toThrow(OUTSIDE);
    await expect(subsystem.assertViewerSearchRoot(workspace)).resolves.toBeUndefined();
  });

  test.each(["owner", "operator"] as const)("leaves %s search unrooted", async (role) => {
    const { subsystem } = makeSubsystem({ role, workspaceRoots: [] });

    await expect(subsystem.assertViewerSearchRoot(undefined)).resolves.toBeUndefined();
  });

  test.each(["owner", "operator"] as const)("leaves %s unconfined", async (role) => {
    const outside = makeDir("workspace-files-outside-");
    const { subsystem, emitted } = makeSubsystem({ role, workspaceRoots: [] });

    await list(subsystem, outside);

    expect(errorOf(emitted[0])).toBeNull();
  });
});
