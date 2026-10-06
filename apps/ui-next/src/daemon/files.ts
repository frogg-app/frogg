import { create } from "zustand";
import { getClient } from "./store";

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

export const useFiles = create<FilesState>(() => ({ root: null, dirs: {}, expanded: { ".": true } }));

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
    const entries = [...dir.entries].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1));
    useFiles.setState((s) => ({ dirs: { ...s.dirs, [path]: entries } }));
  } catch (e) {
    useFiles.setState((s) => ({ dirs: { ...s.dirs, [path]: { error: e instanceof Error ? e.message : String(e) } } }));
  }
}

export function toggleDir(path: string): void {
  const open = !useFiles.getState().expanded[path];
  useFiles.setState((s) => ({ expanded: { ...s.expanded, [path]: open } }));
  if (open && !useFiles.getState().dirs[path]) void loadDir(path);
}

export async function readText(path: string): Promise<{ text: string | null; kind: string; size: number }> {
  const { root } = useFiles.getState();
  const client = getClient();
  if (!root || !client) throw new Error("not connected");
  const res = await client.readFile(root, path, undefined, 1_000_000);
  return { text: res.kind === "text" ? new TextDecoder().decode(res.bytes) : null, kind: res.kind, size: res.size };
}
