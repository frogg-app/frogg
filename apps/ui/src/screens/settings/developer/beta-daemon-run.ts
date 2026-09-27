import type {
  DaemonBetaChannelRun,
  DaemonBetaChannelRunCompletedMessage,
} from "@frogg/protocol/messages";

/** Lines kept per host; the installer can be chatty and the log is a tail, not an archive. */
export const BETA_DAEMON_LOG_LIMIT = 200;

export type BetaDaemonRunView =
  | { kind: "idle" }
  | { kind: "starting"; action: "install" | "uninstall" }
  | { kind: "running"; run: DaemonBetaChannelRun }
  | {
      kind: "completed";
      action: string;
      status: "succeeded" | "failed";
      version: string | null;
      error: string | null;
    }
  | { kind: "error"; message: string };

export interface BetaDaemonRunState {
  view: BetaDaemonRunView;
  /** Only events for this run are applied once it is known; null accepts any run. */
  runId: string | null;
  log: string[];
}

export const INITIAL_BETA_DAEMON_RUN_STATE: BetaDaemonRunState = {
  view: { kind: "idle" },
  runId: null,
  log: [],
};

export type BetaDaemonRunEvent =
  | { type: "start"; action: "install" | "uninstall" }
  | { type: "accepted"; runId: string | null }
  | { type: "rejected"; message: string }
  | { type: "progress"; run: DaemonBetaChannelRun; logLine?: string }
  | { type: "completed"; payload: DaemonBetaChannelRunCompletedMessage["payload"] }
  /** A run already in flight when the status was read (started elsewhere). */
  | { type: "resume"; run: DaemonBetaChannelRun };

function appendLog(log: string[], line: string | undefined): string[] {
  if (line === undefined) return log;
  const next = [...log, line];
  return next.length > BETA_DAEMON_LOG_LIMIT ? next.slice(-BETA_DAEMON_LOG_LIMIT) : next;
}

function isInFlight(view: BetaDaemonRunView): boolean {
  return view.kind === "running" || view.kind === "starting";
}

export function reduceBetaDaemonRun(
  state: BetaDaemonRunState,
  event: BetaDaemonRunEvent,
): BetaDaemonRunState {
  switch (event.type) {
    case "start":
      return { view: { kind: "starting", action: event.action }, runId: null, log: [] };
    case "accepted":
      return { ...state, runId: event.runId };
    case "rejected":
      return { ...state, view: { kind: "error", message: event.message } };
    case "resume":
      if (isInFlight(state.view)) return state;
      return { view: { kind: "running", run: event.run }, runId: event.run.runId, log: [] };
    case "progress": {
      if (state.runId !== null && state.runId !== event.run.runId) {
        // Another client's run replaces a finished one, never one still in flight.
        if (isInFlight(state.view)) return state;
        return {
          view: { kind: "running", run: event.run },
          runId: event.run.runId,
          log: appendLog([], event.logLine),
        };
      }
      return {
        view: { kind: "running", run: event.run },
        runId: event.run.runId,
        log: appendLog(state.log, event.logLine),
      };
    }
    case "completed": {
      if (state.runId !== null && state.runId !== event.payload.runId) return state;
      const { action, status, version, error } = event.payload;
      return {
        ...state,
        runId: event.payload.runId,
        view: { kind: "completed", action, status, version, error },
      };
    }
  }
}

export function isBetaDaemonRunBusy(view: BetaDaemonRunView): boolean {
  return isInFlight(view);
}
