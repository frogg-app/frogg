// Watches the GitHub Actions runs that belong to a checkout and pushes changes to whoever is
// looking. One watcher per daemon; sessions share a cwd's polling. Nothing is polled for a cwd
// nobody watches, active runs poll fast, and an idle checkout backs off.
import type { CiRun } from "@frogg/protocol/messages";
import { getErrorMessage } from "@frogg/protocol/error-utils";
import { listGitHubActionsRuns, type GitHubApiGet } from "./github-actions.js";

/** What the watcher needs to know about a checkout to scope its runs. */
export interface CiWatchScope {
  api: GitHubApiGet;
  /** HEAD and the upstream tip; runs for either belong to the checkout. */
  shas: string[];
}

/**
 * Resolves a cwd to its scope, or null when there is nothing to watch: not a git repo, remote not
 * on GitHub, `gh` missing, or GitHub Actions turned off in frogg.json.
 */
export type CiWatchScopeResolver = (cwd: string) => Promise<CiWatchScope | null>;

export type CiRunsListener = (runs: CiRun[]) => void;

export interface CiRunWatcherOptions {
  resolveScope: CiWatchScopeResolver;
  listRuns?: typeof listGitHubActionsRuns;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  logger?: { debug(obj: object, msg?: string): void };
}

/** Poll interval while any of the checkout's runs is queued or running. */
export const CI_WATCH_ACTIVE_MS = 10_000;
/** First idle poll; doubles per idle poll up to the cap. */
export const CI_WATCH_IDLE_BASE_MS = 30_000;
export const CI_WATCH_IDLE_CAP_MS = 5 * 60_000;
/** Checkouts with nothing to watch (no GitHub, no gh, no auth) are retried this rarely. */
export const CI_WATCH_UNAVAILABLE_MS = 10 * 60_000;
/** Finished runs stay in the set this long so clients can show the outcome. */
export const CI_WATCH_RECENT_MS = 3 * 60_000;

const isActive = (run: CiRun) => run.status === "running" || run.status === "queued";

/** Runs worth showing: every active one, plus ones that finished within `recentMs`. */
export function selectWatchedRuns(runs: CiRun[], at: number, recentMs = CI_WATCH_RECENT_MS) {
  const byId = new Map<string, CiRun>();
  for (const run of runs) {
    if (byId.has(run.id)) continue;
    if (isActive(run)) {
      byId.set(run.id, run);
      continue;
    }
    const done = run.completedAt ? Date.parse(run.completedAt) : Number.NaN;
    if (Number.isFinite(done) && at - done <= recentMs) byId.set(run.id, run);
  }
  return [...byId.values()].sort(
    (a, b) => Date.parse(b.startedAt ?? "") - Date.parse(a.startedAt ?? "") || 0,
  );
}

/** Next poll delay: fast while active, doubling idle backoff otherwise. */
export function nextPollDelay(active: boolean, idleStreak: number): number {
  if (active) return CI_WATCH_ACTIVE_MS;
  return Math.min(CI_WATCH_IDLE_BASE_MS * 2 ** Math.max(0, idleStreak - 1), CI_WATCH_IDLE_CAP_MS);
}

interface Entry {
  listeners: Set<CiRunsListener>;
  runs: CiRun[];
  key: string;
  timer: unknown;
  idleStreak: number;
  polling: Promise<void> | null;
  closed: boolean;
}

export class CiRunWatcher {
  private readonly entries = new Map<string, Entry>();
  private readonly listRuns: typeof listGitHubActionsRuns;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly options: CiRunWatcherOptions) {
    this.listRuns = options.listRuns ?? listGitHubActionsRuns;
    this.now = options.now ?? Date.now;
    this.setTimer =
      options.setTimer ??
      ((fn, ms) => {
        const handle = setTimeout(fn, ms);
        handle.unref?.();
        return handle;
      });
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  }

  /** The latest set for a watched cwd; empty when unwatched or not yet polled. */
  current(cwd: string): CiRun[] {
    return this.entries.get(cwd)?.runs ?? [];
  }

  /** Starts (or joins) polling `cwd`. The returned function stops this listener. */
  watch(cwd: string, listener: CiRunsListener): () => void {
    let entry = this.entries.get(cwd);
    if (!entry) {
      entry = {
        listeners: new Set(),
        runs: [],
        key: "[]",
        timer: null,
        idleStreak: 0,
        polling: null,
        closed: false,
      };
      this.entries.set(cwd, entry);
      entry.listeners.add(listener);
      void this.poll(cwd, entry);
    } else {
      entry.listeners.add(listener);
    }
    const watched = entry;
    return () => {
      watched.listeners.delete(listener);
      if (watched.listeners.size > 0) return;
      watched.closed = true;
      if (watched.timer !== null) this.clearTimer(watched.timer);
      watched.timer = null;
      if (this.entries.get(cwd) === watched) this.entries.delete(cwd);
    };
  }

  /** Something changed (a push, a new HEAD): poll now and reset the idle backoff. */
  poke(cwd: string): void {
    const entry = this.entries.get(cwd);
    if (!entry || entry.polling) return;
    entry.idleStreak = 0;
    if (entry.timer !== null) this.clearTimer(entry.timer);
    entry.timer = null;
    void this.poll(cwd, entry);
  }

  /** Waits for in-flight polls; test seam. */
  async settle(): Promise<void> {
    await Promise.all([...this.entries.values()].map((entry) => entry.polling));
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      entry.closed = true;
      if (entry.timer !== null) this.clearTimer(entry.timer);
    }
    this.entries.clear();
  }

  private poll(cwd: string, entry: Entry): Promise<void> {
    entry.polling = this.runPoll(cwd, entry).finally(() => {
      entry.polling = null;
    });
    return entry.polling;
  }

  private async runPoll(cwd: string, entry: Entry): Promise<void> {
    let delay: number;
    try {
      const scope = await this.options.resolveScope(cwd);
      if (!scope) {
        this.publish(entry, []);
        delay = CI_WATCH_UNAVAILABLE_MS;
      } else {
        const runs = await this.fetchScoped(scope);
        const selected = selectWatchedRuns(runs, this.now());
        this.publish(entry, selected);
        const active = selected.some(isActive);
        entry.idleStreak = active ? 0 : entry.idleStreak + 1;
        delay = nextPollDelay(active, entry.idleStreak);
      }
    } catch (error) {
      // gh unauthenticated, rate limited, offline: stay quiet and keep the last set.
      this.options.logger?.debug({ cwd, err: getErrorMessage(error) }, "CI run watch poll failed");
      entry.idleStreak += 1;
      delay = nextPollDelay(false, entry.idleStreak);
    }
    if (entry.closed) return;
    entry.timer = this.setTimer(() => {
      entry.timer = null;
      if (!entry.closed) void this.poll(cwd, entry);
    }, delay);
  }

  private async fetchScoped(scope: CiWatchScope): Promise<CiRun[]> {
    const lists = await Promise.all(
      [...new Set(scope.shas)].map((headSha) =>
        this.listRuns({ api: scope.api, filter: { headSha } }),
      ),
    );
    return lists.flat();
  }

  private publish(entry: Entry, runs: CiRun[]): void {
    const key = JSON.stringify(runs);
    if (key === entry.key) return;
    entry.key = key;
    entry.runs = runs;
    for (const listener of entry.listeners) listener(runs);
  }
}
