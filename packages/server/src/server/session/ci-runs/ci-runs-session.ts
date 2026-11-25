// One client's CI run watches: which checkouts it is looking at, each forwarding the daemon-wide
// watcher's updates as `checkout.ci.watched_runs.update`.
import { expandTilde } from "../../../utils/path.js";
import type { CiRunWatcher } from "../../../services/ci/ci-run-watcher.js";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";

type Inbound<T extends SessionInboundMessage["type"]> = Extract<SessionInboundMessage, { type: T }>;

export interface CiRunsSessionDependencies {
  watcher: CiRunWatcher | null | undefined;
  emit(message: SessionOutboundMessage): void;
}

export class CiRunsSession {
  private readonly watches = new Map<string, () => void>();

  constructor(private readonly deps: CiRunsSessionDependencies) {}

  dispatch(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "checkout.ci.watch_runs.request":
        return this.handleWatch(msg);
      case "checkout.ci.unwatch_runs.request":
        return this.handleUnwatch(msg);
      default:
        return undefined;
    }
  }

  close(): void {
    for (const stop of this.watches.values()) stop();
    this.watches.clear();
  }

  private async handleWatch(msg: Inbound<"checkout.ci.watch_runs.request">): Promise<void> {
    const { cwd, requestId } = msg;
    const watcher = this.deps.watcher;
    if (!watcher) {
      this.deps.emit({
        type: "checkout.ci.watch_runs.response",
        payload: {
          cwd,
          runs: [],
          error: { code: "UNKNOWN", message: "CI run watching is unavailable" },
          requestId,
        },
      });
      return;
    }
    const resolved = expandTilde(cwd);
    if (!this.watches.has(cwd)) {
      this.watches.set(
        cwd,
        watcher.watch(resolved, (runs) =>
          this.deps.emit({ type: "checkout.ci.watched_runs.update", payload: { cwd, runs } }),
        ),
      );
    }
    this.deps.emit({
      type: "checkout.ci.watch_runs.response",
      payload: { cwd, runs: watcher.current(resolved), error: null, requestId },
    });
  }

  private async handleUnwatch(msg: Inbound<"checkout.ci.unwatch_runs.request">): Promise<void> {
    const { cwd, requestId } = msg;
    this.watches.get(cwd)?.();
    this.watches.delete(cwd);
    this.deps.emit({
      type: "checkout.ci.unwatch_runs.response",
      payload: { cwd, error: null, requestId },
    });
  }
}
