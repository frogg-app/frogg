/**
 * Release-version ordering lives in `@frogg/protocol/release-version` so the
 * CLI and the desktop updaters share one implementation. This module is the
 * CLI's long-standing import path; it re-exports that module unchanged.
 */
export {
  artifactVersion,
  compareVersions,
  compareVersionStrings,
  isNewerVersion,
  isStableVersion,
  parseVersion,
  type ParsedVersion,
} from "@frogg/protocol/release-version";
