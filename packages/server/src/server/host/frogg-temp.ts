import { mkdtempSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Every scratch directory or file the daemon creates lives directly in
 * `os.tmpdir()` under a `frogg-<kind>-<pid>-` name. The kind makes it
 * identifiable and the pid lets the startup sweep tell a dead process's debris
 * from a live one's (see debris-sweep.ts). Never create daemon scratch space in
 * `$HOME` or next to user files unless an atomic rename needs the same volume.
 */
export const FROGG_TEMP_KINDS = ["attachments", "pi-mcp", "pi-extension", "stt"] as const;

export type FroggTempKind = (typeof FROGG_TEMP_KINDS)[number];

export function froggTempPrefix(kind: FroggTempKind, tmpRoot: string = os.tmpdir()): string {
  return path.join(tmpRoot, `frogg-${kind}-${process.pid}-`);
}

export function createFroggTempDir(kind: FroggTempKind): Promise<string> {
  return mkdtemp(froggTempPrefix(kind));
}

export function createFroggTempDirSync(kind: FroggTempKind): string {
  return mkdtempSync(froggTempPrefix(kind));
}

/** A unique file path (not created) for single-file scratch work such as audio uploads. */
export function froggTempFilePath(kind: FroggTempKind, uniqueName: string): string {
  return `${froggTempPrefix(kind)}${uniqueName}`;
}
