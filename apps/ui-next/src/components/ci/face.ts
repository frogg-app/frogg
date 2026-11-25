// Pure helpers for the floating CI cards: what a card says, and which cards show.
import { ciState, dur, isDone, runProgress, seconds, type CiRun } from "./model";

export const isRunActive = (run: CiRun) => !isDone(ciState(run.status));

/** Cards to draw: every watched run the user has not closed. */
export const visibleRuns = (runs: CiRun[], dismissed: Record<string, true>) =>
  runs.filter((r) => !dismissed[r.id]);

/** Whether the ⋯ menu offers "Show floating CI jobs": a run still going whose card was closed. */
export const hasHiddenActive = (runs: CiRun[], dismissed: Record<string, true>) =>
  runs.some((r) => dismissed[r.id] && isRunActive(r));

export type CardTone = "run" | "ok" | "fail" | "cancel";

export interface CardFace {
  title: string;
  sub: string;
  tone: CardTone;
  /** 0..1, for the ring; finished runs read as a closed ring. */
  progress: number;
  /** Percent label, only while running. */
  pct: string | null;
}

const WAITING = ["running", "queued"] as const;

/** What a card shows: `Release · b623de07` over `7/12 jobs · 6m` or `android failed`. */
export function cardFace(run: CiRun, now = Date.now()): CardFace {
  const st = ciState(run.status);
  let ref = "";
  if (run.headSha) ref = run.headSha.slice(0, 8);
  else if (run.number !== null) ref = `#${run.number}`;
  const title = ref ? `${run.pipeline} · ${ref}` : run.pipeline;
  const total = run.jobs.length;
  const done = run.jobs.filter((j) => isDone(ciState(j.status))).length;
  if (!isDone(st)) {
    const progress = Math.max(0, Math.min(1, runProgress(run)));
    const elapsed = seconds(run.startedAt, null, now);
    const parts = [
      total ? `${done}/${total} jobs` : WAITING[st === "wait" ? 1 : 0],
      elapsed !== null ? dur(elapsed).split(" ")[0] : null,
    ].filter(Boolean);
    return {
      title,
      sub: parts.join(" · "),
      tone: "run",
      progress,
      pct: `${Math.round(progress * 100)}%`,
    };
  }
  if (st === "fail") {
    const failed = run.jobs.filter((j) => ciState(j.status) === "fail");
    let sub = "failed";
    if (failed.length === 1) sub = `${failed[0].name} failed`;
    else if (failed.length > 1) sub = `${failed.length} jobs failed`;
    return { title, sub, tone: "fail", progress: 1, pct: null };
  }
  if (st === "cancel") return { title, sub: "cancelled", tone: "cancel", progress: 1, pct: null };
  const took = seconds(run.startedAt, run.completedAt, now);
  return {
    title,
    sub: took !== null ? `passed · ${dur(took)}` : "passed",
    tone: "ok",
    progress: 1,
    pct: null,
  };
}
