import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMemo } from "react";
import { create } from "zustand";
import type { Project } from "../../daemon/store";
import { baseName } from "./paths";

/**
 * This device's own view of each host's project list, kept beside (not on) the daemon: folders
 * pinned to the top, daemon projects hidden here, and folders listed here that the daemon does
 * not have. Keyed by saved-host id and by project root path, so it survives the daemon
 * forgetting or re-creating a project.
 */
export interface HostProjectPrefs {
  pinned: string[];
  hidden: string[];
  added: string[];
}

interface LocalProjectsState {
  byHost: Record<string, HostProjectPrefs>;
}

const EMPTY: HostProjectPrefs = { pinned: [], hidden: [], added: [] };

export const useLocalProjects = create<LocalProjectsState>(() => ({ byHost: {} }));

const KEY = "frogg-next:local-projects";
const ready = AsyncStorage.getItem(KEY)
  .then((raw): void => {
    if (!raw) return undefined;
    const saved = JSON.parse(raw) as Partial<LocalProjectsState>;
    useLocalProjects.setState({ byHost: saved.byHost ?? {} });
    return undefined;
  })
  .catch(() => {});
void ready.then(() =>
  useLocalProjects.subscribe((s, prev) => {
    if (s.byHost !== prev.byHost)
      void AsyncStorage.setItem(KEY, JSON.stringify({ byHost: s.byHost }));
  }),
);

export const prefsOf = (byHost: LocalProjectsState["byHost"], hostId: string | null) =>
  (hostId && byHost[hostId]) || EMPTY;

function edit(hostId: string, fn: (p: HostProjectPrefs) => HostProjectPrefs): void {
  useLocalProjects.setState((st) => ({
    byHost: { ...st.byHost, [hostId]: fn(prefsOf(st.byHost, hostId)) },
  }));
}

const flip = (list: string[], root: string, on: boolean) =>
  on ? [...list.filter((x) => x !== root), root] : list.filter((x) => x !== root);

export const pinProject = (hostId: string, root: string, on: boolean) =>
  edit(hostId, (p) => ({ ...p, pinned: flip(p.pinned, root, on) }));
export const hideProject = (hostId: string, root: string, on: boolean) =>
  edit(hostId, (p) => ({ ...p, hidden: flip(p.hidden, root, on) }));
/** Lists a folder on this device only; the daemon learns of it when a session starts there. */
export const addLocalProject = (hostId: string, root: string) =>
  edit(hostId, (p) => ({
    ...p,
    added: flip(p.added, root, true),
    hidden: flip(p.hidden, root, false),
  }));
export const removeLocalProject = (hostId: string, root: string) =>
  edit(hostId, (p) => ({
    added: flip(p.added, root, false),
    pinned: flip(p.pinned, root, false),
    hidden: p.hidden,
  }));

export const LOCAL_PREFIX = "local:";
export const isLocalProject = (p: Pick<Project, "projectId">) =>
  p.projectId.startsWith(LOCAL_PREFIX);

/** A folder listed on this device only, shaped like a daemon project. */
export function localProject(root: string): Project {
  return {
    projectId: `${LOCAL_PREFIX}${root}`,
    projectKey: `${LOCAL_PREFIX}${root}`,
    projectDisplayName: baseName(root) || root,
    projectRootPath: root,
    projectKind: "directory",
  };
}

export interface MergedProject {
  project: Project;
  pinned: boolean;
  hidden: boolean;
  /** Listed on this device only. */
  local: boolean;
}

/**
 * The daemon's projects merged with this device's list: pinned first (in pin order), then the
 * daemon's order, then folders only this device lists. Hidden ones are kept, marked, so a
 * manager can show them; `visibleProjects` drops them.
 */
export function mergeProjects(
  daemon: readonly Project[],
  prefs: HostProjectPrefs,
): MergedProject[] {
  const roots = new Set(daemon.map((p) => p.projectRootPath));
  const all = [
    ...daemon,
    ...prefs.added.filter((r) => !roots.has(r)).map((r) => localProject(r)),
  ].map((project) => ({
    project,
    pinned: prefs.pinned.includes(project.projectRootPath),
    hidden: prefs.hidden.includes(project.projectRootPath),
    local: isLocalProject(project),
  }));
  const pinRank = (m: MergedProject) => prefs.pinned.indexOf(m.project.projectRootPath);
  const pinned = all.filter((m) => m.pinned).sort((a, b) => pinRank(a) - pinRank(b));
  return [...pinned, ...all.filter((m) => !m.pinned)];
}

export const visibleProjects = (merged: readonly MergedProject[]): Project[] =>
  merged.filter((m) => !m.hidden).map((m) => m.project);

/** A host's project list as this device shows it (hidden ones left out). */
export function useVisibleProjects(hostId: string | null, daemon: readonly Project[]): Project[] {
  const byHost = useLocalProjects((s) => s.byHost);
  return useMemo(
    () => visibleProjects(mergeProjects(daemon, prefsOf(byHost, hostId))),
    [daemon, byHost, hostId],
  );
}
