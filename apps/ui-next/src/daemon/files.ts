import { create } from "zustand";
import { getClient, onHostSwitch } from "./store";

export interface Entry {
  name: string;
  path: string;
  kind: "file" | "directory";
  size: number;
  modifiedAt: string;
}

interface FilesState {
  root: string | null;
  dirs: Record<string, Entry[] | "loading" | { error: string }>;
  expanded: Record<string, boolean>;
}

export const useFiles = create<FilesState>(() => ({
  root: null,
  dirs: {},
  expanded: { ".": true },
}));

export async function setRoot(root: string): Promise<void> {
  if (useFiles.getState().root === root) return;
  useFiles.setState({ root, dirs: {}, expanded: { ".": true } });
  await loadDir(".");
}

export async function loadDir(path: string): Promise<void> {
  const { root } = useFiles.getState();
  const client = getClient();
  if (!root || !client) return;
  useFiles.setState((s) => ({ dirs: { ...s.dirs, [path]: "loading" } }));
  try {
    const dir = await client.listDirectory(root, path);
    const entries = [...dir.entries].sort((a, b) =>
      a.kind === b.kind
        ? a.name.localeCompare(b.name)
        : Number(b.kind === "directory") - Number(a.kind === "directory"),
    );
    useFiles.setState((s) => ({ dirs: { ...s.dirs, [path]: entries } }));
  } catch (e) {
    useFiles.setState((s) => ({
      dirs: {
        ...s.dirs,
        [path]: { error: e instanceof Error ? e.message : String(e) },
      },
    }));
  }
}

// ---- Typed paths -------------------------------------------------------------------------------

/**
 * A folder typed into the Files tab. While set it replaces the session's checkout as the tree's
 * root; clearing it goes back to the checkout.
 */
export const useBrowseRoot = create<{ path: string | null }>(() => ({ path: null }));
onHostSwitch(() => useBrowseRoot.setState({ path: null }));

const isAbsolute = (p: string) =>
  p.startsWith("/") || p.startsWith("~") || /^[A-Za-z]:([\\/]|$)/.test(p) || p.startsWith("\\\\");

/**
 * Turns what was typed into a path the host can list: absolute, home-relative (`~`, `~/x`) and
 * Windows (`C:/Users`, `C:\Users`, `\\server\share`) paths are kept; anything else is relative
 * to the current root. Trailing separators are dropped, except on a bare root.
 */
export function resolveTypedPath(input: string, root: string | null): string | null {
  let p = input.trim().replace(/^["']|["']$/g, "");
  if (!p) return null;
  if (!isAbsolute(p)) {
    if (!root) return null;
    p = `${root.replace(/[\\/]+$/, "")}/${p.replace(/^\.\//, "")}`;
  }
  const trimmed = p.replace(/[\\/]+$/, "");
  if (!trimmed) return "/";
  if (/^[A-Za-z]:$/.test(trimmed)) return `${trimmed}/`;
  return trimmed;
}

const splitParent = (abs: string): [string, string] | null => {
  const i = Math.max(abs.lastIndexOf("/"), abs.lastIndexOf("\\"));
  if (i < 0 || i === abs.length - 1) return null;
  const parent = i === 0 ? "/" : abs.slice(0, i);
  return [/^[A-Za-z]:$/.test(parent) ? `${parent}/` : parent, abs.slice(i + 1)];
};

/**
 * Points the Files tab at a typed path. A folder becomes the root; a file roots the tree at its
 * folder and is returned so the caller can open it. Returns an error message when it can't.
 */
export async function jumpToPath(
  input: string,
): Promise<{ ok: true; file: string | null } | { ok: false; error: string }> {
  const client = getClient();
  if (!client) return { ok: false, error: "not connected" };
  const abs = resolveTypedPath(input, useFiles.getState().root);
  if (!abs) return { ok: false, error: "Type a folder path, like ~/projects or C:/Users" };
  try {
    const dir = await client.listDirectory(abs, ".");
    const root = dir.absolutePath || abs;
    useBrowseRoot.setState({ path: root });
    await setRoot(root);
    return { ok: true, file: null };
  } catch (e) {
    const parts = splitParent(abs);
    if (parts) {
      const parent = await client.listDirectory(parts[0], ".").catch(() => null);
      if (parent?.entries.some((x) => x.name === parts[1] && x.kind === "file")) {
        const root = parent.absolutePath || parts[0];
        useBrowseRoot.setState({ path: root });
        await setRoot(root);
        return { ok: true, file: parts[1] };
      }
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (/ENOENT|no such file/i.test(msg)) return { ok: false, error: `Nothing at ${abs}` };
    if (/ENOTDIR/i.test(msg)) return { ok: false, error: `${abs} is not a folder` };
    if (/EACCES|EPERM/i.test(msg)) return { ok: false, error: `No permission to open ${abs}` };
    return { ok: false, error: msg };
  }
}

export function toggleDir(path: string): void {
  const open = !useFiles.getState().expanded[path];
  useFiles.setState((s) => ({ expanded: { ...s.expanded, [path]: open } }));
  if (open && !useFiles.getState().dirs[path]) void loadDir(path);
}

export async function readText(
  path: string,
): Promise<{ text: string | null; kind: string; size: number }> {
  const { root } = useFiles.getState();
  const client = getClient();
  if (!root || !client) throw new Error("not connected");
  const res = await client.readFile(root, path, undefined, 1_000_000);
  return {
    text: res.kind === "text" ? new TextDecoder().decode(res.bytes) : null,
    kind: res.kind,
    size: res.size,
  };
}

onHostSwitch(() => useFiles.setState({ root: null, dirs: {}, expanded: { ".": true } }));

// ---- Editing, tree actions and open tabs -----------------------------------------------------

export interface FileDoc {
  text: string | null;
  kind: string;
  size: number;
  modifiedAt: string;
  revision?: string;
}

/** Read a file with the version stamp a later `saveText` needs to detect conflicts. */
export async function readDoc(path: string): Promise<FileDoc> {
  const { root } = useFiles.getState();
  const client = getClient();
  if (!root || !client) throw new Error("not connected");
  const res = await client.readFile(root, path, undefined, 1_000_000);
  return {
    text:
      res.kind === "text" && res.bytes.length >= res.size
        ? new TextDecoder().decode(res.bytes)
        : null,
    kind: res.kind,
    size: res.size,
    modifiedAt: res.modifiedAt,
    revision: res.revision,
  };
}

/** Write a text file; "conflict" means it changed on disk since `doc` was read. */
export async function saveText(
  path: string,
  content: string,
  doc: FileDoc,
): Promise<{ ok: true; doc: FileDoc } | { ok: false; error: string }> {
  const { root } = useFiles.getState();
  const client = getClient();
  if (!root || !client) return { ok: false, error: "not connected" };
  const res = await client.writeFile({
    cwd: root,
    path,
    content,
    expectedModifiedAt: doc.modifiedAt,
    expectedRevision: doc.revision,
  });
  if (res.status === "written")
    return {
      ok: true,
      doc: {
        ...doc,
        text: content,
        size: res.size,
        modifiedAt: res.modifiedAt,
        revision: res.revision,
      },
    };
  if (res.status === "conflict")
    return { ok: false, error: "The file changed on disk. Reload it first." };
  return { ok: false, error: res.error };
}

const parentOf = (path: string) => {
  const i = path.lastIndexOf("/");
  return i < 0 ? "." : path.slice(0, i);
};

async function entryOp(
  parent: string,
  fn: (
    root: string,
    client: NonNullable<ReturnType<typeof getClient>>,
  ) => Promise<{
    success?: boolean;
    error?: string | null;
  }>,
): Promise<string | null> {
  const { root } = useFiles.getState();
  const client = getClient();
  if (!root || !client) return "not connected";
  try {
    const res = await fn(root, client);
    await loadDir(parent);
    return res.error ?? (res.success === false ? "failed" : null);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export const createEntry = (parentPath: string, name: string, kind: "file" | "directory") =>
  entryOp(parentPath, (cwd, c) => c.createFileEntry({ cwd, parentPath, name, kind }));
export const renameEntry = (path: string, name: string) =>
  entryOp(parentOf(path), (cwd, c) => c.renameFileEntry({ cwd, path, name }));
export const duplicateEntry = (path: string) =>
  entryOp(parentOf(path), (cwd, c) => c.duplicateFileEntry({ cwd, path }));
export const deleteEntry = (path: string) =>
  entryOp(parentOf(path), (cwd, c) => c.deleteFileEntry({ cwd, path }));
export const fileParent = parentOf;

/**
 * Open viewer tabs, in order. The active one is ui-store's `filePath`. `preview` is the one tab
 * a single click opened: the next single click reuses its slot instead of adding a tab.
 */
export const useFileTabs = create<{ tabs: string[]; preview: string | null }>(() => ({
  tabs: [],
  preview: null,
}));
/** Opens `path` as a kept (pinned) tab. */
export const addTab = (path: string) =>
  useFileTabs.setState((s) => ({
    tabs: s.tabs.includes(path) ? s.tabs : [...s.tabs, path],
    preview: s.preview === path ? null : s.preview,
  }));
/** Opens `path` in the preview slot, replacing the previous preview (an already-open tab stays). */
export const previewTab = (path: string) =>
  useFileTabs.setState((s) => {
    if (s.tabs.includes(path)) return s;
    const at = s.preview ? s.tabs.indexOf(s.preview) : -1;
    const tabs = at < 0 ? [...s.tabs, path] : s.tabs.map((p, i) => (i === at ? path : p));
    return { tabs, preview: path };
  });
/** Keeps a preview tab open (editing it, double-clicking it, or ⋯ → Keep open). */
export const pinTab = (path: string) =>
  useFileTabs.setState((s) => (s.preview === path ? { preview: null } : s));
export const closeTabs = (paths: string[]) =>
  useFileTabs.setState((s) => ({
    tabs: s.tabs.filter((p) => !paths.includes(p)),
    preview: s.preview && paths.includes(s.preview) ? null : s.preview,
  }));
onHostSwitch(() => useFileTabs.setState({ tabs: [], preview: null }));

// Tabs belong to a checkout; relative paths must not leak into the next root.
useFiles.subscribe((next, previous) => {
  if (next.root !== previous.root) useFileTabs.setState({ tabs: [], preview: null });
});

// ---- Downloads -------------------------------------------------------------------------------

/** Whether the host can zip a folder for download (`fs.directory.zip`, daemon 1.6.14+). */
export const canZipFolders = (): boolean =>
  getClient()?.getLastServerInfoMessage()?.features?.directoryZip === true;

export interface Download {
  name: string;
  bytes: Uint8Array;
  mime: string;
  /** Folders: files packed, and what was left out (node_modules, .git, symlinks). */
  fileCount?: number;
  skipped?: string[];
}

/** Reads a file whole, or zips a folder, for saving on this device. */
export async function fetchDownload(path: string, kind: Entry["kind"]): Promise<Download> {
  const { root } = useFiles.getState();
  const client = getClient();
  if (!root || !client) throw new Error("not connected");
  const base = (path === "." ? root : path).split("/").pop() || "file";
  if (kind === "file") {
    const res = await client.readFile(root, path);
    return { name: base, bytes: res.bytes, mime: res.mime || "application/octet-stream" };
  }
  if (!canZipFolders()) throw new Error("Update the host's daemon to download folders.");
  const res = await client.zipDirectory({ cwd: root, path });
  if (res.error || !res.bytes) throw new Error(res.error ?? "The folder could not be zipped.");
  return {
    name: res.fileName ?? `${base}.zip`,
    bytes: res.bytes,
    mime: "application/zip",
    fileCount: res.fileCount ?? undefined,
    skipped: res.skipped,
  };
}
