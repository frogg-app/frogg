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

/** Open viewer tabs, in order. The active one is ui-store's `filePath`. */
export const useFileTabs = create<{ tabs: string[] }>(() => ({ tabs: [] }));
export const addTab = (path: string) =>
  useFileTabs.setState((s) => (s.tabs.includes(path) ? s : { tabs: [...s.tabs, path] }));
export const closeTabs = (paths: string[]) =>
  useFileTabs.setState((s) => ({ tabs: s.tabs.filter((p) => !paths.includes(p)) }));
onHostSwitch(() => useFileTabs.setState({ tabs: [] }));

// Tabs belong to a checkout; relative paths must not leak into the next root.
useFiles.subscribe((next, previous) => {
  if (next.root !== previous.root) useFileTabs.setState({ tabs: [] });
});
