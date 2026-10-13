// CI run pieces for the PRs & CI panel and the run detail pane: glyphs, live durations, progress
// bars, run rows with an expandable job list, failed-step log excerpts and run actions.
import { ChevronRight, ExternalLink, RotateCcw, Square } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Linking, Pressable, StyleSheet, View } from "react-native";
import {
  beamBand,
  color,
  glide,
  motion,
  stateMotion,
  stateMs,
  toolDoneMotion,
  toolDoneMs,
  web,
} from "../../theme/tokens";
import { Button } from "../Button";
import { fmt, Num } from "../CountUp";
import { useReducedMotion } from "../Meter";
import { reducedMotion, usePresence } from "../presence";
import { Brackets } from "../Brackets";
import { T } from "../Text";
import { useConfirm } from "../tools/Confirm";
import {
  ciState,
  currentStep,
  dur,
  eta,
  isDone,
  runProgress,
  seconds,
  useCi,
  useNow,
  type CiJob,
  type CiRun,
  type CiState,
} from "./model";

const curve = Easing.bezier(...glide.curve);
/** Bars and counters ease toward each new figure over this long, so steady ticks read as flow. */
export const ciMotion = { fill: 700, count: 950, tint: 240 } as const;

// ─── glyph ──────────────────────────────────────────────────────────────────────────────────

/** ● passed · ■ failed · ▶ running (breathes) · ○ queued · – skipped · ⊘ cancelled. */
export function CiGlyph({ state, pop }: { state: CiState; pop?: boolean }) {
  return (
    <View style={[g.box, pop && g.pop]}>
      <View style={g[state]} />
    </View>
  );
}

// ─── settle feedback ────────────────────────────────────────────────────────────────────────

type Settle = "ok" | "fail" | "cancel" | null;
/** Last row sweep; a burst of jobs finishing together only sweeps once per throttle window. */
let lastSweep = 0;

/**
 * One-shot feedback on a live running/queued → finished transition (never on mount with a final
 * state): the glyph pops, and unless another row swept a moment ago, a wash sweeps the row and a
 * 2px edge flashes. Mirrors the tool-call settle.
 */
export function useCiSettle(state: CiState): { kind: Settle; sweep: boolean } {
  const prev = useRef(state);
  const [settle, setSettle] = useState<{ kind: Settle; sweep: boolean }>({
    kind: null,
    sweep: false,
  });
  useEffect(() => {
    const was = prev.current;
    prev.current = state;
    if (isDone(was) || !isDone(state) || state === "skip") return undefined;
    const now = Date.now();
    const sweep = now - lastSweep > toolDoneMs.throttle;
    if (sweep) lastSweep = now;
    setSettle({ kind: state as Settle, sweep });
    const t = setTimeout(() => setSettle({ kind: null, sweep: false }), toolDoneMs.sweep + 400);
    return () => clearTimeout(t);
  }, [state]);
  return settle;
}

/** The sweep + edge layers a settling row paints behind its content. */
function SettleWash({ kind }: { kind: Settle }) {
  if (!kind) return null;
  const fail = kind === "fail";
  return (
    <>
      <View pointerEvents="none" style={f.track}>
        <View style={[f.sweep, fail ? f.sweepFail : f.sweepOk]} />
      </View>
      <View
        pointerEvents="none"
        style={[f.edge, fail && f.edgeFail, kind === "cancel" && f.edgeCancel]}
      />
    </>
  );
}

// ─── live numbers ───────────────────────────────────────────────────────────────────────────

/** Elapsed time that counts while open (lerping between ticks) and settles on the final figure. */
export function Elapsed({
  from,
  to,
  style,
}: {
  from: string | null;
  to: string | null;
  style?: object;
}) {
  const live = !!from && !to;
  const now = useNow(live);
  const sec = seconds(from, to, now);
  if (sec === null) return null;
  return (
    <Num
      value={sec}
      format={dur}
      duration={live ? ciMotion.count : glide.ms}
      curve={live ? Easing.linear : curve}
      style={[x.time, style]}
    />
  );
}

/** Time left, from elapsed and progress; lerps as both move. */
function Eta({ from, progress }: { from: string | null; progress: number | null }) {
  const now = useNow(true);
  const left = eta(seconds(from, null, now), progress);
  if (left === null) return null;
  return (
    <T v="mono" style={x.eta}>
      ~<Num value={left} format={dur} duration={ciMotion.count} style={x.eta} /> left
    </T>
  );
}

// ─── progress bar ───────────────────────────────────────────────────────────────────────────

/**
 * A 2px bar that eases to each new value on the glide curve, tinted by state (crossfading on a
 * state change), with a light band travelling the fill while it runs. Percent beside it lerps
 * with the fill.
 */
export function CiProgress({
  value,
  state,
  pct = true,
}: {
  value: number;
  state: CiState;
  pct?: boolean;
}) {
  const reduced = useReducedMotion();
  const w = useRef(new Animated.Value(reduced ? value : 0)).current;
  useEffect(() => {
    if (reduced) {
      w.setValue(value);
      return undefined;
    }
    const a = Animated.timing(w, {
      toValue: value,
      duration: ciMotion.fill,
      easing: curve,
      useNativeDriver: false,
    });
    a.start();
    return () => a.stop();
  }, [value, reduced, w]);
  const fill = useMemo(
    () => [
      p.fill,
      p[state],
      { width: w.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) },
    ],
    [w, state],
  );
  const running = state === "run" && !reduced && !reducedMotion();
  return (
    <View style={p.row}>
      <View style={p.track}>
        <Animated.View style={fill}>{running && <View style={p.beam} />}</Animated.View>
      </View>
      {pct && (
        <Num
          value={value * 100}
          format={fmt.pct}
          duration={ciMotion.fill}
          style={[p.pct, state === "fail" && p.pctFail]}
        />
      )}
    </View>
  );
}

// ─── log excerpt ────────────────────────────────────────────────────────────────────────────

const LOUD = /^\s*(FAIL|×|✗|Error|AssertionError|TypeError|error\b|expected)/;

/** The failing step's last lines, mono on the deep surface with a coral edge. */
export function LogExcerpt({ job, tall }: { job: CiJob; tall?: boolean }) {
  const step = currentStep(job);
  const lines = useMemo(
    () => (job.log ?? []).map((text, n) => ({ key: `${n}:${text}`, text, loud: LOUD.test(text) })),
    [job.log],
  );
  if (!lines.length) return null;
  return (
    <View style={[l.box, !reducedMotion() && l.rise]}>
      <View style={l.edge} />
      {step && (
        <T v="mono" style={l.head} numberOfLines={1}>
          step {step.n} of {step.of} · {step.name}
        </T>
      )}
      <View style={tall ? l.bodyTall : l.body}>
        {lines.map((ln) => (
          <T key={ln.key} v="mono" style={[l.line, ln.loud && l.loud]} numberOfLines={tall ? 0 : 1}>
            {ln.text || " "}
          </T>
        ))}
      </View>
    </View>
  );
}

// ─── jobs ───────────────────────────────────────────────────────────────────────────────────

function stepLine(job: CiJob, state: CiState): string | null {
  const step = currentStep(job);
  if (state === "run" && step) return `${step.n}/${step.of} · ${step.name}`;
  if (state === "fail" && step) return `failed at ${step.name}`;
  if (state === "wait") return "queued";
  if (state === "cancel") return "cancelled";
  if (state === "skip") return "skipped";
  return null;
}

/** One job: glyph, name, current step, time; a mini bar while running; the log excerpt on failure. */
export function JobRow({
  job,
  selected,
  onPress,
  excerpt = true,
}: {
  job: CiJob;
  selected?: boolean;
  onPress?: (id: string) => void;
  excerpt?: boolean;
}) {
  const state = ciState(job.status);
  const settle = useCiSettle(state);
  const press = useCallback(() => onPress?.(job.id), [onPress, job.id]);
  const sub = stepLine(job, state);
  const quiet = state === "skip" || state === "cancel" || state === "wait";
  return (
    <Pressable onPress={press} disabled={!onPress}>
      {({ hovered }) => (
        <View style={[j.row, hovered && !!onPress && j.hover, selected && j.on]}>
          <SettleWash kind={settle.sweep ? settle.kind : null} />
          {onPress && <Brackets on={!!selected} />}
          <View style={j.head}>
            <CiGlyph state={state} pop={!!settle.kind} />
            <T numberOfLines={1} style={[j.name, quiet && j.quiet]}>
              {job.name}
            </T>
            {(job.attempt ?? 1) > 1 && (
              <T v="mono" style={j.attempt}>
                #{job.attempt}
              </T>
            )}
            {state === "run" && <Eta from={job.startedAt} progress={job.progress} />}
            <Elapsed from={job.startedAt} to={job.completedAt} />
          </View>
          {sub && (
            <T v="mono" numberOfLines={1} style={[j.sub, state === "fail" && j.subFail]}>
              {sub}
            </T>
          )}
          {state === "run" && job.progress !== null && (
            <View style={j.bar}>
              <CiProgress value={job.progress} state={state} pct={false} />
            </View>
          )}
          {excerpt && state === "fail" && <LogExcerpt job={job} />}
        </View>
      )}
    </Pressable>
  );
}

// ─── runs ───────────────────────────────────────────────────────────────────────────────────

function runCaption(run: CiRun, state: CiState): string | null {
  const failed = run.jobs.filter((jb) => ciState(jb.status) === "fail");
  if (state === "fail" && failed.length) return `${failed.map((jb) => jb.name).join(", ")} failed`;
  if (state === "wait") return "queued · waiting for a runner";
  if (state === "cancel") return "cancelled";
  if (state === "run") {
    const live = run.jobs.filter((jb) => ciState(jb.status) === "run").map((jb) => jb.name);
    return live.length ? `running ${live.join(", ")}` : null;
  }
  return null;
}

/**
 * A run in the side list: glyph, commit title, elapsed; number, branch, actor; a progress bar
 * with percent and time left while running. The chevron unfolds the job list in place.
 */
export function RunRow({
  run,
  selected,
  onOpen,
  defaultOpen = false,
  fresh,
}: {
  run: CiRun;
  selected?: boolean;
  onOpen?: (id: string) => void;
  defaultOpen?: boolean;
  /** Arrived after the list first rendered: rises in. */
  fresh?: boolean;
}) {
  const state = ciState(run.status);
  const settle = useCiSettle(state);
  const [open, setOpen] = useState(defaultOpen);
  const fold = usePresence(open, stateMs.fold - 40);
  const live = !reducedMotion();
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const press = useCallback(() => onOpen?.(run.id), [onOpen, run.id]);
  const expanded = useMemo(() => ({ expanded: open }), [open]);
  const meta = [
    run.number ? `#${run.number}` : null,
    run.branch,
    run.actor,
    run.sha?.slice(0, 7),
  ].filter(Boolean);
  const caption = runCaption(run, state);
  return (
    <View style={[r.wrap, fresh && live && r.rise]}>
      <Pressable onPress={press}>
        {({ hovered }) => (
          <View style={[r.row, hovered && r.hover, selected && r.on]}>
            <SettleWash kind={settle.sweep ? settle.kind : null} />
            <Brackets on={!!selected} />
            <View style={r.head}>
              <CiGlyph state={state} pop={!!settle.kind} />
              <T numberOfLines={1} style={r.title}>
                {run.title ?? run.pipeline}
              </T>
              {(run.attempt ?? 1) > 1 && (
                <T v="mono" style={r.attempt}>
                  attempt {run.attempt}
                </T>
              )}
              <Elapsed from={run.startedAt} to={run.completedAt} />
            </View>
            <View style={r.metaRow}>
              <T v="mono" numberOfLines={1} style={r.meta}>
                {run.pipeline} · {meta.join(" · ")}
              </T>
              <Pressable
                onPress={toggle}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityState={expanded}
                accessibilityLabel={open ? "Hide jobs" : "Show jobs"}
                style={r.chevBtn}
              >
                <T v="mono" style={r.jobsN}>
                  {run.jobs.length} jobs
                </T>
                <View style={[r.chev, open && r.chevOpen]}>
                  <ChevronRight size={12} color={color.muted} />
                </View>
              </Pressable>
            </View>
            {state === "run" && (
              <View style={r.progress}>
                <CiProgress value={runProgress(run)} state={state} />
                {state === "run" && <Eta from={run.startedAt} progress={runProgress(run)} />}
              </View>
            )}
            {caption && (
              <T v="mono" numberOfLines={1} style={[r.caption, state === "fail" && r.captionFail]}>
                {caption}
              </T>
            )}
          </View>
        )}
      </Pressable>
      {fold.mounted && (
        <View style={[r.jobs, live && (fold.closing ? r.fold : r.unfold)]}>
          {run.jobs.map((jb) => (
            <JobRow key={jb.id} job={jb} />
          ))}
          <RunActions run={run} compact />
        </View>
      )}
    </View>
  );
}

/** Running / failed / passed tallies over the listed runs; each count lerps when it changes. */
export function RunTally({ runs }: { runs: CiRun[] }) {
  const n = useMemo(() => {
    const c: Record<CiState, number> = { ok: 0, fail: 0, run: 0, wait: 0, skip: 0, cancel: 0 };
    for (const run of runs) c[ciState(run.status)] += 1;
    return c;
  }, [runs]);
  return (
    <View style={r.tally}>
      <TallyItem state="run" n={n.run + n.wait} label="active" />
      <TallyItem state="fail" n={n.fail} label="failed" />
      <TallyItem state="ok" n={n.ok} label="passed" />
    </View>
  );
}

function TallyItem({ state, n, label }: { state: CiState; n: number; label: string }) {
  return (
    <View style={r.tallyItem}>
      <CiGlyph state={state} />
      <Num value={n} style={r.tallyN} />
      <T v="mono" style={r.tallyL}>
        {label}
      </T>
    </View>
  );
}

// ─── actions ────────────────────────────────────────────────────────────────────────────────

/**
 * Re-run failed, Re-run all, Cancel (confirmed), Open logs. Rerun and cancel show only when
 * something registered a handler (no daemon RPC yet); Open logs goes to the forge.
 */
export function RunActions({ run, compact }: { run: CiRun; compact?: boolean }) {
  const actions = useCi((st) => st.actions);
  const { ask, dialog } = useConfirm();
  const state = ciState(run.status);
  const failed = run.jobs.some((jb) => ciState(jb.status) === "fail");
  const url = run.jobs.find((jb) => ciState(jb.status) === "fail")?.url ?? run.url;
  const rerunFailed = useCallback(() => void actions.rerun?.(run.id, true), [actions, run.id]);
  const rerunAll = useCallback(() => void actions.rerun?.(run.id, false), [actions, run.id]);
  const cancel = useCallback(
    () =>
      ask({
        eyebrow: `${run.pipeline}${run.number ? ` #${run.number}` : ""}`,
        title: "Cancel this run?",
        body: "Running jobs stop where they are and queued jobs are skipped. You can re-run it afterwards.",
        action: "Cancel run",
        danger: true,
        run: () => actions.cancel?.(run.id),
      }),
    [ask, actions, run.id, run.pipeline, run.number],
  );
  const openLogs = useCallback(() => {
    if (url) void Linking.openURL(url);
  }, [url]);
  const done = isDone(state);
  return (
    <View style={[a.row, compact && a.compact]}>
      {done && failed && actions.rerun && (
        <Button label="Re-run failed" icon={RotateCcw} kind="primary" onPress={rerunFailed} />
      )}
      {done && actions.rerun && <Button label="Re-run all" onPress={rerunAll} />}
      {!done && actions.cancel && (
        <Button label="Cancel" icon={Square} kind="danger" onPress={cancel} />
      )}
      {url && <Button label="Open logs" icon={ExternalLink} onPress={openLogs} />}
      {dialog}
    </View>
  );
}

// ─── styles ─────────────────────────────────────────────────────────────────────────────────

const dot = { width: 8, height: 8 };
const g = StyleSheet.create({
  box: { width: 10, height: 10, alignItems: "center", justifyContent: "center" },
  pop: toolDoneMotion.pop,
  ok: { ...dot, borderRadius: 4, backgroundColor: color.mint },
  wait: { ...dot, borderRadius: 4, borderWidth: 1, borderColor: color.faint },
  skip: { width: 8, height: 1.5, backgroundColor: color.faint },
  fail: { ...dot, backgroundColor: color.coral },
  cancel: { ...dot, borderWidth: 1, borderColor: color.muted, transform: [{ rotate: "45deg" }] },
  run: {
    width: 0,
    height: 0,
    borderTopWidth: 4,
    borderBottomWidth: 4,
    borderLeftWidth: 8,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: color.cyan,
    ...motion.breathe,
  },
});

const f = StyleSheet.create({
  track: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  sweep: { position: "absolute", top: 0, bottom: 0, left: 0, width: "40%", opacity: 0 },
  sweepOk: {
    ...web({
      backgroundImage: "linear-gradient(90deg, transparent, rgba(63,207,142,0.12), transparent)",
    }),
    ...toolDoneMotion.sweep,
  },
  sweepFail: {
    ...web({
      backgroundImage: "linear-gradient(90deg, transparent, rgba(255,107,107,0.10), transparent)",
    }),
    ...toolDoneMotion.sweep,
  },
  edge: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: 2,
    opacity: 0,
    backgroundColor: color.mint,
    ...toolDoneMotion.edge,
  },
  edgeFail: { backgroundColor: color.coral },
  edgeCancel: { backgroundColor: color.muted },
});

const x = StyleSheet.create({
  time: { fontSize: 11, color: color.muted, minWidth: 44, textAlign: "right" },
  eta: { fontSize: 10.5, color: color.faint },
});

const p = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  track: { flex: 1, height: 2, backgroundColor: color.line, overflow: "hidden" },
  fill: { height: 2, overflow: "hidden", ...web({ transition: `background-color 240ms ease` }) },
  ok: { backgroundColor: color.mint },
  fail: { backgroundColor: color.coral },
  run: { backgroundColor: color.cyan },
  wait: { backgroundColor: color.faint },
  skip: { backgroundColor: color.faint },
  cancel: { backgroundColor: color.muted },
  beam: { width: 40, height: 2, ...beamBand, ...stateMotion.beam, opacity: 0.7 },
  pct: { fontSize: 10.5, color: color.cyan2, minWidth: 30, textAlign: "right" },
  pctFail: { color: color.coral },
});

const l = StyleSheet.create({
  box: {
    marginTop: 8,
    backgroundColor: color.bg,
    borderWidth: 1,
    borderColor: color.line,
    paddingVertical: 7,
    paddingLeft: 12,
    paddingRight: 8,
    gap: 4,
  },
  rise: stateMotion.rise,
  edge: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: color.coral,
  },
  head: { fontSize: 10.5, color: color.faint },
  body: { gap: 1 },
  bodyTall: { gap: 2 },
  line: { fontSize: 11, lineHeight: 16, color: color.muted },
  loud: { color: color.coral },
});

const j = StyleSheet.create({
  row: { paddingHorizontal: 10, paddingVertical: 7, overflow: "hidden" },
  hover: { backgroundColor: color.wash },
  on: { backgroundColor: color.wash2 },
  head: { flexDirection: "row", alignItems: "center", gap: 9 },
  name: { flex: 1, fontSize: 12.5, fontWeight: "500" },
  quiet: { color: color.faint },
  attempt: { fontSize: 10, color: color.amber },
  sub: { marginLeft: 19, marginTop: 2, fontSize: 10.5, color: color.faint },
  subFail: { color: color.coral },
  bar: { marginLeft: 19, marginTop: 5 },
});

const r = StyleSheet.create({
  wrap: { marginHorizontal: 8, borderBottomWidth: 1, borderBottomColor: color.line },
  rise: stateMotion.rise,
  row: { paddingHorizontal: 8, paddingVertical: 10, gap: 4, overflow: "hidden" },
  hover: { backgroundColor: color.wash },
  on: { backgroundColor: color.cyanWash },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontWeight: "500" },
  attempt: {
    fontSize: 10,
    color: color.amber,
    borderWidth: 1,
    borderColor: color.line2,
    paddingHorizontal: 4,
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginLeft: 18 },
  meta: { flex: 1, fontSize: 11, color: color.faint },
  chevBtn: { flexDirection: "row", alignItems: "center", gap: 3 },
  jobsN: { fontSize: 10.5, color: color.muted },
  chev: { ...web({ transition: `transform ${glide.ms}ms cubic-bezier(0.22, 1, 0.36, 1)` }) },
  chevOpen: { transform: [{ rotate: "90deg" }] },
  progress: { flexDirection: "row", alignItems: "center", gap: 8, marginLeft: 18, marginTop: 3 },
  caption: { marginLeft: 18, fontSize: 10.5, color: color.faint },
  captionFail: { color: color.coral },
  jobs: {
    paddingLeft: 10,
    paddingBottom: 8,
    borderLeftWidth: 1,
    borderLeftColor: color.line,
    marginLeft: 12,
  },
  unfold: { ...stateMotion.unfold, ...web({ overflow: "hidden" }) },
  fold: { ...stateMotion.fold, ...web({ overflow: "hidden" }) },
  tally: { flexDirection: "row", gap: 14, paddingHorizontal: 16, paddingVertical: 8 },
  tallyItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  tallyN: { fontSize: 12, color: color.text },
  tallyL: { fontSize: 10.5, color: color.faint },
});

const a = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  compact: { paddingTop: 8, paddingHorizontal: 10 },
});
