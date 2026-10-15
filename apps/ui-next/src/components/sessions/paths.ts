// Host paths as the daemon reports them: POSIX ("/home/dev") or Windows ("C:\Users\dev").
// The app never runs on the host, so the separator comes from the path itself.

const DRIVE = /^[a-zA-Z]:(?:[\\/]|$)/;

export function isWindowsPath(p: string): boolean {
  return DRIVE.test(p) || p.startsWith("\\\\") || (p.includes("\\") && !p.includes("/"));
}

const sepOf = (p: string) => (isWindowsPath(p) ? "\\" : "/");
const trim = (p: string) => p.replace(/[\\/]+$/, "");

export function joinPath(dir: string, name: string): string {
  return `${trim(dir)}${sepOf(dir)}${name}`;
}

/** One level up; a filesystem or drive root is its own parent. */
export function parentDir(dir: string): string {
  const t = trim(dir);
  if (isWindowsPath(dir)) {
    if (/^[a-zA-Z]:$/.test(t)) return `${t}\\`;
    const i = Math.max(t.lastIndexOf("\\"), t.lastIndexOf("/"));
    if (i < 0) return dir;
    const up = t.slice(0, i);
    return /^[a-zA-Z]:$/.test(up) ? `${up}\\` : up;
  }
  const i = t.lastIndexOf("/");
  return i <= 0 ? "/" : t.slice(0, i);
}

/** Last path segment ("" for a root). */
export function baseName(p: string): string {
  const parts = trim(p).split(/[\\/]/);
  const last = parts[parts.length - 1] ?? "";
  return /^[a-zA-Z]:$/.test(last) ? "" : last;
}

/** Home folders shortened to ~ on POSIX and Windows. */
export function tildePath(p: string): string {
  return p.replace(/^\/(home|Users)\/[^/]+/, "~").replace(/^[a-zA-Z]:\\Users\\[^\\]+/i, "~");
}

/** A Windows drive root ("E:\", "E:/" or a bare "E:"). */
export function isDriveRoot(p: string): boolean {
  return /^[a-zA-Z]:[\\/]?$/.test(p.trim());
}

/** A typed path as the host should read it: a bare drive ("E:") means that drive's root. */
export function typedPath(p: string): string {
  const t = p.trim();
  return /^[a-zA-Z]:$/.test(t) ? `${t.toUpperCase()}\\` : t;
}

/** Windows folders that are never projects: recycle bins and volume metadata. */
export function isSystemFolder(name: string): boolean {
  return name.startsWith("$") || name === "System Volume Information";
}
