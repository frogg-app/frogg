/**
 * A host path as typed into a shell, the way a terminal pastes a dropped file: bare when it is
 * safe, otherwise quoted (double quotes on Windows paths, single quotes elsewhere).
 */
export function shellPath(path: string): string {
  if (/^[\w@%+=:,./\\-]+$/.test(path)) return path;
  if (/^[A-Za-z]:\\/.test(path) || path.startsWith("\\\\")) return `"${path.replace(/"/g, '""')}"`;
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

/** What a drop types into the terminal: the paths, space separated, with a trailing space. */
export function droppedPaths(paths: string[]): string {
  return paths.length ? `${paths.map(shellPath).join(" ")} ` : "";
}
